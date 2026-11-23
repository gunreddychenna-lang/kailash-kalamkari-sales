"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const auth = require("../lib/local-auth-crypto.cjs");

test("password hashing and verification", async () => {
  const password = "Correct-Horse-Battery-2026!";
  const hash = await auth.hashPassword(password);

  assert.match(hash, /^scrypt\$v1\$/);
  assert.equal(
    await auth.verifyPassword(password, hash),
    true
  );
  assert.equal(
    await auth.verifyPassword("Incorrect-Password-2026!", hash),
    false
  );
});

test("unique salted hashes", async () => {
  const password = "Another-Strong-Password-2026";
  const first = await auth.hashPassword(password);
  const second = await auth.hashPassword(password);

  assert.notEqual(first, second);
});

test("invalid passwords are rejected", async () => {
  await assert.rejects(
    auth.hashPassword("short"),
    /Password/
  );

  assert.equal(
    await auth.verifyPassword("short", "bad-hash"),
    false
  );
});

test("session tokens are random and stored as hashes", () => {
  const first = auth.createSessionToken();
  const second = auth.createSessionToken();

  assert.notEqual(first, second);
  assert.equal(first.length, 43);

  const hash = auth.hashSessionToken(first);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!hash.includes(first));

  assert.throws(() => auth.hashSessionToken("invalid"));
});

test("session cookie is HttpOnly and SameSite", () => {
  const token = auth.createSessionToken();
  const cookie = auth.sessionCookie(token, true);

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=28800/);

  const cleared = auth.sessionCookie("", true);
  assert.match(cleared, /Max-Age=0/);
});
