/* Kailash Kalamkari — Live Multi-Store Sales Analytics Hub (app.js)
 * Preserves 100% of original index.html UI, layouts, cards, tabs, modals, and workflows.
 * Modernized backend: FastAPI + PostgreSQL (HttpOnly session cookie + CSRF, zero Supabase).
 */

let currentUser = null;
let csrfToken = "";
let allSalesRows = [];
let allBillsMaster = [];
let allAttendanceRecords = [];
let selectedStore = "All";
let selectedCategory = "All";
let monthlyTargetAmount = 1000000;
let activeTab = "products-tab";
let selectedAttendanceMonth = "September 2026";
let attendanceViewMode = "grid";

const STAFF_ALIASES_MAP = {
  "KS-103": ["varalakshmi", "vara lakshmi", "b varalakshmi", "b. varalakshmi", "varalaxmi"],
  "KS-104": ["mouni", "mounika", "ty mounika", "t y mounika"],
  "KS-105": ["sanjana", "r sanjana"],
  "KS-106": ["geethika", "githika", "gethika"],
  "KS-107": ["sandhya", "j sandhya"],
  "KS-108": ["pushpa", "c pushpa"],
  "KS-109": ["bharathamma", "barathamma", "bharatamma"],
  "KS-110": ["nandhini", "nandini"],
  "KS-111": ["harika"],
  "KS-112": ["dhanalakshmi", "dhana lakshmi", "dhana laskhmi", "dhanalaxmi"],
  "KS-113": ["ammulu", "m.ammulu", "m ammulu"],
};

function fmtINR(val) {
  const n = Math.round(Number(val) || 0);
  return (n < 0 ? "-₹" : "₹") + Math.abs(n).toLocaleString("en-IN");
}

function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}

async function apiRequest(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (options.method && options.method !== "GET" && csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  const resp = await fetch(url, { credentials: "same-origin", ...options, headers });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const d = await resp.json();
      if (d.detail) msg = d.detail;
    } catch (_) {}
    throw new Error(msg);
  }
  return resp.json();
}

function isAdminUser() {
  return currentUser && ["owner", "admin"].includes(currentUser.role_code);
}

// =========================================================================
// 1. AUTHENTICATION & BOOTSTRAP
// =========================================================================
window.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  if (loginForm) loginForm.addEventListener("submit", handleLoginSubmit);

  const storeSel = document.getElementById("store-filter");
  if (storeSel) storeSel.addEventListener("change", (e) => selectStoreFilter(e.target.value));

  const fromEl = document.getElementById("from-date");
  const toEl = document.getElementById("to-date");
  if (fromEl) fromEl.addEventListener("change", renderAllAnalytics);
  if (toEl) toEl.addEventListener("change", renderAllAnalytics);

  const prodSearch = document.getElementById("product-search");
  if (prodSearch) prodSearch.addEventListener("input", renderProductsTab);

  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) refreshBtn.addEventListener("click", loadPortalData);

  checkSession();
});

async function checkSession() {
  try {
    const me = await apiRequest("/api/auth/me");
    currentUser = me;
    csrfToken = me.csrf_token;
    if (window.location.pathname === "/login") {
      window.history.replaceState({}, "", "/dashboard");
    }
    showPortalShell();
    await loadPortalData();
  } catch (_) {
    document.getElementById("loader")?.classList.add("hidden");
    document.getElementById("login-screen")?.classList.remove("hidden");
    document.getElementById("standard-header")?.classList.add("hidden");
    document.getElementById("standard-main")?.classList.add("hidden");
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById("login-error");
  const btnText = document.getElementById("login-btn-text");
  const spinner = document.getElementById("login-btn-spinner");
  errBox.classList.add("hidden");
  btnText.textContent = "Authenticating...";
  spinner.classList.remove("hidden");

  try {
    await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("login-username").value.trim(),
        password: document.getElementById("login-password").value,
      }),
    });
    const me = await apiRequest("/api/auth/me");
    currentUser = me;
    csrfToken = me.csrf_token;
    window.history.pushState({}, "", "/dashboard");
    showPortalShell();
    await loadPortalData();
  } catch (err) {
    errBox.textContent = err.message || "Invalid credentials";
    errBox.classList.remove("hidden");
  } finally {
    btnText.textContent = "Authenticate Portal";
    spinner.classList.add("hidden");
  }
}

