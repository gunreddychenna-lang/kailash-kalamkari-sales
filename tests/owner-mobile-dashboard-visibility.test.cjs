"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Owner mobile view never hides the existing dashboard", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "owner-mobile-sales.css"), "utf8");
  assert.doesNotMatch(css, /#standard-main\\s*>\\s*:not\\(#kk-owner-mobile-sales\\)\\s*\\{\\s*display\\s*:\\s*none/i);
  assert.match(css, /body\\.kk-owner-mobile-active\\s+#kk-owner-mobile-sales\\s*\\{\\s*display\\s*:\\s*none\\s*!important/i);
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /id="standard-main"/);
  assert.match(html, /id="kk-owner-mobile-sales"/);
});
