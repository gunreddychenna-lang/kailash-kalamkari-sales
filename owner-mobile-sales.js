"use strict";

/**
 * KK Owner Mobile Sales Table
 * Presentation-only view of the already-authorized, reconciled sales rows.
 * No database access and no financial mutations.
 */
(function () {
  const PAGE_SIZE = 100;
  let invoices = [];
  let page = 0;
  const $ = id => document.getElementById(id);

  function text(value) {
    return value === null || value === undefined || String(value).trim() === ""
      ? "—" : String(value).trim();
  }

  function amount(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? "₹" + number.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";
  }

  function channel(value) {
    const normalized = text(value).toLowerCase();
    if (normalized === "online") return "Online";
    if (normalized === "offline") return "Offline";
    if (normalized === "wholesale" || normalized === "tbh" || normalized === "take by hand") return "TBH";
    return "—";
  }

  function aggregate(rows) {
    const grouped = new Map();
    for (const row of rows) {
      // Clean rows already passed the existing invoice reconciliation gate.
      const key = text(row["Bill Key"]);
      if (key === "—") continue;
      if (grouped.has(key)) continue;
      const allocations = Array.isArray(row["Bank Allocations"]) ? row["Bank Allocations"] : [];
      const banks = [...new Set(allocations.map(x => text(x?.account)).filter(x => x !== "—"))];
      const invoiceAmount = Number(row["Invoice Total"]);
      grouped.set(key, {
        date: text(row["Bill Date"]),
        branch: text(row["Store"]),
        girl: text(row["SM Name"]),
        sale: channel(row["Sale type"]),
        amount: Number.isFinite(invoiceAmount) ? invoiceAmount : null,
        bank: banks.length ? banks.join(", ") : "—",
        // UTR is not present in the audited owner dashboard payload.
        utr: "—"
      });
    }
    return [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  function cell(tr, value, isMoney) {
    const td = document.createElement("td");
    td.textContent = value;
    if (isMoney) td.className = "kk-owner-money";
    tr.appendChild(td);
  }

  function renderPage() {
    const body = $("kk-owner-mobile-body");
    if (!body) return;
    body.replaceChildren();
    const start = page * PAGE_SIZE;
    for (const sale of invoices.slice(start, start + PAGE_SIZE)) {
      const tr = document.createElement("tr");
      cell(tr, sale.date);
      cell(tr, sale.branch);
      cell(tr, sale.girl);
      cell(tr, sale.sale);
      cell(tr, amount(sale.amount), true);
      cell(tr, sale.bank);
      cell(tr, sale.utr);
      body.appendChild(tr);
    }
    if (!invoices.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.textContent = "No reconciled sales records available.";
      tr.appendChild(td);
      body.appendChild(tr);
    }

    const pages = Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));
    $("kk-owner-mobile-count").textContent = invoices.length.toLocaleString("en-IN") + " invoices · Page " + (page + 1) + "/" + pages;
    $("kk-owner-mobile-prev").disabled = page === 0;
    $("kk-owner-mobile-next").disabled = page >= pages - 1;
  }

  function show(secureRole, rows) {
    // Role comes from the authenticated session, not a URL or localStorage.
    const eligible = secureRole === "owner";
    document.body.classList.toggle("kk-owner-mobile-active", eligible);
    if (!eligible) return;
    invoices = aggregate(Array.isArray(rows) ? rows : []);
    page = 0;
    renderPage();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("kk-owner-mobile-prev")?.addEventListener("click", () => {
      if (page > 0) { page--; renderPage(); }
    });
    $("kk-owner-mobile-next")?.addEventListener("click", () => {
      if ((page + 1) * PAGE_SIZE < invoices.length) { page++; renderPage(); }
    });
  });

  window.KKOwnerMobileSales = { show };
}());
