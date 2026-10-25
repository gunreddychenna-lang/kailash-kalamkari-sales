"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const auth = require("../security-permissions.js");

test("anonymous access denied", () => {
  assert.equal(auth.canUseFeature(null, "dashboard"), false);
  assert.equal(auth.canPerform(null, "manage_staff"), false);
});

test("inactive employee access denied", () => {
  const staff = {
    active: false,
    role: "employee",
    features: ["dashboard"],
    stores: ["Main Branch"]
  };

  assert.equal(auth.canUseFeature(staff, "dashboard"), false);
  assert.equal(auth.canAccessStore(staff, "Main Branch"), false);
});

test("employee cannot access unassigned payroll", () => {
  const staff = {
    active: true,
    role: "employee",
    features: ["dashboard"],
    stores: ["Main Branch"]
  };

  assert.equal(auth.canUseFeature(staff, "dashboard"), true);
  assert.equal(auth.canUseFeature(staff, "payroll"), false);
  assert.equal(auth.canPerform(staff, "view_payroll"), false);
});

test("cross-store access denied", () => {
  const staff = {
    active: true,
    role: "employee",
    features: ["dashboard"],
    stores: ["Main Branch"]
  };

  assert.equal(auth.canAccessStore(staff, "Main Branch"), true);
  assert.equal(auth.canAccessStore(staff, "KHPS"), false);
});

test("both Owner and Admin manage employees", () => {
  for (const role of ["owner", "admin"]) {
    assert.equal(
      auth.canPerform(
        { active: true, role },
        "manage_staff"
      ),
      true
    );
  }

  assert.equal(
    auth.canPerform(
      {
        active: true,
        role: "employee",
        features: ["staff_management"]
      },
      "manage_staff"
    ),
    false
  );
});

test("unknown and legacy roles denied", () => {
  for (const role of [
    "unknown",
    "owner_admin",
    "sales_staff",
    "store_manager",
    "accountant"
  ]) {
    const profile = {
      active: true,
      role,
      features: ["dashboard"]
    };

    assert.equal(auth.canUseFeature(profile, "dashboard"), false);
    assert.equal(auth.canPerform(profile, "change_security"), false);
  }
});