async function handleLogout() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } catch (_) {}
  currentUser = null;
  csrfToken = "";
  window.history.pushState({}, "", "/login");
  document.getElementById("standard-header")?.classList.add("hidden");
  document.getElementById("standard-main")?.classList.add("hidden");
  document.getElementById("agent-analysis-view")?.classList.add("hidden");
  document.getElementById("channel-view")?.classList.add("hidden");
  document.getElementById("login-screen")?.classList.remove("hidden");
}

function showPortalShell() {
  document.getElementById("login-screen")?.classList.add("hidden");
  document.getElementById("standard-header")?.classList.remove("hidden");
  document.getElementById("user-display-name").textContent = currentUser.full_name || currentUser.username;
  document.getElementById("user-role-badge").textContent = (currentUser.role_code || "USER").toUpperCase();

  document.querySelectorAll(".admin-only").forEach((el) => {
    if (isAdminUser()) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });
}

// =========================================================================
// 2. DATA LOADING FROM POSTGRESQL API
// =========================================================================
async function loadPortalData() {
  const loader = document.getElementById("loader");
  const main = document.getElementById("standard-main");
  if (loader) loader.classList.remove("hidden");
  if (main) main.classList.add("hidden");

  try {
    const now = new Date();
    const [salesResp, targetResp] = await Promise.all([
      apiRequest("/api/portal/sales-rows"),
      apiRequest(`/api/portal/targets?year=${now.getFullYear()}&month=${now.getMonth() + 1}`),
    ]);
    allSalesRows = salesResp.rows || [];
    monthlyTargetAmount = Number(targetResp.target_amount) || 1000000;
    const tInput = document.getElementById("target-input-field");
    if (tInput) tInput.value = monthlyTargetAmount;

    if (["owner", "admin", "accountant"].includes(currentUser.role_code)) {
      try {
        const [billsResp, attResp] = await Promise.all([
          apiRequest("/api/portal/bills-master"),
          apiRequest("/api/portal/attendance"),
        ]);
        allBillsMaster = billsResp.bills || [];
        allAttendanceRecords = attResp.records || [];
      } catch (_) {}
    }

    populateStoreDropdown();
    setQuickDateRange("all");
    populateAttendanceMonths();
    renderAllAnalytics();
  } catch (err) {
    console.error("Load error:", err);
  } finally {
    if (loader) loader.classList.add("hidden");
    if (main) main.classList.remove("hidden");
  }
}

