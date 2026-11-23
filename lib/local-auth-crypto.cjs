"use strict";

const {
  randomBytes,
  createHash,
  timingSafeEqual,
  scrypt
} = require("node:crypto");
const { promisify } = require("node:util");

const derive = promisify(scrypt);
const SCRYPT_OPTIONS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
});

function validPassword(password) {
  return typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128 &&
    Buffer.byteLength(password, "utf8") <= 256;
}

async function hashPassword(password) {
  if (!validPassword(password)) {
    throw new Error("Password must contain 12-128 characters");
  }

  const salt = randomBytes(32);
  const key = await derive(
    password,
    salt,
    64,
    SCRYPT_OPTIONS
  );

  return [
    "scrypt",
    "v1",
    salt.toString("hex"),
    key.toString("hex")
  ].join("$");
}

async function verifyPassword(password, encoded) {
  if (!validPassword(password) ||
      typeof encoded !== "string") {
    return false;
  }

  const parts = encoded.split("$");
  if (
    parts.length !== 4 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "v1" ||
    !/^[a-f0-9]{64}$/.test(parts[2]) ||
    !/^[a-f0-9]{128}$/.test(parts[3])
  ) {
    return false;
  }

  const expected = Buffer.from(parts[3], "hex");
  const actual = await derive(
    password,
    Buffer.from(parts[2], "hex"),
    64,
    SCRYPT_OPTIONS
  );

  return timingSafeEqual(actual, expected);
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  if (typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("Invalid session token");
  }

  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

function sessionCookie(token, secure = false) {
  if (token !== "" &&
      (typeof token !== "string" ||
       !/^[A-Za-z0-9_-]{43}$/.test(token))) {
    throw new Error("Invalid session token");
  }

  return [
    `kk_local_session=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=" + (token ? 28800 : 0),
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

module.exports = Object.freeze({
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashSessionToken,
  sessionCookie
});
