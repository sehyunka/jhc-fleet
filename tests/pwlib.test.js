"use strict";
const assert = require("assert");
const lib = require("../functions/pwlib");
(async () => {
  const h = await lib.hashPassword("Abcd1234");
  assert.strictEqual(h.pwIter, 200000);
  assert.strictEqual(h.pwHash.length, 64);
  assert.ok(await lib.verifyHash("Abcd1234", h.pwHash, h.pwSalt, h.pwIter), "정상 비밀번호");
  assert.ok(!(await lib.verifyHash("abcd1234", h.pwHash, h.pwSalt, h.pwIter)), "대소문자 구분");
  const h2 = await lib.hashPassword("Abcd1234");
  assert.notStrictEqual(h.pwSalt, h2.pwSalt, "사용자별 salt");
  assert.notStrictEqual(h.pwHash, h2.pwHash);

  const acct = { ...h, passwordStatus: "changed" };
  assert.ok((await lib.verifyAccountPassword(acct, "Abcd1234")).ok);
  assert.ok(!(await lib.verifyAccountPassword(acct, "abcd1234")).ok);
  const ci = { ...(await lib.hashPassword("abcd1234")), pwCaseInsensitive: true, passwordStatus: "initial" };
  assert.ok((await lib.verifyAccountPassword(ci, "ABCD1234")).ok, "구버전 대소문자 무시 계정");
  const legacy = { pw: "가세현", passwordStatus: "initial" };
  const lv = await lib.verifyAccountPassword(legacy, "가세현");
  assert.ok(lv.ok && lv.upgrade === "가세현", "평문 → 해시 승급 신호");
  assert.ok(!(await lib.verifyAccountPassword(legacy, "틀림")).ok);
  assert.ok((await lib.verifyAccountPassword({ passwordStatus: "initial" }, "1234")).ok, "해시 없는 초기 계정");
  assert.ok(!(await lib.verifyAccountPassword({ passwordStatus: "changed" }, "1234")).ok, "해시 없고 changed면 거부");
  assert.ok(!(await lib.verifyAccountPassword({}, "1234")).ok);

  for (const bad of ["abc12", "abcdefgh", "12345678", "Abcd123!", "Abcd 1234", ""]) assert.ok(!lib.validNewPassword(bad), "거부: " + bad);
  for (const good of ["Abcd1234", "abcd1234", "A1b2c3d4e5"]) assert.ok(lib.validNewPassword(good), "허용: " + good);
  assert.strictEqual(lib.lockKey(" 가세현 "), lib.lockKey("가세현"));
  assert.ok(lib.safeEqual("a", "a") && !lib.safeEqual("a", "ab"));
  const t0 = Date.now(); await lib.verifyHash("x", h.pwHash, h.pwSalt, h.pwIter);
  console.log("PASS pwlib (PBKDF2 1회 약 " + (Date.now() - t0) + "ms)");
})().catch(e => { console.error("FAIL", e); process.exit(1); });