function populateStoreDropdown() {
  const sel = document.getElementById("store-filter");
  if (!sel) return;
  const stores = Array.from(new Set(allSalesRows.map((r) => r.store_name).filter(Boolean))).sort();
  sel.innerHTML =
    `<option value="All">All Branches / Stores</option>` +
    stores.map((s) => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join("");
  sel.value = selectedStore;
}

function selectStoreFilter(store) {
  selectedStore = store || "All";
  const sel = document.getElementById("store-filter");
  if (sel) sel.value = selectedStore;
  renderAllAnalytics();
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function setQuickDateRange(mode) {
  const today = new Date();
  const fromEl = document.getElementById("from-date");
  const toEl = document.getElementById("to-date");
  const dates = allSalesRows.map((r) => String(r.bill_date || "").slice(0, 10)).filter(Boolean).sort();

  let start = "";
  let end = "";
  if (mode === "today") {
    start = end = toISODate(today);
  } else if (mode === "yesterday") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    start = end = toISODate(y);
  } else if (mode === "latest") {
    start = end = dates.length ? dates[dates.length - 1] : toISODate(today);
  } else if (mode === "week") {
    const w = new Date(today);
    w.setDate(w.getDate() - 6);
    start = toISODate(w);
    end = toISODate(today);
  } else if (mode === "month") {
    start = toISODate(new Date(today.getFullYear(), today.getMonth(), 1));
    end = toISODate(today);
  } else {
    start = dates.length ? dates[0] : "";
    end = dates.length ? dates[dates.length - 1] : "";
  }

  if (fromEl) fromEl.value = start;
  if (toEl) toEl.value = end;

  document.querySelectorAll(".quick-date-btn").forEach((b) => {
    b.className = "quick-date-btn bg-[#FAF6EE] hover:bg-[#EFE5C9] text-stone-700 font-bold px-2.5 py-1 rounded-lg border border-[#E5D5C6]";
  });
  const activeBtn = document.getElementById(`btn-date-${mode}`);
  if (activeBtn) {
    activeBtn.className = "quick-date-btn bg-[#5C0612] text-[#EFE5C9] font-bold px-2.5 py-1 rounded-lg border border-[#DAA520]";
  }
  renderAllAnalytics();
}

function getFilteredRows() {
  const fromDate = document.getElementById("from-date")?.value || "";
  const toDate = document.getElementById("to-date")?.value || "";
  return allSalesRows.filter((r) => {
    if (selectedStore !== "All" && r.store_name !== selectedStore) return false;
    const d = String(r.bill_date || "").slice(0, 10);
    if (fromDate && d && d < fromDate) return false;
    if (toDate && d && d > toDate) return false;
    return true;
  });
}

async function updateMonthlyTarget(val) {
  monthlyTargetAmount = Number(val) || 0;
  renderAllAnalytics();
  if (isAdminUser()) {
    const now = new Date();
    try {
      await apiRequest("/api/portal/targets", {
        method: "POST",
        body: JSON.stringify({ year: now.getFullYear(), month: now.getMonth() + 1, target_amount: monthlyTargetAmount }),
      });
    } catch (_) {}
  }
}

// =========================================================================
// 3. CORE METRICS & TAB RENDERING
// =========================================================================
function renderAllAnalytics() {
  const rows = getFilteredRows();
  let totalRev = 0, onlineRev = 0, offlineRev = 0, wholesaleRev = 0, totalUnits = 0;
  let upiStore = 0, upiOnl = 0, cash = 0, card = 0, tbh = 0;
  const billsSet = new Set();
  const bankSplit = {};

  rows.forEach((r) => {
    const amt = Number(r.amount) || 0;
    const qty = Number(r.qty) || 1;
    totalRev += amt;
    totalUnits += qty;
    billsSet.add(`${r.store_name}::${r.bill_no}`);

    if (r.channel === "Online") onlineRev += amt;
    else if (r.channel === "Take by Hand") wholesaleRev += amt;
    else offlineRev += amt;

    const pm = String(r.pay_mode || "").toLowerCase();
    if (r.channel === "Take by Hand" || pm.includes("tbh") || pm.includes("hand")) tbh += amt;
    else if (pm.includes("upi") && r.channel === "Online") upiOnl += amt;
    else if (pm.includes("upi")) upiStore += amt;
    else if (pm.includes("card")) card += amt;
    else cash += amt;

    const acc = (r.bank_account || r.account_name || "Unassigned").trim();
    bankSplit[acc] = (bankSplit[acc] || 0) + amt;
  });

  const billCount = billsSet.size || 0;
  const upt = billCount ? (totalUnits / billCount).toFixed(1) : "0.0";
  const atv = billCount ? totalRev / billCount : 0;
  const auv = totalUnits ? totalRev / totalUnits : 0;

  document.getElementById("metric-total").textContent = fmtINR(totalRev);
  document.getElementById("metric-upt").textContent = upt;
  document.getElementById("metric-atv").textContent = fmtINR(atv);
  document.getElementById("metric-auv").textContent = fmtINR(auv);
  document.getElementById("metric-asp").textContent = fmtINR(auv);
  document.getElementById("metric-online").textContent = fmtINR(onlineRev);
  document.getElementById("metric-offline").textContent = fmtINR(offlineRev);
  document.getElementById("metric-wholesale").textContent = fmtINR(wholesaleRev);

  document.getElementById("paymode-upi-store").textContent = fmtINR(upiStore);
  document.getElementById("paymode-upi-onl").textContent = fmtINR(upiOnl);
  document.getElementById("paymode-cash").textContent = fmtINR(cash);
  document.getElementById("paymode-card").textContent = fmtINR(card);
  document.getElementById("paymode-hand").textContent = fmtINR(tbh);

  // Target Progress
  const pct = monthlyTargetAmount > 0 ? Math.min(100, Math.round((totalRev / monthlyTargetAmount) * 100)) : 0;
  document.getElementById("target-percent-text").textContent = `${pct}%`;
  document.getElementById("target-progress-bar").style.width = `${pct}%`;
  document.getElementById("target-achieved-text").textContent = fmtINR(totalRev);

  // Bank Ledger Split
  const splitEl = document.getElementById("account-split-container");
  const bankEntries = Object.entries(bankSplit).sort((a, b) => b[1] - a[1]);
  splitEl.innerHTML = bankEntries.length
    ? bankEntries.map(([acc, val]) => `<div class="bg-[#FAF6EE] p-2 rounded-xl border border-[#E5D5C6]"><span class="block text-[8px] font-bold text-stone-500 truncate">${escHtml(acc)}</span><strong class="text-[#5C0612] text-xs">${fmtINR(val)}</strong></div>`).join("")
    : `<div class="col-span-3 text-stone-400 text-[10px] py-2">No bank ledger entries yet</div>`;

  renderProductsTab();
  renderInsightsTab();
  renderAgentsTab();
  renderDaywiseTab();
  renderInlineAttendanceTab(totalRev);
}

function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.add("hidden"));
  document.getElementById(tabId)?.classList.remove("hidden");

  ["products-tab", "insights-tab", "agents-tab", "daywise-tab", "attendance-tab"].forEach((id) => {
    const btn = document.getElementById(`btn-${id}`);
    if (!btn) return;
    if (id === tabId) {
      btn.className = "flex-1 min-w-[90px] py-2 text-xs font-bold rounded-xl bg-white text-[#5C0612] font-traditional shadow-sm";
    } else {
      btn.className = "flex-1 min-w-[90px] py-2 text-xs font-bold rounded-xl text-stone-500 hover:text-stone-700 font-traditional";
    }
  });
}

