/* 평문 비밀번호(accounts.pw) → PBKDF2 해시 일괄 전환 + users / accountStatus 사본 생성
 *
 * 사용 (반드시 순서대로):
 *   1) 백업: gcloud firestore export gs://<버킷>/backup-YYYYMMDD --project jhc-fleet
 *   2) 점검(기본, 아무것도 쓰지 않음): node tools/migrate-hash.mjs
 *   3) 실행:                            node tools/migrate-hash.mjs --apply --backup-done
 *
 * 인증: 관리자 키 파일을 코드나 저장소에 두지 않습니다.
 *       gcloud auth application-default login  (본인 Google 계정, 1회) 후 실행하세요.
 *
 * 동작: pw → pwHash/pwSalt/pwIter, pw 필드 삭제, passwordStatus="initial"(모두 비밀번호 재설정 대상),
 *       users/{id}(이름·부서·차량 등 비밀번호 없는 사본)와 accountStatus/{id} 생성.
 *       운영 데이터(운행·정비·휴가 등)는 읽거나 수정하지 않으며 어떤 문서도 삭제하지 않습니다.
 *       비밀번호 값은 화면·로그에 출력하지 않습니다. 이미 해시된 계정은 건너뛰므로 재실행해도 안전합니다.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fnDir = path.join(here, "..", "functions");
const require = createRequire(path.join(fnDir, "package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const lib = require(path.join(fnDir, "pwlib.js"));

const apply = process.argv.includes("--apply");
const backupDone = process.argv.includes("--backup-done");
if (apply && !backupDone) {
  console.error("중단: --apply 에는 Firestore 백업 확인(--backup-done)이 필요합니다. 먼저 gcloud firestore export 로 백업하세요.");
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: "jhc-fleet" });
const db = getFirestore();

function mirror(a) {
  const raw = Array.isArray(a.vehicles) && a.vehicles.length ? a.vehicles : (a.vehicle ? [a.vehicle] : []);
  const vehicles = [...new Set(raw.filter(Boolean))].slice(0, 3);
  return { name: a.name || "", dept: a.dept || "", title: a.title || "", vehicle: vehicles[0] || "", vehicles, sharedVehicleAccess: a.sharedVehicleAccess === true };
}

const snap = await db.collection("accounts").get();
const plan = [];
for (const d of snap.docs) {
  const a = d.data();
  const hasPlain = a.pw != null && String(a.pw) !== "";
  const hasHash = !!(a.pwHash && a.pwSalt);
  plan.push({ ref: d.ref, id: d.id, a, hasPlain, hasHash });
}
const toHash = plan.filter(p => p.hasPlain);
const alreadyHashed = plan.filter(p => !p.hasPlain && p.hasHash);
const noPw = plan.filter(p => !p.hasPlain && !p.hasHash);
console.log(`계정 ${plan.length}개 · 해시 전환 대상 ${toHash.length} · 이미 해시 ${alreadyHashed.length} · 비밀번호 없음(초기 1234 처리) ${noPw.length}`);

if (!apply) {
  console.log("점검 모드입니다. 아무것도 변경하지 않았습니다. 실행하려면: node tools/migrate-hash.mjs --apply --backup-done");
  process.exit(0);
}

let ops = [];
for (const p of plan) {
  const upd = {};
  if (p.hasPlain) {
    const pw = lib.normalizeText(p.a.pw);
    const candidate = p.a.pwCaseInsensitive === true ? pw.toLowerCase() : pw;
    Object.assign(upd, await lib.hashPassword(candidate), { pw: FieldValue.delete(), passwordStatus: "initial" });
    ops.push([p.ref, upd, true]);
  }
  ops.push([db.doc(`users/${p.id}`), mirror(p.a), false]);
  if (p.hasPlain || !p.hasHash) ops.push([db.doc(`accountStatus/${p.id}`), { passwordStatus: "initial", updatedAt: FieldValue.serverTimestamp() }, false]);
  else ops.push([db.doc(`accountStatus/${p.id}`), { passwordStatus: p.a.passwordStatus === "changed" ? "changed" : "initial", updatedAt: FieldValue.serverTimestamp() }, false]);
}
for (let i = 0; i < ops.length; i += 400) {
  const batch = db.batch();
  for (const [ref, data, merge] of ops.slice(i, i + 400)) merge ? batch.set(ref, data, { merge: true }) : batch.set(ref, data);
  await batch.commit();
}
await db.collection("auditLogs").add({
  operation: "update", collection: "accounts", targetId: "*", label: "비밀번호 해시 전환(마이그레이션)",
  operatorName: "migrate-hash.mjs", adminEmail: "", adminUid: "", reason: "[audit-20261010] 평문 비밀번호 해시 전환",
  before: { plaintext: toHash.length }, after: { hashed: toHash.length, pw: "[보호됨]" },
  createdAt: new Date().toISOString(), serverAt: FieldValue.serverTimestamp()
});

const verify = await db.collection("accounts").get();
const leftover = verify.docs.filter(d => d.data().pw != null).length;
const mirrored = (await db.collection("users").get()).size;
console.log(`완료: 평문 비밀번호 남은 계정 ${leftover}개 (0이어야 함) · users 사본 ${mirrored}개`);
process.exit(leftover ? 1 : 0);
