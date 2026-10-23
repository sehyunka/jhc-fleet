"use strict";
/* Firestore 보안 규칙 테스트 (에뮬레이터).
   실행: cd "C:\AI Test\JHC Korea_Car Tracking\car-app\tests" ; npm install ; npm test
   "막혀야 할 요청이 막히는지"와 "정상 요청이 되는지"를 함께 확인합니다. */
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, serverTimestamp, increment } = require("firebase/firestore");

const PROJECT = "demo-jhc";
let env, passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); passed++; console.log("  PASS", name); }
  catch (e) { failed++; console.log("  FAIL", name, "\n      ", String(e.message || e).split("\n")[0]); }
}

(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"), host, port: Number(port) }
  });

  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "accounts/a1"), { name: "가세현", userId: "가세현", pwHash: "x", pwSalt: "y", passwordStatus: "changed" });
    await setDoc(doc(db, "accounts/b2"), { name: "홍길동", userId: "홍길동", pwHash: "x", pwSalt: "y", passwordStatus: "initial" });
    await setDoc(doc(db, "users/a1"), { name: "가세현", dept: "인사총무팀", vehicles: ["12가3456"], sharedVehicleAccess: true });
    await setDoc(doc(db, "vehicles/v1"), { plate: "12가3456", model: "테스트" });
    await setDoc(doc(db, "settings/main"), { extraHolidays: "" });
    await setDoc(doc(db, "notices/n1"), { title: "공지" });
    await setDoc(doc(db, "trips/t1"), { uid: "a1", vehicle: "12가3456", date: "2026-10-12", status: "운행중", startKm: 100, endKm: null });
    await setDoc(doc(db, "accountStatus/a1"), { passwordStatus: "changed" });
    await setDoc(doc(db, "accountStatus/b2"), { passwordStatus: "initial" });
    await setDoc(doc(db, "loginFails/zz"), { count: 3 });
    await setDoc(doc(db, "selfHolidayReports/a1_2026-10-20"), { aid: "a1", name: "가세현", dept: "인사총무팀", date: "2026-10-20", kind: "leave", by: "self" });
    await setDoc(doc(db, "selfHolidayReports/b2_2026-10-20"), { aid: "b2", name: "홍길동", dept: "x", date: "2026-10-20", kind: "leave", by: "self" });
    await setDoc(doc(db, "adminAccess/other@example.com"), { active: true, name: "관리자2" });
  });

  const anon = env.unauthenticatedContext().firestore();
  // 실제 로그인 토큰처럼 로그인 시각(auth_time)을 현재로 지정합니다. (테스트 도구 기본값은 1970년 = 0)
  const loginNow = Math.floor(Date.now() / 1000);
  const emp = env.authenticatedContext("emp_a1", { role: "employee", aid: "a1", iat: loginNow, auth_time: loginNow }).firestore();
  const googleUser = env.authenticatedContext("g1", { email: "stranger@example.com", email_verified: true }).firestore();
  const admin = env.authenticatedContext("adm", { email: "sehyun.ka@gmail.com", email_verified: true }).firestore();
  const listedAdmin = env.authenticatedContext("adm2", { email: "other@example.com", email_verified: true }).firestore();
  const unverifiedAdmin = env.authenticatedContext("adm3", { email: "sehyun.ka@gmail.com", email_verified: false }).firestore();

  console.log("[필수] 비로그인 차단");
  await test("비인증 accounts 단건 읽기 거부", () => assertFails(getDoc(doc(anon, "accounts/a1"))));
  await test("비인증 accounts 전체 목록 거부", () => assertFails(getDocs(collection(anon, "accounts"))));
  await test("비인증 accounts pw 수정 거부", () => assertFails(updateDoc(doc(anon, "accounts/a1"), { pw: "hacked" })));
  await test("비인증 accounts 해시 덮어쓰기 거부", () => assertFails(updateDoc(doc(anon, "accounts/a1"), { pwHash: "z", passwordStatus: "changed" })));
  await test("비인증 trips 생성 거부", () => assertFails(setDoc(doc(anon, "trips/x1"), { uid: "a1", vehicle: "v" })));
  await test("비인증 trips 읽기 거부", () => assertFails(getDoc(doc(anon, "trips/t1"))));
  await test("비인증 settings/vehicles/notices/users 읽기 거부", async () => {
    for (const p of ["settings/main", "vehicles/v1", "notices/n1", "users/a1"]) await assertFails(getDoc(doc(anon, p)));
  });
  await test("비인증 pushTokens 생성 거부", () => assertFails(setDoc(doc(anon, "pushTokens/t"), { token: "t", aid: "a1", name: "n", dept: "d", active: true, updatedAt: serverTimestamp() })));
  await test("비인증 maintenance·selfHolidayReports 생성 거부", async () => {
    await assertFails(setDoc(doc(anon, "maintenance/m1"), { uid: "a1", vehicle: "v" }));
    await assertFails(setDoc(doc(anon, "selfHolidayReports/a1_2026-11-01"), { aid: "a1", date: "2026-11-01", by: "self" }));
  });

  console.log("[필수] 로그인 직원의 제한");
  await test("직원이 accounts 읽기 거부", () => assertFails(getDoc(doc(emp, "accounts/a1"))));
  await test("직원이 본인 accounts 의 pw·상태 수정 거부", () => assertFails(updateDoc(doc(emp, "accounts/a1"), { pw: "new", passwordStatus: "changed" })));
  await test("직원이 타인 aid(uid)로 trips 생성 거부", () => assertFails(setDoc(doc(emp, "trips/x2"), { uid: "b2", vehicle: "12가3456", date: "2026-10-12", status: "운행중" })));
  await test("정상 직원 운행 시작(본인 uid) 성공", () => assertSucceeds(setDoc(doc(emp, "trips/x3"), { uid: "a1", vehicle: "12가3456", date: "2026-10-12", startKm: 1, status: "운행중" })));
  await test("본인 운행 종료 필드 수정 성공", () => assertSucceeds(updateDoc(doc(emp, "trips/t1"), { endKm: 150, dist: 50, status: "완료" })));
  await test("본인 운행의 차량·소유자 변경 거부", async () => {
    await assertFails(updateDoc(doc(emp, "trips/t1"), { vehicle: "다른차량" }));
    await assertFails(updateDoc(doc(emp, "trips/t1"), { uid: "b2" }));
  });
  await test("타인 운행 수정 거부", async () => {
    await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), "trips/t9"), { uid: "b2", status: "운행중" }));
    await assertFails(updateDoc(doc(emp, "trips/t9"), { endKm: 1, status: "완료" }));
  });
  await test("직원 trips 삭제 거부", () => assertFails(deleteDoc(doc(emp, "trips/t1"))));
  await test("직원은 settings/vehicles/notices/users/trips 읽기 성공", async () => {
    for (const p of ["settings/main", "vehicles/v1", "notices/n1", "users/a1", "trips/t1"]) await assertSucceeds(getDoc(doc(emp, p)));
  });
  await test("직원의 settings/vehicles/notices/users 쓰기 거부", async () => {
    await assertFails(setDoc(doc(emp, "settings/main"), { extraHolidays: "x" }));
    await assertFails(setDoc(doc(emp, "vehicles/v2"), { plate: "x" }));
    await assertFails(setDoc(doc(emp, "notices/n2"), { title: "x" }));
    await assertFails(updateDoc(doc(emp, "users/a1"), { sharedVehicleAccess: false }));
  });
  await test("본인 accountStatus 읽기 성공 / 타인 읽기 거부 / 쓰기 거부", async () => {
    await assertSucceeds(getDoc(doc(emp, "accountStatus/a1")));
    await assertFails(getDoc(doc(emp, "accountStatus/b2")));
    await assertFails(setDoc(doc(emp, "accountStatus/a1"), { passwordStatus: "changed" }));
  });
  await test("loginFails 클라이언트 접근 거부", async () => {
    await assertFails(getDoc(doc(emp, "loginFails/zz")));
    await assertFails(setDoc(doc(emp, "loginFails/zz"), { count: 0 }));
    await assertFails(getDoc(doc(admin, "loginFails/zz")));
  });
  await test("pushTokens: 본인 aid 등록 성공 / 타인 aid 거부 / 필드 초과 거부", async () => {
    const base = { token: "tok", aid: "a1", name: "n", dept: "d", active: true, updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(emp, "pushTokens/tk1"), base));
    await assertFails(setDoc(doc(emp, "pushTokens/tk2"), { ...base, aid: "b2" }));
    await assertFails(setDoc(doc(emp, "pushTokens/tk3"), { ...base, admin: true }));
    await assertFails(getDoc(doc(emp, "pushTokens/tk1")));
  });
  await test("maintenance: 본인 uid 등록 성공 / 타인 uid 거부 / 수정·삭제 거부", async () => {
    await assertSucceeds(setDoc(doc(emp, "maintenance/m1"), { uid: "a1", vehicle: "v", item: "엔진오일" }));
    await assertFails(setDoc(doc(emp, "maintenance/m2"), { uid: "b2", vehicle: "v" }));
    await assertFails(updateDoc(doc(emp, "maintenance/m1"), { item: "변경" }));
    await assertFails(deleteDoc(doc(emp, "maintenance/m1")));
  });
  await test("selfHolidayReports: 본인 등록·취소 성공 / 타인 거부", async () => {
    const mine = { aid: "a1", name: "가세현", dept: "d", date: "2026-11-02", kind: "leave", by: "self", reportedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(emp, "selfHolidayReports/a1_2026-11-02"), mine));
    await assertFails(setDoc(doc(emp, "selfHolidayReports/b2_2026-11-02"), { ...mine, aid: "b2" }));
    await assertFails(setDoc(doc(emp, "selfHolidayReports/a1_2026-11-03"), mine));
    await assertFails(setDoc(doc(emp, "selfHolidayReports/a1_2026-11-04"), { ...mine, date: "2026-11-04", by: "admin" }));
    await assertSucceeds(deleteDoc(doc(emp, "selfHolidayReports/a1_2026-11-02")));
    await assertFails(deleteDoc(doc(emp, "selfHolidayReports/b2_2026-10-20")));
  });

  console.log("[필수] 임의 Google 계정·미인증 이메일 차단");
  await test("관리자 아닌 Google 계정은 vehicles·accounts 읽기 거부", async () => {
    await assertFails(getDoc(doc(googleUser, "vehicles/v1")));
    await assertFails(getDoc(doc(googleUser, "accounts/a1")));
  });
  await test("이메일 미인증 토큰은 관리자 권한 없음", () => assertFails(getDoc(doc(unverifiedAdmin, "accounts/a1"))));

  console.log("[필수] 30일 로그인 만료");
  const nowSec = Math.floor(Date.now() / 1000);
  const empOld = env.authenticatedContext("emp_a1", { role: "employee", aid: "a1", iat: nowSec, auth_time: nowSec - 31 * 86400 }).firestore();
  const empRecent = env.authenticatedContext("emp_a1", { role: "employee", aid: "a1", iat: nowSec, auth_time: nowSec - 29 * 86400 }).firestore();
  const empNoTime = env.authenticatedContext("emp_a1", { role: "employee", aid: "a1" }).firestore();
  await test("로그인 시각 없는(0) 직원 토큰은 거부", () => assertFails(getDoc(doc(empNoTime, "vehicles/v1"))));
  await test("로그인 31일 지난 직원 토큰은 읽기·쓰기 거부", async () => {
    await assertFails(getDoc(doc(empOld, "vehicles/v1")));
    await assertFails(setDoc(doc(empOld, "trips/old1"), { uid: "a1", vehicle: "12가3456" }));
  });
  await test("로그인 29일 된 직원 토큰은 허용", () => assertSucceeds(getDoc(doc(empRecent, "vehicles/v1"))));

  console.log("[필수] 관리자");
  await test("관리자 accounts 읽기·수정 성공", async () => {
    await assertSucceeds(getDoc(doc(admin, "accounts/a1")));
    await assertSucceeds(getDocs(collection(admin, "accounts")));
    await assertSucceeds(updateDoc(doc(admin, "accounts/b2"), { dept: "변경" }));
  });
  await test("등록된 관리자(adminAccess) accounts 읽기 성공", () => assertSucceeds(getDoc(doc(listedAdmin, "accounts/a1"))));
  await test("관리자 users 미러 쓰기·trips 삭제 성공", async () => {
    await assertSucceeds(setDoc(doc(admin, "users/b2"), { name: "홍길동", dept: "x" }));
    await assertSucceeds(deleteDoc(doc(admin, "trips/t9")));
  });
  await test("관리자도 accountStatus 쓰기 거부(함수 전용)", () => assertFails(setDoc(doc(admin, "accountStatus/a1"), { passwordStatus: "changed" })));

  console.log("[필수] 접속 기록(usageDaily) [usage-20261021]");
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const u = (extra = {}) => ({ day: today, aid: "a1", name: "가세현", dept: "인사총무팀", opens: increment(1), hours: { "09": increment(1) }, last: serverTimestamp(), mode: "app", device: "phone", ...extra });
  await test("직원 본인 접속 기록 생성 허용", () => assertSucceeds(setDoc(doc(emp, `usageDaily/${today}_a1`), u(), { merge: true })));
  await test("직원 본인 접속 기록 +1 허용", () => assertSucceeds(setDoc(doc(emp, `usageDaily/${today}_a1`), u(), { merge: true })));
  await test("남의 aid 접속 기록 거부", () => assertFails(setDoc(doc(emp, `usageDaily/${today}_b2`), u({ aid: "b2" }), { merge: true })));
  await test("문서 ID 날짜 불일치 거부", () => assertFails(setDoc(doc(emp, "usageDaily/2020-01-01_a1"), u(), { merge: true })));
  await test("허용 외 필드 거부", () => assertFails(setDoc(doc(emp, `usageDaily/${today}_a1`), u({ extra: 1 }), { merge: true })));
  await test("opens 임의값 거부", () => assertFails(setDoc(doc(emp, `usageDaily/${today}_a1`), u({ opens: 50 }), { merge: true })));
  await test("직원 접속 기록 읽기 거부", () => assertFails(getDoc(doc(emp, `usageDaily/${today}_a1`))));
  await test("관리자 접속 기록 읽기 허용", () => assertSucceeds(getDoc(doc(admin, `usageDaily/${today}_a1`))));
  await test("비로그인 접속 기록 쓰기 거부", () => assertFails(setDoc(doc(anon, `usageDaily/${today}_a1`), u(), { merge: true })));
  await test("직원 접속 기록 삭제 거부", () => assertFails(deleteDoc(doc(emp, `usageDaily/${today}_a1`))));

  await env.cleanup();
  console.log(`\n결과: ${passed} 통과 / ${failed} 실패`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