function filterCategory(cat) {
  selectedCategory = cat;
  ["all", "sarees", "fabrics", "frames"].forEach((k) => {
    const btn = document.getElementById(`cat-btn-${k}`);
    if (!btn) return;
    const isMatch = (k === "all" && cat === "All") || (k === cat.toLowerCase());
    btn.className = isMatch
      ? "px-3 py-1 rounded-full bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-bold shadow-sm"
      : "px-3 py-1 rounded-full bg-[#FFFDF9] text-stone-600 border border-[#E5D5C6] hover:bg-stone-100 font-bold";
  });
  renderProductsTab();
}

function renderProductsTab() {
  const tbody = document.getElementById("products-table-body");
  if (!tbody) return;
  const q = (document.getElementById("product-search")?.value || "").toLowerCase().trim();
  const rows = getFilteredRows();
  const prodMap = {};

  rows.forEach((r) => {
    const name = r.item_name || "General Item";
    const lower = name.toLowerCase();
    if (selectedCategory === "Sarees" && !lower.includes("saree")) return;
    if (selectedCategory === "Fabrics" && !lower.includes("fabric") && !lower.includes("dupatta") && !lower.includes("blouse") && !lower.includes("cotton")) return;
    if (selectedCategory === "Frames" && !lower.includes("frame") && !lower.includes("art") && !lower.includes("painting")) return;
    if (q && !lower.includes(q)) return;

    if (!prodMap[name]) prodMap[name] = { name, units: 0, rev: 0, online: 0, offline: 0, ws: 0 };
    const amt = Number(r.amount) || 0;
    prodMap[name].units += Number(r.qty) || 1;
    prodMap[name].rev += amt;
    if (r.channel === "Online") prodMap[name].online += amt;
    else if (r.channel === "Take by Hand") prodMap[name].ws += amt;
    else prodMap[name].offline += amt;
  });

  const sorted = Object.values(prodMap).sort((a, b) => b.rev - a.rev);
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-stone-400">No matching products found.</td></tr>`;
    return;
  }
  tbody.innerHTML = sorted.map((p) => `
    <tr class="hover:bg-amber-50/30 cursor-pointer" onclick="openProductDetail('${escHtml(p.name).replace(/'/g, "\\'")}')">
      <td class="p-3.5">
        <div class="font-bold text-stone-800 font-sans">${escHtml(p.name)}</div>
        <div class="text-[9px] text-stone-500 mt-0.5">Online: ${fmtINR(p.online)} • Counter: ${fmtINR(p.offline)} • WS: ${fmtINR(p.ws)}</div>
      </td>
      <td class="p-3.5 text-center font-bold">${p.units}</td>
      <td class="p-3.5 text-right font-black text-[#5C0612]">${fmtINR(p.rev)}</td>
    </tr>
  `).join("");
}

