"use strict";
/* 비밀번호 해시·검증 보조 모듈 (함수 export 없음 — 단위 테스트 가능) */
const crypto = require("crypto");
const { promisify } = require("util");

const pbkdf2 = promisify(crypto.pbkdf2);
const ITER = 200000;
const KEYLEN = 32;
const DIGEST = "sha256";
const INITIAL_PASSWORD = "1234";
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;
const PW_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 비밀번호 90일마다 변경

function normalizeText(value) {
  return String(value == null ? "" : value).replace(/[​-‍⁠﻿]/g, "").normalize("NFC").trim();
}

async function hashPassword(password, saltHex, iter = ITER) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = await pbkdf2(String(password), salt, iter, KEYLEN, DIGEST);
  return { pwHash: hash.toString("hex"), pwSalt: salt.toString("hex"), pwIter: iter };
}

async function verifyHash(password, pwHash, pwSalt, iter = ITER) {
  if (!pwHash || !pwSalt) return false;
  const expected = Buffer.from(pwHash, "hex");
  const actual = await pbkdf2(String(password), Buffer.from(pwSalt, "hex"), Number(iter) || ITER, expected.length, DIGEST);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  const len = Math.max(x.length, y.length, 1);
  const px = Buffer.alloc(len), py = Buffer.alloc(len);
  x.copy(px); y.copy(py);
  return crypto.timingSafeEqual(px, py) && x.length === y.length;
}

/* 새 비밀번호 규칙: 영문+숫자 8~64자, 특수문자 불가, 대소문자 구분 */
function validNewPassword(value) {
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,64}$/.test(String(value));
}

function lockKey(userId) {
  return crypto.createHash("sha256").update(normalizeText(userId).toLowerCase()).digest("hex");
}

/* 계정 문서로 입력 비밀번호를 검증. 반환: {ok, upgrade?} (upgrade: 평문 → 해시 자동 승급 필요) */
async function verifyAccountPassword(account, entered) {
  const pw = normalizeText(entered);
  const ci = account.pwCaseInsensitive === true;
  const candidate = ci ? pw.toLowerCase() : pw;
  if (account.pwHash && account.pwSalt) {
    return { ok: await verifyHash(candidate, account.pwHash, account.pwSalt, account.pwIter) };
  }
  if (account.pw != null && String(account.pw) !== "") {
    const stored = normalizeText(account.pw);
    const ok = safeEqual(ci ? stored.toLowerCase() : stored, candidate);
    return { ok, upgrade: ok ? candidate : undefined };
  }
  if (account.passwordStatus === "initial") {
    return { ok: safeEqual(pw, INITIAL_PASSWORD) };
  }
  return { ok: false };
}

function toMillis(v) {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  const t = Date.parse(v); return Number.isFinite(t) ? t : 0;
}

/* 비밀번호 상태: initial(초기·재설정) / expired(변경 후 90일 경과) / changed */
function passwordState(account, now = Date.now()) {
  if (!account || account.passwordStatus !== "changed" || !account.pwHash) return "initial";
  const changedAt = toMillis(account.pwChangedAt);
  if (!changedAt || now - changedAt > PW_MAX_AGE_MS) return "expired";
  return "changed";
}

module.exports = {
  ITER, INITIAL_PASSWORD, MAX_FAILS, LOCK_MS, PW_MAX_AGE_MS, passwordState, toMillis,
  normalizeText, hashPassword, verifyHash, safeEqual, validNewPassword, lockKey, verifyAccountPassword
};
