"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../security-permissions.js");

const owner = { role: "owner", active: true };
const admin = { role: "admin", active: true };

const employee = {
  role: "employee",
  active: true,
  stores: ["Main Branch"],
  features: ["dashboard", "inventory"]
};

test("Owner and Admin have identical full access", () => {
  for (const feature of p.ALL_FEATURES) {
    assert.equal(p.canUseFeature(owner, feature), true);
    assert.equal(p.canUseFeature(admin, feature), true);
  }

  for (const store of p.ALL_STORES) {
    assert.equal(p.canAccessStore(owner, store), true);
    assert.equal(p.canAccessStore(admin, store), true);
  }
});

test("Both Owner and Admin can manage staff", () => {
  assert.equal(p.canPerform(owner, "manage_staff"), true);
  assert.equal(p.canPerform(admin, "manage_staff"), true);
});

test("Employees only see assigned modules", () => {
  assert.equal(p.canUseFeature(employee, "dashboard"), true);
  assert.equal(p.canUseFeature(employee, "inventory"), true);
  assert.equal(p.canUseFeature(employee, "payroll"), false);
  assert.equal(p.canUseFeature(employee, "staff_management"), false);
});

test("Employees cannot access an unassigned store", () => {
  assert.equal(p.canAccessStore(employee, "Main Branch"), true);
  assert.equal(p.canAccessStore(employee, "KHPS"), false);
});

test("Employees cannot manage other staff", () => {
  const attempting = {
    ...employee,
    features: [...p.ALL_FEATURES]
  };

  assert.equal(p.canPerform(attempting, "manage_staff"), false);
  assert.equal(p.canPerform(attempting, "change_security"), false);
});

test("Inactive and unknown accounts fail closed", () => {
  for (const profile of [
    null,
    { role: "owner", active: false },
    { role: "unknown", active: true }
  ]) {
    assert.deepEqual(p.enabledFeatures(profile), []);
    assert.equal(p.canAccessStore(profile, "KHPS"), false);
    assert.equal(p.canPerform(profile, "manage_staff"), false);
  }
});