function openProductDetail(productName) {
  document.getElementById("detail-product-name").textContent = productName;
  const staffMap = {};
  getFilteredRows().filter((r) => (r.item_name || "General Item") === productName).forEach((r) => {
    const s = r.sm_name || "No Agent";
    if (!staffMap[s]) staffMap[s] = { online: 0, offline: 0, ws: 0, total: 0 };
    const amt = Number(r.amount) || 0;
    staffMap[s].total += amt;
    if (r.channel === "Online") staffMap[s].online += amt;
    else if (r.channel === "Take by Hand") staffMap[s].ws += amt;
    else staffMap[s].offline += amt;
  });
  document.getElementById("product-detail-table-body").innerHTML = Object.entries(staffMap)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([st, v]) => `<tr><td class="p-2.5 font-bold">${escHtml(st)}</td><td class="p-2.5 text-right text-blue-800">${fmtINR(v.online)}</td><td class="p-2.5 text-right text-orange-800">${fmtINR(v.offline)}</td><td class="p-2.5 text-right text-purple-800">${fmtINR(v.ws)}</td><td class="p-2.5 text-right font-black text-[#5C0612]">${fmtINR(v.total)}</td></tr>`)
    .join("");
  document.getElementById("product-detail-card").classList.remove("hidden");
}

function closeProductDetail() {
  document.getElementById("product-detail-card").classList.add("hidden");
}

function renderInsightsTab() {
  const rows = getFilteredRows();
  const tiers = [
    { label: "Entry (< ₹2,000)", rev: 0, count: 0 },
    { label: "Mid (₹2,000 – ₹5,000)", rev: 0, count: 0 },
    { label: "Premium (₹5,000 – ₹10,000)", rev: 0, count: 0 },
    { label: "Luxury (₹10,000+)", rev: 0, count: 0 },
  ];
  const byBill = {};
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowTotals = [0, 0, 0, 0, 0, 0, 0];

  rows.forEach((r) => {
    const amt = Number(r.amount) || 0;
    const rate = Number(r.rate) || amt;
    const idx = rate < 2000 ? 0 : rate < 5000 ? 1 : rate < 10000 ? 2 : 3;
    tiers[idx].rev += amt;
    tiers[idx].count += 1;

    const bKey = `${r.store_name}::${r.bill_no}`;
    if (!byBill[bKey]) byBill[bKey] = new Set();
    if (r.item_name) byBill[bKey].add(r.item_name);

    if (r.channel !== "Take by Hand" && r.bill_date) {
      const dt = new Date(String(r.bill_date).slice(0, 10) + "T00:00:00");
      if (!isNaN(dt.getTime())) dowTotals[dt.getDay()] += amt;
    }
  });

  document.getElementById("price-tier-cards-container").innerHTML = tiers
    .map((t) => `<div class="bg-[#FAF6EE] p-3.5 rounded-2xl border border-[#E5D5C6]"><span class="text-[9px] font-bold uppercase text-stone-500 font-traditional">${t.label}</span><strong class="block text-lg font-black text-[#5C0612] font-numeric mt-1">${fmtINR(t.rev)}</strong><span class="text-[10px] text-stone-500 font-numeric">${t.count} items</span></div>`)
    .join("");

  const pairCounts = {};
  Object.values(byBill).forEach((set) => {
    const arr = Array.from(set).sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]} + ${arr[j]}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
  });
  const topPairs = Object.entries(pairCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  document.getElementById("cross-sell-pairs-container").innerHTML = topPairs.length
    ? topPairs.map(([pair, cnt]) => `<div class="bg-[#FAF6EE] p-3 rounded-xl border border-[#E5D5C6] flex justify-between items-center text-xs"><span class="font-bold text-stone-800">${escHtml(pair)}</span><span class="bg-[#5C0612] text-[#EFE5C9] px-2 py-0.5 rounded-full text-[10px] font-numeric font-bold">${cnt}x</span></div>`).join("")
    : `<p class="text-xs text-stone-400">No multi-item co-purchase pairs in selected range.</p>`;

  const maxDow = Math.max(...dowTotals, 1);
  document.getElementById("day-of-week-heatmap-container").innerHTML = dayNames
    .map((name, i) => {
      const intensity = Math.round((dowTotals[i] / maxDow) * 100);
      return `<div class="p-3 rounded-2xl border border-[#E5D5C6] text-center font-numeric" style="background: rgba(92, 6, 18, ${0.06 + (intensity / 100) * 0.2})"><span class="block text-[10px] font-bold font-traditional text-stone-700">${name}</span><strong class="block text-xs font-black text-[#5C0612] mt-1">${fmtINR(dowTotals[i])}</strong></div>`;
    })
    .join("");
}

