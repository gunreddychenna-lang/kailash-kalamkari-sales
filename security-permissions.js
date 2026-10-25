"use strict";

const ROLE_FEATURES = Object.freeze({
  owner_admin: [
    "dashboard", "sales_entry", "crm", "inventory",
    "attendance", "payments", "payroll", "reports",
    "staff_management"
  ],
  store_manager: [
    "dashboard", "sales_entry", "crm", "inventory",
    "attendance", "reports"
  ],
  sales_staff: [
    "dashboard", "sales_entry", "crm", "inventory",
    "attendance"
  ],
  accountant: [
    "dashboard", "payments", "payroll", "reports"
  ]
});

const SENSITIVE_ACTIONS = Object.freeze({
  manage_staff: ["owner_admin"],
  approve_payments: ["owner_admin"],
  prepare_reconciliation: ["owner_admin", "accountant"],
  view_payroll: ["owner_admin", "accountant"],
  change_security: ["owner_admin"]
});

function enabledFeatures(profile) {
  if (!profile || profile.active !== true) return [];

  const allowed = ROLE_FEATURES[profile.role] || [];
  const selected = Array.isArray(profile.features)
    ? profile.features
    : [];

  return [...new Set(selected)].filter(
    feature => allowed.includes(feature)
  );
}

function canUseFeature(profile, feature) {
  return enabledFeatures(profile).includes(feature);
}

function canPerform(profile, action) {
  if (!profile || profile.active !== true) return false;

  const roles = SENSITIVE_ACTIONS[action];

  return Array.isArray(roles) &&
    roles.includes(profile.role);
}

function canAccessStore(profile, storeId) {
  if (!profile || profile.active !== true) return false;
  if (!storeId) return false;

  const stores = Array.isArray(profile.stores)
    ? profile.stores
    : [];

  return stores.includes(storeId);
}

const api = Object.freeze({
  ROLE_FEATURES,
  SENSITIVE_ACTIONS,
  enabledFeatures,
  canUseFeature,
  canPerform,
  canAccessStore
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}

if (typeof window !== "undefined") {
  window.KKPermissions = api;
}
