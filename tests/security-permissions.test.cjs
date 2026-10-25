const test = require("node:test");
const assert = require("node:assert/strict");

const auth = require("../security-permissions.js");

test("anonymous access denied", () => {
  assert.equal(auth.canUseFeature(null, "dashboard"), false);
  assert.equal(auth.canPerform(null, "manage_staff"), false);
});

test("inactive employees denied", () => {
  const staff = {
    active: false,
    role: "sales_staff",
    features: ["dashboard"],
    stores: ["C"]
  };

  assert.equal(auth.canUseFeature(staff, "dashboard"), false);
  assert.equal(auth.canAccessStore(staff, "C"), false);
});

test("sales staff cannot enable payroll", () => {
  const staff = {
    active: true,
    role: "sales_staff",
    features: ["dashboard", "payroll"]
  };

  assert.equal(auth.canUseFeature(staff, "dashboard"), true);
  assert.equal(auth.canUseFeature(staff, "payroll"), false);
  assert.equal(auth.canPerform(staff, "view_payroll"), false);
});

test("cross-store access denied", () => {
  const staff = {
    active: true,
    role: "sales_staff",
    stores: ["C"]
  };

  assert.equal(auth.canAccessStore(staff, "C"), true);
  assert.equal(auth.canAccessStore(staff, "D"), false);
});

test("only owner can manage staff", () => {
  assert.equal(
    auth.canPerform(
      { active: true, role: "owner_admin" },
      "manage_staff"
    ),
    true
  );

  assert.equal(
    auth.canPerform(
      { active: true, role: "store_manager" },
      "manage_staff"
    ),
    false
  );
});

test("unknown roles denied", () => {
  const profile = {
    active: true,
    role: "unknown",
    features: ["dashboard"]
  };

  assert.equal(auth.canUseFeature(profile, "dashboard"), false);
  assert.equal(auth.canPerform(profile, "change_security"), false);
});