function renderAgentsTab() {
  const tbody = document.getElementById("agents-table-body");
  if (!tbody) return;
  const map = {};
  getFilteredRows().forEach((r) => {
    const a = r.sm_name || "No Agent";
    if (!map[a]) map[a] = { name: a, online: 0, offline: 0, ws: 0, total: 0 };
    const amt = Number(r.amount) || 0;
    map[a].total += amt;
    if (r.channel === "Online") map[a].online += amt;
    else if (r.channel === "Take by Hand") map[a].ws += amt;
    else map[a].offline += amt;
  });
  const sorted = Object.values(map).sort((a, b) => b.total - a.total);
  tbody.innerHTML = sorted.length
    ? sorted.map((a) => `
      <tr class="hover:bg-amber-50/30 cursor-pointer" onclick="openAgentAnalysisScreen('${escHtml(a.name).replace(/'/g, "\\'")}')">
        <td class="p-3.5"><div class="font-bold text-stone-800 font-sans">${escHtml(a.name)}</div><div class="text-[9px] text-stone-500">Online: ${fmtINR(a.online)} • Counter: ${fmtINR(a.offline)} • WS: ${fmtINR(a.ws)}</div></td>
        <td class="p-3.5 text-right font-black text-[#5C0612]">${fmtINR(a.total)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="2" class="p-6 text-center text-stone-400">No staff sales in selected range.</td></tr>`;
}

function openAgentAnalysisScreen(agentName) {
  const rows = getFilteredRows().filter((r) => (r.sm_name || "No Agent") === agentName);
  let tot = 0, onl = 0, off = 0, ws = 0;
  const byDay = {};
  rows.forEach((r) => {
    const amt = Number(r.amount) || 0;
    tot += amt;
    if (r.channel === "Online") onl += amt;
    else if (r.channel === "Take by Hand") ws += amt;
    else off += amt;
    const d = String(r.bill_date || "").slice(0, 10);
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(r);
  });
  document.getElementById("agent-analysis-title").textContent = `${agentName} — Performance Ledger`;
  document.getElementById("agent-analysis-total-revenue").textContent = fmtINR(tot);
  document.getElementById("agent-analysis-online-sales").textContent = fmtINR(onl);
  document.getElementById("agent-analysis-offline-sales").textContent = fmtINR(off);
  document.getElementById("agent-analysis-takebyhand-sales").textContent = fmtINR(ws);
  document.getElementById("agent-analysis-daily-list").innerHTML = Object.entries(byDay)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([d, list]) => `<div class="bg-[#FAF6EE] p-3 rounded-2xl border border-[#E5D5C6]"><div class="flex justify-between font-bold text-xs mb-1"><span>${d}</span><span class="text-[#5C0612]">${fmtINR(list.reduce((s, x) => s + (Number(x.amount) || 0), 0))}</span></div><div class="text-[11px] text-stone-600 space-y-0.5">${list.map((x) => `<div>${escHtml(x.bill_no)} • ${escHtml(x.item_name)} — <strong>${fmtINR(x.amount)}</strong></div>`).join("")}</div></div>`)
    .join("");
  document.getElementById("standard-main").classList.add("hidden");
  document.getElementById("agent-analysis-view").classList.remove("hidden");
}

