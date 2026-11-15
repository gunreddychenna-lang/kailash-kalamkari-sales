"use strict";
/* Owner-only read-only mobile sales table. No financial mutations. */
(function () {
  const PAGE_SIZE = 100;
  const $ = id => document.getElementById(id);
  let allInvoices = [], filtered = [], page = 0, ledgerLoaded = false, ledgerBusy = false;
  let authenticatedToken = null, requestSequence = 0;
  const statuses = new Map();
  const state = { from: "", to: "", branch: "all", girl: "all", sale: "all", status: "all", sort: "date_desc" };

  function text(value) {
    return value === null || value === undefined || String(value).trim() === "" ? "—" : String(value).trim();
  }
  function amount(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? "₹" + value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  }
  function channel(value) {
    const s = text(value).toLowerCase();
    if (s === "online") return "Online";
    if (s === "offline") return "Offline";
    if (["wholesale", "tbh", "take by hand"].includes(s)) return "TBH";
    return "—";
  }
  function key(branch, bill) { return JSON.stringify([text(branch), text(bill).toUpperCase()]); }
  function aggregate(rows) {
    const grouped = new Map();
    for (const row of rows) {
      const invoiceKey = text(row["Bill Key"]);
      if (invoiceKey === "—" || grouped.has(invoiceKey)) continue;
      const allocations = Array.isArray(row["Bank Allocations"]) ? row["Bank Allocations"] : [];
      const banks = [...new Set(allocations.map(x => text(x?.account)).filter(x => x !== "—"))];
      const invoiceAmount = Number(row["Invoice Total"]);
      grouped.set(invoiceKey, {
        date: text(row["Bill Date"]), branch: text(row["Store"]), girl: text(row["SM Name"]),
        sale: channel(row["Sale type"]),
        amount: Number.isFinite(invoiceAmount) ? invoiceAmount : null,
        bank: banks.length ? banks.join(", ") : "—",
        utr: "—", bill: text(row["Bill No"]), originalKey: invoiceKey, status: "unknown"
      });
    }
    return [...grouped.values()];
  }
  function setOptions(id, values) {
    const select = $(id); if (!select) return;
    select.replaceChildren();
    select.add(new Option("All", "all"));
    for (const value of [...new Set(values)].filter(x => x && x !== "—").sort((a,b) => a.localeCompare(b)))
      select.add(new Option(value, value));
    select.value = "all";
  }
  function updateStatusLine(message) { const node = $("kk-owner-filter-note"); if (node) node.textContent = message; }
  function chosen() {
    let list = allInvoices.filter(r =>
      (!state.from || r.date >= state.from) && (!state.to || r.date <= state.to) &&
      (state.branch === "all" || r.branch === state.branch) &&
      (state.girl === "all" || r.girl === state.girl) &&
      (state.sale === "all" || r.sale === state.sale) &&
      (state.status === "all" || r.status === state.status)
    );
    list = list.slice().sort((a, b) => {
      switch (state.sort) {
        case "date_asc": return a.date.localeCompare(b.date) || a.originalKey.localeCompare(b.originalKey);
        case "amount_desc": return (b.amount ?? -Infinity) - (a.amount ?? -Infinity) || b.date.localeCompare(a.date);
        case "amount_asc": return (a.amount ?? Infinity) - (b.amount ?? Infinity) || b.date.localeCompare(a.date);
        case "branch": return a.branch.localeCompare(b.branch) || b.date.localeCompare(a.date);
        case "girl": return a.girl.localeCompare(b.girl) || b.date.localeCompare(a.date);
        default: return b.date.localeCompare(a.date) || a.originalKey.localeCompare(b.originalKey);
      }
    });
    return list;
  }
  function cell(row, value, isMoney) {
    const td = document.createElement("td");
    td.textContent = value;
    if (isMoney) td.className = "kk-owner-money";
    row.appendChild(td);
  }
  function render() {
    filtered = chosen();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page >= pages) page = pages - 1;
    const body = $("kk-owner-mobile-body"); if (!body) return;
    body.replaceChildren();
    for (const sale of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const tr = document.createElement("tr");
      tr.title = "Payment status: " + (ledgerLoaded ? sale.status : "Not loaded");
      cell(tr, sale.date); cell(tr, sale.branch); cell(tr, sale.girl); cell(tr, sale.sale);
      cell(tr, amount(sale.amount), true); cell(tr, sale.bank); cell(tr, sale.utr);
      body.appendChild(tr);
    }
    if (!filtered.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 7; td.textContent = "No sales match the selected filters.";
      tr.appendChild(td); body.appendChild(tr);
    }
    $("kk-owner-mobile-count").textContent = filtered.length.toLocaleString("en-IN") +
      " of " + allInvoices.length.toLocaleString("en-IN") + " invoices · Page " + (page + 1) + "/" + pages;
    $("kk-owner-mobile-prev").disabled = page === 0;
    $("kk-owner-mobile-next").disabled = page >= pages - 1;
  }
  function update() { page = 0; render(); }
  function reset() {
    Object.assign(state, {from:"",to:"",branch:"all",girl:"all",sale:"all",status:"all",sort:"date_desc"});
    for (const [field,id] of [["from","kk-owner-from"],["to","kk-owner-to"],["branch","kk-owner-branch"],["girl","kk-owner-girl"],["sale","kk-owner-sale"],["status","kk-owner-status"],["sort","kk-owner-sort"]]) {
      if ($(id)) $(id).value = state[field];
    }
    update();
  }
  async function loadLedger(sequence) {
    if (ledgerLoaded || ledgerBusy || !authenticatedToken) return;
    ledgerBusy = true; updateStatusLine("Loading verified payment statuses…");
    try {
      // The existing read-only register restricts page_size to 50. Fetch all pages; never guess from receipt-bank names.
      async function getPage(n) {
        const response = await fetch("/api/accountant-payments?view=register&branch=all&status=all&page_size=50&page=" + n, {
          method: "GET", cache: "no-store", headers: { Authorization: "Bearer " + authenticatedToken, Accept: "application/json" }
        });
        if (!response.ok) throw new Error("Register unavailable (" + response.status + ")");
        const data = await response.json();
        if (!Array.isArray(data.rows) || !Number.isSafeInteger(data.pages) || data.pages < 1 || data.pages > 160)
          throw new Error("Unexpected register response");
        return data;
      }
      const first = await getPage(1);
      if (sequence !== requestSequence) return;
      const pages = first.pages, items = first.rows.slice();
      // Sequential batches reduce load on the production financial database.
      for (let n = 2; n <= pages; n++) {
        const data = await getPage(n);
        if (sequence !== requestSequence) return;
        if (data.pages !== pages) throw new Error("Register changed during pagination; retry");
        items.push(...data.rows);
      }
      if (first.total !== items.length) throw new Error("Register count changed; retry");
      statuses.clear();
      for (const r of items) {
        if (!["settled","pending","unverified","review"].includes(r.status)) continue;
        statuses.set(key(r.branch, r.bill_no), r.status);
      }
      for (const sale of allInvoices) sale.status = statuses.get(key(sale.branch, sale.bill)) || "unknown";
      ledgerLoaded = true;
      updateStatusLine("Payment status: recorded ledger evidence, not independently verified bank deposits.");
      update();
    } catch (error) {
      if (sequence !== requestSequence) return;
      state.status = "all";
      if ($("kk-owner-status")) $("kk-owner-status").value = "all";
      updateStatusLine("Payment status unavailable. Showing all sales; no status has been guessed.");
      update();
    } finally { ledgerBusy = false; }
  }
  function show(secureRole, rows, token) {
    const eligible = secureRole === "owner";
    document.body.classList.toggle("kk-owner-mobile-active", eligible);
    requestSequence++;
    if (!eligible) { authenticatedToken = null; allInvoices = []; ledgerLoaded = false; statuses.clear(); return; }
    authenticatedToken = typeof token === "string" && token ? token : null;
    statuses.clear(); ledgerLoaded = false;
    allInvoices = aggregate(Array.isArray(rows) ? rows : []);
    setOptions("kk-owner-branch", allInvoices.map(r => r.branch));
    setOptions("kk-owner-girl", allInvoices.map(r => r.girl));
    reset();
    updateStatusLine("All sales shown. Select a payment status to load ledger verification.");
  }
  document.addEventListener("DOMContentLoaded", () => {
    const filters = [["from","kk-owner-from"],["to","kk-owner-to"],["branch","kk-owner-branch"],["girl","kk-owner-girl"],["sale","kk-owner-sale"],["status","kk-owner-status"],["sort","kk-owner-sort"]];
    for (const [field,id] of filters) {
      $(id)?.addEventListener("change", () => {
        state[field] = $(id).value;
        if (field === "status" && state.status !== "all" && !ledgerLoaded) {
          const sequence = requestSequence; loadLedger(sequence);
        } else update();
      });
    }
    $("kk-owner-mobile-reset")?.addEventListener("click", reset);
    $("kk-owner-mobile-prev")?.addEventListener("click", () => { if (page > 0) { page--; render(); } });
    $("kk-owner-mobile-next")?.addEventListener("click", () => { if ((page+1) * PAGE_SIZE < filtered.length) { page++; render(); } });
  });
  window.KKOwnerMobileSales = { show };
}());
