"use strict";
/* 직원 로그인·비밀번호 변경·관리자 초기화 (Callable, 서울 리전) */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const lib = require("./pwlib");

const db = getFirestore();
const ROOT_ADMIN_EMAIL = "sehyun.ka@gmail.com";
const opts = { region: "asia-northeast3", cors: true, maxInstances: 5 };
const GENERIC_FAIL = "ID 또는 비밀번호가 올바르지 않습니다.";

function sessionProfile(doc, status) {
  const a = doc.data();
  const raw = Array.isArray(a.vehicles) && a.vehicles.length ? a.vehicles : (a.vehicle ? [a.vehicle] : []);
  const vehicles = [...new Set(raw.filter(Boolean))].slice(0, 3);
  return {
    aid: doc.id, name: a.name || "", dept: a.dept || "", title: a.title || "",
    vehicle: vehicles[0] || "", vehicles, sharedVehicleAccess: a.sharedVehicleAccess === true,
    passwordStatus: status
  };
}

async function findAccountByUserId(userId) {
  const id = lib.normalizeText(userId);
  if (!id) return null;
  let snap = await db.collection("accounts").where("userId", "==", id).limit(2).get();
  if (!snap.empty) return snap.docs[0];
  const all = await db.collection("accounts").get();
  return all.docs.find(d => lib.normalizeText(d.data().userId).toLowerCase() === id.toLowerCase()) || null;
}

async function assertNotLocked(ref) {
  const snap = await ref.get();
  const until = snap.exists ? Number(snap.data().lockedUntil || 0) : 0;
  if (until > Date.now()) {
    const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    throw new HttpsError("resource-exhausted", `비밀번호를 ${lib.MAX_FAILS}회 틀려 잠겼습니다. ${minutes}분 후 다시 시도하세요.`, { code: "locked", retryMinutes: minutes });
  }
}

async function recordFailure(ref) {
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const expired = Number(data.lockedUntil || 0) && Number(data.lockedUntil) <= Date.now();
    let count = (expired ? 0 : Number(data.count || 0)) + 1;
    let lockedUntil = 0;
    if (count >= lib.MAX_FAILS) { lockedUntil = Date.now() + lib.LOCK_MS; count = 0; }
    tx.set(ref, { count, lockedUntil, updatedAt: FieldValue.serverTimestamp() });
    return { remaining: lockedUntil ? 0 : lib.MAX_FAILS - count, locked: !!lockedUntil };
  });
}

function failError(result) {
  if (result.locked) {
    return new HttpsError("resource-exhausted", `비밀번호를 ${lib.MAX_FAILS}회 틀려 10분간 잠겼습니다. 10분 후 다시 시도하세요.`, { code: "locked", retryMinutes: 10 });
  }
  return new HttpsError("unauthenticated", `${GENERIC_FAIL} ${lib.MAX_FAILS}회 틀리면 10분간 잠깁니다. (남은 시도 ${result.remaining}회)`, { code: "bad-credentials", remaining: result.remaining });
}

exports.employeeLogin = onCall(opts, async request => {
  const userId = lib.normalizeText(request.data && request.data.userId);
  const pw = request.data && request.data.pw;
  if (!userId || pw == null || String(pw) === "" || userId.length > 60 || String(pw).length > 128) {
    throw new HttpsError("invalid-argument", "ID와 비밀번호를 모두 입력하세요.");
  }
  const lockRef = db.doc(`loginFails/${lib.lockKey(userId)}`);
  await assertNotLocked(lockRef);

  const doc = await findAccountByUserId(userId);
  let verdict = { ok: false };
  if (doc) verdict = await lib.verifyAccountPassword(doc.data(), pw);
  else await lib.hashPassword("dummy"); // 존재 여부가 응답 시간으로 드러나지 않게
  if (!doc || !verdict.ok) throw failError(await recordFailure(lockRef));

  const patch = {};
  if (verdict.upgrade !== undefined) {
    Object.assign(patch, await lib.hashPassword(verdict.upgrade), { pw: FieldValue.delete(), passwordStatus: "initial" });
    await doc.ref.set(patch, { merge: true });
  }
  await lockRef.delete().catch(() => {});
  const fresh = patch.pwHash ? await doc.ref.get() : doc;
  const data = fresh.data();
  const status = lib.passwordState(data);
  await db.doc(`accountStatus/${doc.id}`).set({ passwordStatus: status, pwChangedAt: lib.toMillis(data.pwChangedAt) || null, updatedAt: FieldValue.serverTimestamp() });
  const token = await getAuth().createCustomToken(`emp_${doc.id}`, { role: "employee", aid: doc.id });
  return { token, profile: { ...sessionProfile(fresh, status), pwChangedAt: lib.toMillis(data.pwChangedAt) || null } };
});