function closeAgentAnalysisScreen() {
  document.getElementById("agent-analysis-view").classList.add("hidden");
  document.getElementById("standard-main").classList.remove("hidden");
}

function selectChannel(channel) {
  if (channel === "All") return;
  const rows = getFilteredRows().filter((r) => (channel === "Wholesale" ? r.channel === "Take by Hand" : r.channel === channel));
  let tot = 0;
  const byStaff = {};
  rows.forEach((r) => {
    const amt = Number(r.amount) || 0;
    tot += amt;
    const s = r.sm_name || "No Agent";
    byStaff[s] = (byStaff[s] || 0) + amt;
  });
  document.getElementById("channel-view-title").textContent = `${channel} Channel Sales Breakdown`;
  document.getElementById("channel-view-total").textContent = fmtINR(tot);
  document.getElementById("channel-agents-table").innerHTML = Object.entries(byStaff)
    .sort((a, b) => b[1] - a[1])
    .map(([s, v]) => `<tr><td class="p-3 font-bold">${escHtml(s)}</td><td class="p-3 text-right font-black text-[#5C0612]">${fmtINR(v)}</td></tr>`)
    .join("") || `<tr><td colspan="2" class="p-6 text-center text-stone-400">No sales in this channel.</td></tr>`;
  document.getElementById("standard-main").classList.add("hidden");
  document.getElementById("channel-view").classList.remove("hidden");
}

function closeChannelScreen() {
  document.getElementById("channel-view").classList.add("hidden");
  document.getElementById("standard-main").classList.remove("hidden");
}

function renderDaywiseTab() {
  const container = document.getElementById("daywise-sales-container");
  if (!container) return;
  const byDay = {};
  getFilteredRows().forEach((r) => {
    const d = String(r.bill_date || "").slice(0, 10) || "Unknown";
    if (!byDay[d]) byDay[d] = { total: 0, staff: {} };
    const amt = Number(r.amount) || 0;
    byDay[d].total += amt;
    const s = r.sm_name || "No Agent";
    byDay[d].staff[s] = (byDay[d].staff[s] || 0) + amt;
  });
  const sorted = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]));
  container.innerHTML = sorted.length
    ? sorted.map(([d, info]) => `
      <div class="bg-[#FAF6EE] p-4 rounded-2xl border border-[#E5D5C6]">
        <div class="flex justify-between items-center border-b border-[#E5D5C6]/60 pb-1.5 mb-2">
          <strong class="text-xs font-numeric text-stone-800">${d}</strong>
          <strong class="text-sm font-black font-numeric text-[#5C0612]">${fmtINR(info.total)}</strong>
        </div>
        <div class="flex flex-wrap gap-2 text-[11px]">
          ${Object.entries(info.staff).sort((a, b) => b[1] - a[1]).map(([s, v]) => `<span class="bg-white border border-[#E5D5C6] px-2.5 py-1 rounded-xl font-numeric">${escHtml(s)}: <strong class="text-[#5C0612]">${fmtINR(v)}</strong></span>`).join("")}
        </div>
      </div>
    `).join("")
    : `<p class="text-center text-xs text-stone-400 p-6">No daily sales in selected date range.</p>`;
}

