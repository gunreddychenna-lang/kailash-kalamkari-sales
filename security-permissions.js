"use strict";

// KK-CEO-003: Owner + Admin = identical full access.
// Employee permissions are assigned individually.
// This module is a UI helper; database RLS is mandatory.

const ALL_STORES = Object.freeze([
  "Main Branch",
  "KHPS"
]);

const ALL_FEATURES = Object.freeze([
  "dashboard",
  "sales_entry",
  "crm",
  "inventory",
  "attendance",
  "payments",
  "payroll",
  "reports",
  "staff_management"
]);

const ROLE_FEATURES = Object.freeze({
  owner: ALL_FEATURES,
  admin: ALL_FEATURES,
  employee: ALL_FEATURES.filter(
    feature => feature !== "staff_management"
  )
});

function active(profile) {
  return profile?.active === true &&
    Object.hasOwn(ROLE_FEATURES, profile.role);
}

function fullAccess(profile) {
  return active(profile) &&
    ["owner", "admin"].includes(profile.role);
}

function enabledFeatures(profile) {
  if (!active(profile)) return [];

  if (fullAccess(profile)) return [...ALL_FEATURES];

  const selected = Array.isArray(profile.features)
    ? profile.features
    : [];

  return [...new Set(selected)].filter(
    feature => ROLE_FEATURES.employee.includes(feature)
  );
}

function canUseFeature(profile, feature) {
  return enabledFeatures(profile).includes(feature);
}

function canAccessStore(profile, store) {
  if (!active(profile) || !ALL_STORES.includes(store)) {
    return false;
  }

  if (fullAccess(profile)) return true;

  return Array.isArray(profile.stores) &&
    profile.stores.includes(store);
}

function canPerform(profile, action) {
  if (!active(profile)) return false;

  if (action === "manage_staff" ||
      action === "change_security") {
    return fullAccess(profile);
  }

  const actionFeature = {
    approve_payments: "payments",
    prepare_reconciliation: "reports",
    view_payroll: "payroll"
  }[action];

  return !!actionFeature &&
    canUseFeature(profile, actionFeature);
}

const api = Object.freeze({
  ALL_STORES,
  ALL_FEATURES,
  ROLE_FEATURES,
  enabledFeatures,
  fullAccess,
  canUseFeature,
  canAccessStore,
  canPerform
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.KKPermissions = api;
}