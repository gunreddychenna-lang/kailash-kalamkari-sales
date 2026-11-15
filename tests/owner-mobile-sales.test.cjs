"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness() {
  const elements = new Map();
  const events = new Map();
  function element(tag = "div") {
    return {
      tagName: tag.toUpperCase(), children: [], textContent: "", className: "", disabled: false,
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...nodes) { this.children = nodes; },
      addEventListener(event, listener) { events.set(this.id + ":" + event, listener); }
    };
  }
  for (const id of ["kk-owner-mobile-body", "kk-owner-mobile-count", "kk-owner-mobile-prev", "kk-owner-mobile-next"]) {
    const el = element(); el.id = id; elements.set(id, el);
  }
  const classes = new Set();
  const document = {
    body: { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } },
    getElementById(id) { return elements.get(id) || null; },
    createElement: element,
    addEventListener(event, callback) { events.set("document:" + event, callback); }
  };
  const window = {};
  const context = vm.createContext({ window, document, Number, String, Map, Set, Array, Intl });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "owner-mobile-sales.js"), "utf8"), context);
  events.get("document:DOMContentLoaded")();
  return { show: window.KKOwnerMobileSales.show, elements, classes, events };
}
function sale(key, overrides = {}) {
  return {
    "Bill Key": key, "Bill Date": "2026-11-14", "Store": "C",
    "SM Name": "Staff A", "Sale type": "Wholesale", "Invoice Total": 12500,
    "Bank Allocations": [{ account: "SBI", amount: 7500 }, { account: "Cash", amount: 5000 }],
    ...overrides
  };
}
const values = row => row.children.map(cell => cell.textContent);

test("Owner mobile report uses exactly seven columns, TBH and invoice totals once", () => {
  const h = harness();
  h.show("owner", [sale("C/101"), sale("C/101", { "Invoice Total": 999999 })]);
  assert.equal(h.classes.has("kk-owner-mobile-active"), true);
  assert.equal(h.elements.get("kk-owner-mobile-body").children.length, 1);
  assert.deepEqual(values(h.elements.get("kk-owner-mobile-body").children[0]), [
    "2026-11-14", "C", "Staff A", "TBH", "₹12,500.00", "SBI, Cash", "—"
  ]);
});
test("Online/Offline display and most-recent-first sorting", () => {
  const h = harness();
  h.show("owner", [
    sale("A", { "Bill Date": "2026-11-12", "Sale type": "Online", "Bank Allocations": [] }),
    sale("B", { "Bill Date": "2026-11-15", "Sale type": "Offline" })
  ]);
  const rows = h.elements.get("kk-owner-mobile-body").children;
  assert.equal(rows[0].children[3].textContent, "Offline");
  assert.equal(rows[1].children[3].textContent, "Online");
  assert.equal(rows[1].children[5].textContent, "—");
});
test("Unauthorized roles do not activate owner mobile view", () => {
  for (const role of ["admin", "employee", "", null]) {
    const h = harness();
    h.show(role, [sale("A")]);
    assert.equal(h.classes.has("kk-owner-mobile-active"), false);
    assert.equal(h.elements.get("kk-owner-mobile-body").children.length, 0);
  }
});
test("Pagination caps each rendered page at 100 invoices", () => {
  const h = harness();
  h.show("owner", Array.from({ length: 101 }, (_, i) => sale("invoice-" + i)));
  assert.equal(h.elements.get("kk-owner-mobile-body").children.length, 100);
  assert.equal(h.elements.get("kk-owner-mobile-next").disabled, false);
  h.events.get("kk-owner-mobile-next:click")();
  assert.equal(h.elements.get("kk-owner-mobile-body").children.length, 1);
  assert.equal(h.elements.get("kk-owner-mobile-next").disabled, true);
});
test("Untrusted staff strings are assigned as text, never HTML", () => {
  const h = harness();
  const hostile = "<img src=x onerror=alert(1)>";
  h.show("owner", [sale("A", { "SM Name": hostile })]);
  assert.equal(h.elements.get("kk-owner-mobile-body").children[0].children[2].textContent, hostile);
});