// =========================================================================
// 4. INLINE ATTENDANCE & PAYROLL TAB (index.html)
// =========================================================================
function populateAttendanceMonths() {
  const sel = document.getElementById("attendance-month-select");
  if (!sel) return;
  const months = Array.from(new Set(allAttendanceRecords.map((r) => r.month_sheet).filter(Boolean)));
  if (!months.length) months.push("September 2026");
  selectedAttendanceMonth = months[0];
  sel.innerHTML = months.map((m) => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join("");
}

function filterAttendanceMonth(m) {
  selectedAttendanceMonth = m;
  renderAllAnalytics();
}

function setAttendanceViewMode(mode) {
  attendanceViewMode = mode;
  document.getElementById("staff-salary-list")?.classList.toggle("hidden", mode !== "grid");
  document.getElementById("staff-salary-summary-view")?.classList.toggle("hidden", mode !== "summary");
}

function renderInlineAttendanceTab(storeSales) {
  const staff = allAttendanceRecords.filter((r) => r.month_sheet === selectedAttendanceMonth);
  document.getElementById("payroll-staff-count").textContent = `${staff.length} Staff`;
  document.getElementById("profit-store-sales").textContent = fmtINR(storeSales);
  let totalPayroll = 0;

  const cardsHtml = [];
  const rowsHtml = [];
  staff.forEach((emp) => {
    const days = emp.days_data || {};
    let payable = 0;
    Object.values(days).forEach((v) => {
      if (v === "P" || v === "WO" || v === "PL") payable += 1;
      else if (v === "HD") payable += 0.5;
    });
    const earned = Math.round((payable / 30) * (Number(emp.monthly_salary) || 10000));
    const net = Math.max(0, earned - (Number(emp.advance_taken) || 0));
    totalPayroll += net;

    cardsHtml.push(`<div class="bg-[#FFFDF9] p-4 rounded-2xl border border-[#E5D5C6] warm-shadow"><div class="flex justify-between"><div><span class="text-[9px] font-bold bg-[#EFE5C9] text-[#5C0612] px-2 py-0.5 rounded border border-[#DAA520]">${escHtml(emp.emp_id)}</span><h4 class="font-bold text-sm mt-1">${escHtml(emp.employee_name)}</h4><p class="text-[10px] text-stone-500">${escHtml(emp.designation)}</p></div><div class="text-right font-numeric"><span class="text-[9px] text-stone-500 block">Net Payable</span><strong class="text-base font-black text-[#5C0612]">${fmtINR(net)}</strong></div></div><p class="text-[10px] text-stone-500 mt-2">Payable days: <strong>${payable}/30</strong> • Open <a href="attendance.html" class="text-[#5C0612] underline font-bold">Attendance Hub ↗</a> for full 31-day grid.</p></div>`);
    rowsHtml.push(`<tr><td class="p-3 font-bold">${escHtml(emp.employee_name)} (${escHtml(emp.emp_id)})</td><td class="p-3 text-center">${payable}</td><td class="p-3 text-center">-</td><td class="p-3 text-right">-</td><td class="p-3 text-right">${fmtINR(emp.monthly_salary)}</td><td class="p-3 text-right">₹0</td><td class="p-3 text-right">${fmtINR(emp.advance_taken)}</td><td class="p-3 text-right font-black text-[#5C0612]">${fmtINR(net)}</td><td class="p-3 text-center"><a href="attendance.html" class="text-xs text-[#5C0612] underline">Open</a></td></tr>`);
  });

  document.getElementById("staff-salary-list").innerHTML = cardsHtml.join("");
  document.getElementById("staff-salary-summary-tbody").innerHTML = rowsHtml.join("");
  document.getElementById("payroll-total-amount").textContent = fmtINR(totalPayroll);
  document.getElementById("profit-gross-amount").textContent = fmtINR(storeSales - totalPayroll);
}

async function saveAttendanceToSupabase() {
  if (!isAdminUser()) return alert("Admin access required.");
  const txt = document.getElementById("save-attendance-main-text");
  if (txt) txt.textContent = "⏳ Saving...";
  try {
    await apiRequest("/api/portal/attendance/save", {
      method: "POST",
      body: JSON.stringify({ records: allAttendanceRecords }),
    });
    alert("✅ Attendance saved to PostgreSQL database!");
  } catch (err) {
    alert("Save failed: " + err.message);
  } finally {
    if (txt) txt.textContent = "💾 Save to Database";
  }
}

// =========================================================================
// 5. EXPORTS & WHATSAPP SUMMARY
// =========================================================================
function exportSectionToPDF(sectionId, filename) {
  const el = document.getElementById(sectionId);
  if (!el || typeof html2pdf === "undefined") return alert("PDF library loading...");
  html2pdf().set({ margin: 0.25, filename: `${filename}.pdf`, html2canvas: { scale: 2 }, jsPDF: { orientation: "landscape" } }).from(el).save();
}

function shareOwnerDailySummaryWhatsApp() {
  const rows = getFilteredRows();
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const msg = `🌸 *KAILASH KALAMKARI — SALES SUMMARY*\nStore: ${selectedStore}\nTotal Sales: ${fmtINR(total)}\nLine Items: ${rows.length}`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, "_blank");
}