exports.changePassword = onCall(opts, async request => {
  const aid = request.auth && request.auth.token && request.auth.token.aid;
  if (!aid || request.auth.token.role !== "employee") throw new HttpsError("unauthenticated", "다시 로그인한 뒤 변경해 주세요.");
  const current = request.data && request.data.current, next = request.data && request.data.next;
  if (current == null || next == null) throw new HttpsError("invalid-argument", "현재 비밀번호와 새 비밀번호를 입력하세요.");
  const ref = db.doc(`accounts/${aid}`), snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "계정을 찾을 수 없습니다. 총무부에 문의하세요.");
  const account = snap.data();
  const lockRef = db.doc(`loginFails/${lib.lockKey(account.userId)}`);
  await assertNotLocked(lockRef);
  const verdict = await lib.verifyAccountPassword(account, current);
  if (!verdict.ok) {
    const r = await recordFailure(lockRef);
    if (r.locked) throw failError(r);
    throw new HttpsError("permission-denied", `현재 비밀번호가 맞지 않습니다. ${lib.MAX_FAILS}회 틀리면 10분간 잠깁니다. (남은 시도 ${r.remaining}회)`, { code: "bad-current", remaining: r.remaining });
  }
  const n = String(next).trim();
  if (!lib.validNewPassword(n)) throw new HttpsError("invalid-argument", "새 비밀번호는 영문과 숫자를 모두 포함해 8자 이상(특수문자 제외)이어야 합니다.");
  if (n === lib.normalizeText(current)) throw new HttpsError("invalid-argument", "현재 비밀번호와 다른 비밀번호를 입력하세요.");
  if (n.toLowerCase() === lib.INITIAL_PASSWORD || n.toLowerCase() === lib.normalizeText(account.userId).toLowerCase()) {
    throw new HttpsError("invalid-argument", "초기 비밀번호나 ID와 같은 비밀번호는 사용할 수 없습니다.");
  }
  await ref.set({
    ...(await lib.hashPassword(n)), pwCaseInsensitive: false, passwordStatus: "changed",
    pwChangedAt: FieldValue.serverTimestamp(), pw: FieldValue.delete()
  }, { merge: true });
  await db.doc(`accountStatus/${aid}`).set({ passwordStatus: "changed", pwChangedAt: Date.now(), updatedAt: FieldValue.serverTimestamp() });
  await lockRef.delete().catch(() => {});
  return { ok: true, passwordStatus: "changed", pwChangedAt: Date.now() };
});

async function assertAdmin(request) {
  const t = request.auth && request.auth.token;
  if (!t || !t.email || t.email_verified !== true) throw new HttpsError("permission-denied", "관리자 Google 로그인이 필요합니다.");
  const email = String(t.email).trim().toLowerCase();
  if (email === ROOT_ADMIN_EMAIL) return email;
  const snap = await db.doc(`adminAccess/${email}`).get();
  if (!snap.exists || snap.data().active !== true) throw new HttpsError("permission-denied", "관리자 권한이 없습니다.");
  return email;
}

exports.adminSetPassword = onCall(opts, async request => {
  const email = await assertAdmin(request);
  const aids = Array.isArray(request.data && request.data.aids) ? request.data.aids.map(String).slice(0, 200) : [];
  if (!aids.length) throw new HttpsError("invalid-argument", "대상 계정이 없습니다.");
  const password = request.data.password == null || request.data.password === "" ? lib.INITIAL_PASSWORD : String(request.data.password);
  if (password.length < 4 || password.length > 64) throw new HttpsError("invalid-argument", "초기 비밀번호는 4~64자여야 합니다.");
  const reason = String(request.data.reason || "관리자 비밀번호 초기화").slice(0, 200);
  const operatorName = String(request.data.operatorName || "").slice(0, 30);
  const done = [];
  for (const aid of aids) {
    const ref = db.doc(`accounts/${aid}`), snap = await ref.get();
    if (!snap.exists) continue;
    const a = snap.data();
    await ref.set({
      ...(await lib.hashPassword(password)), pwCaseInsensitive: false, passwordStatus: "initial", initialPasswordVersion: 2,
      userId: a.userId || a.name, pw: FieldValue.delete()
    }, { merge: true });
    await db.doc(`accountStatus/${aid}`).set({ passwordStatus: "initial", pwChangedAt: null, updatedAt: FieldValue.serverTimestamp() });
    await db.doc(`loginFails/${lib.lockKey(a.userId || a.name)}`).delete().catch(() => {});
    await db.collection("auditLogs").add({
      operation: "update", collection: "accounts", targetId: aid, label: a.name || aid,
      operatorName: operatorName || "미확인", adminEmail: email, adminUid: request.auth.uid, reason,
      before: { passwordStatus: a.passwordStatus || "" }, after: { passwordStatus: "initial", pw: "[보호됨]" },
      createdAt: new Date().toISOString(), serverAt: FieldValue.serverTimestamp()
    });
    done.push(aid);
  }
  return { ok: true, count: done.length };
});
