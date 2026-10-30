"use strict";

function status(billAmount, paidAmount) {
  const bill = Math.round(Number(billAmount) * 100);
  const paid = Math.round(Number(paidAmount) * 100);

  if (
    !Number.isSafeInteger(bill) ||
    !Number.isSafeInteger(paid) ||
    bill <= 0 ||
    paid < 0
  ) return "Needs Review";

  if (paid > bill) return "Needs Review";
  if (paid === bill) return "Settled";
  return "Pending";
}

function normalizeAccount(value) {
  const account = String(value || "").trim();

  if (account.toLowerCase() === "cash") return "Cash";

  const parts = account.split("::");
  return parts.length === 2
    ? parts[1].trim()
    : account || "Unknown";
}

module.exports = { status, normalizeAccount };