/**
 * =========================================================================
 * KAILASH KALAMKARI - ENTERPRISE SALES ANALYTICS & ATTENDANCE ENGINE (app.js)
 * Master Reconciled Edition: Zero-Inflation Audited Ledger & Dual-Criteria Engine
 * =========================================================================
 */

// 1. SUPABASE CREDENTIALS CONFIGURATION
const SUPABASE_URL = window.KK_STAFF_CONFIG.url;
const SUPABASE_ANON_KEY = window.KK_STAFF_CONFIG.anonKey;

let supabaseClient = null;
if (typeof supabase !== 'undefined' && supabase.createClient) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const SESSION_TIMEOUT = 6 * 60 * 60 * 1000; // 6 Hours

// RBAC & Context
let currentRole = 'Viewer';
let currentUserId = '';
let currentEmployeeId = '';
let currentDisplayName = '';
let isAdmin = false;

// 2. MASTER 11 STAFF DATASET
const DEFAULT_ATTENDANCE_DATA = [
  {
    "Emp ID": "KS-103",
    "Employee Name": "B varalakshmi"
  },
  {
    "Emp ID": "KS-104",
    "Employee Name": "Ty mounika"
  },
  {
    "Emp ID": "KS-105",
    "Employee Name": "r sanjana"
  },
  {
    "Emp ID": "KS-106",
    "Employee Name": "geethika"
  },
  {
    "Emp ID": "KS-107",
    "Employee Name": "J sandhya"
  },
  {
    "Emp ID": "KS-108",
    "Employee Name": "c Pushpa"
  },
  {
    "Emp ID": "KS-109",
    "Employee Name": "Bharathamma"
  },
  {
    "Emp ID": "KS-110",
    "Employee Name": "Nandhini"
  },
  {
    "Emp ID": "KS-111",
    "Employee Name": "Harika"
  },
  {
    "Emp ID": "KS-112",
    "Employee Name": "Dhanalakshmi"
  },
  {
    "Emp ID": "KS-113",
    "Employee Name": "M.Ammulu"
  }
];

// 3. MASTER STAFF ALIAS RESOLUTION MAP
const STAFF_ALIASES_MAP = {
  'KS-103': ['varalakshmi', 'vara lakshmi', 'b varalakshmi', 'b. varalakshmi', 'varalaxmi', 'varalakshmi b'],
  'KS-104': ['mouni', 'mounika', 'ty mounika', 't y mounika', 't.y. mounika', 'mounika ty'],
  'KS-105': ['sanjana', 'r sanjana', 'r. sanjana', 'sanjana r'],
  'KS-106': ['geethika', 'githika', 'gethika'],
  'KS-107': ['sandhya', 'j sandhya', 'j. sandhya', 'sandhya j'],
  'KS-108': ['pushpa', 'c pushpa', 'c. pushpa', 'pushpa c'],
  'KS-109': ['bharathamma', 'barathamma', 'bharatamma'],
  'KS-110': ['nandhini', 'nandini'],
  'KS-111': ['harika'],
  'KS-112': ['dhanalakshmi', 'dhana lakshmi', 'dhana laskhmi', 'dhana laskhmi akka', 'dhanalakshmi akka', 'dhanalaxmi'],
  'KS-113': ['ammulu', 'm.ammulu', 'm ammulu', 'ammulu m']
};

// Global State
let rawData = [];
let rawAttendanceData = [];
let bankAccountsList = ['Cash', '42441-TJ', 'KC'];
let productsList = [];
let agentsList = [];

// Advanced Analytics Models
let crossSellPairsList = [];
let priceTierBreakdown = {};
let dayOfWeekHeatmap = {};

// Filters & Settings
let selectedStore = "All";
let selectedCategory = "All";
let selectedAttendanceMonth = "September 2026";
let selectedChannel = "All";
let activeAnalysisAgent = "";
let monthlyTarget = parseFloat(localStorage.getItem('kk_monthly_target')) || 1000000;
let attendanceViewMode = 'grid';

// DOM Helpers
function getEl(id) { return document.getElementById(id); }
function showEl(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hideEl(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

// =============================================================
// 1. ROBUST BRANCH NORMALIZER
// =============================================================
function normalizeBranch(b) {
  if (!b) return 'Main Branch';
  const clean = b.toString().trim();
  const upper = clean.toUpperCase();
  if (!upper || upper === 'ALL' || upper === 'UNDEFINED' || upper === 'NULL') return 'All';
  if (upper === 'KHPS' || upper === 'KHPS-FR' || upper.startsWith('KHPS')) {
    return 'KHPS';
  }
  return clean;
}

function extractStoreBranch(r) {
  if (!r) return 'Main Branch';
  const val = r.branch || r.branch_name || r.store_name || r.store ||
              r['Branch'] || r['Branch Name'] || r['BRANCH'] ||
              r['STORE NAME'] || r['Store Name'] || r['Store'] || '';
  return normalizeBranch(val);
}

// =============================================================
// 2. BULLETPROOF DATE PARSER (YYYY-MM-DD)
// =============================================================
function parseToYYYYMMDD(val) {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  let str = String(val).trim();
  if (!str) return '';

  if (/^\d{10,13}$/.test(str)) {
    const num = parseInt(str, 10);
    const d = new Date(num > 1e11 ? num : num * 1000);
    if (!isNaN(d.getTime())) return parseToYYYYMMDD(d);
  }

  const iso = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  }

  const dMmmY = str.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})/);
  if (dMmmY) {
    const day = String(dMmmY[1]).padStart(2, '0');
    const mStr = dMmmY[2].substring(0, 3).toLowerCase();
    let yr = parseInt(dMmmY[3], 10);
    if (yr < 100) yr += 2000;
    const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    if (months[mStr]) return `${yr}-${months[mStr]}-${day}`;
  }

  const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    let day = parseInt(dmy[1], 10);
    let month = parseInt(dmy[2], 10);
    let yr = parseInt(dmy[3], 10);
    if (yr < 100) yr += 2000;
    if (month > 12 && day <= 12) {
      const temp = day; day = month; month = temp;
    }
    return `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return '';
}

// =============================================================
// 3. MASTER STAFF RESOLUTION
// =============================================================
function resolveStaffToMasterName(rawName) {
  if (!rawName) return 'No Agent';
  const clean = rawName.toString().trim();
  if (!clean || clean === '-' || clean === 'N/A' || clean === 'null' || clean === 'undefined') return 'No Agent';
  if (/^\d+$/.test(clean)) return 'No Agent';

  const cleanSm = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanSm) return 'No Agent';

  for (let [empId, aliases] of Object.entries(STAFF_ALIASES_MAP)) {
    const staffObj = DEFAULT_ATTENDANCE_DATA.find(s => s['Emp ID'] === empId);
    const displayName = staffObj ? staffObj['Employee Name'] : empId;

    for (let alias of aliases) {
      const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanSm === cleanAlias || cleanSm.includes(cleanAlias) || cleanAlias.includes(cleanSm)) {
        return displayName;
      }
    }
  }

  if (cleanSm.includes('chenna') || cleanSm.includes('kesava')) return 'Chenna Kesava Reddy';
  if (cleanSm.includes('venkatesh')) return 'Venkatesh';
  if (cleanSm.includes('kailash')) return 'Kailash Anna';
  if (cleanSm.includes('admin')) return 'ADMIN';

  return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function extractStaffName(row) {
  if (!row) return 'No Agent';
  const raw = row.sm_name || row.agent_name || row.sales_agent ||
              row.sales_person || row.staff_name || row.employee_name ||
              row['SM Name'] || row['AGENT NAME'] || row['Agent Name'] ||
              row['Sales Person'] || row['Agent'] || '';
  return resolveStaffToMasterName(raw);
}

function classifyExactChannel(row) {
  if (!row) return 'Offline';

  const directChannel = (row.channel || row.sales_channel || row['Channel'] || row['CHANNEL'] || row['Sales Channel'] || '').toString().trim();
  const lowerDirect = directChannel.toLowerCase();
  if (lowerDirect.includes('online') || lowerDirect.includes('website') || lowerDirect.includes('instagram')) return 'Online';
  if (lowerDirect.includes('hand') || lowerDirect.includes('wholesale') || lowerDirect.includes('tbh')) return 'Wholesale';
  if (lowerDirect.includes('offline') || lowerDirect.includes('counter') || lowerDirect.includes('showroom')) return 'Offline';

  const store = extractStoreBranch(row).toLowerCase();
  const saleType = (row.sale_type || row.sales_type || row['SALES TYPE'] || row['Sale Type'] || '').toString().toLowerCase().trim();
  const billNo = (row.bill_no || row['BILL NO'] || row['Bill No'] || '').toString().toUpperCase().trim();
  const payMode = (row.pay_mode || row['PAY MODE'] || row['Pay Mode'] || '').toString().toLowerCase().trim();

  if (billNo.startsWith('TBH') || billNo.startsWith('WS') ||
      store.includes('takebyhand') || store.includes('take by hand') || store.includes('wholesale') ||
      saleType.includes('takebyhand') || saleType.includes('take by hand') || saleType.includes('wholesale') ||
      payMode.includes('take by hand') || payMode.includes('wholesale') || payMode.includes('tbh')) {
    return 'Wholesale';
  }

  if (store.includes('online') || store.includes('website') || store.includes('instagram') ||
      saleType.includes('online') || saleType.includes('website') ||
      payMode.includes('razorpay')) {
    return 'Online';
  }

  return 'Offline';
}

function getItemCategory(itemName) {
  if (!itemName) return 'General';
  const name = itemName.toString().toLowerCase();

  if (name.includes('frame') || name.includes('painting') || name.includes('canvas') || name.includes('photo')) {
    return 'Frames';
  }
  if (name.includes('duppata') || name.includes('dupatta') || name.includes('fabric') ||
      name.includes('meter') || name.includes('blouse') || name.includes('running') ||
      name.includes('chanderi') || name.includes('organze')) {
    return 'Fabrics';
  }
  if (name.includes('saree') || name.includes('sari') || name.includes('silk') ||
      name.includes('pattu') || name.includes('patola') || name.includes('gadwal') ||
      name.includes('ikkat') || name.includes('kanchi') || name.includes('tussar') ||
      name.includes('crape') || name.includes('chennur') || name.includes('mangalagiri') ||
      name.includes('cotton')) {
    return 'Sarees';
  }
  return 'General';
}

function getMonthYearContext(monthStr) {
  let year = new Date().getFullYear();
  let monthIndex = new Date().getMonth();

  if (monthStr && monthStr !== 'All') {
    const yMatch = monthStr.match(/\b(20\d\d)\b/);
    if (yMatch) year = parseInt(yMatch[1], 10);

    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const cleanM = monthStr.toLowerCase();
    for (let key in monthMap) {
      if (cleanM.includes(key)) {
        monthIndex = monthMap[key];
        break;
      }
    }
  }

  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayInfo = [];
  let totalSundaysInMonth = 0;
  for (let d = 1; d <= 31; d++) {
    if (d <= daysInMonth) {
      const dt = new Date(year, monthIndex, d);
      const dayOfWeek = dt.getDay();
      const isSunday = dayOfWeek === 0;
      if (isSunday) totalSundaysInMonth++;
      dayInfo[d] = {
        valid: true,
        weekday: dayNames[dayOfWeek],
        isSunday: isSunday,
        label: `${d < 10 ? '0' + d : d} ${dayNames[dayOfWeek]}`
      };
    } else {
      dayInfo[d] = { valid: false, weekday: '', isSunday: false, label: `${d < 10 ? '0' + d : d}` };
    }
  }

  return { year, monthIndex, monthName: monthNames[monthIndex], daysInMonth, dayInfo, totalSundaysInMonth };
}

function checkSession() { return KK.identity() || { valid: false }; }
async function handleLogout() {
  await KK.logout();
  location.reload();
}

// =============================================================
// 4. ZERO-INFLATION FETCH ENGINE
// =============================================================
async function fetchData(user, pass) {
  const cleanUser = (user || 'admin').trim().toLowerCase();
  const cleanPass = (pass || '').trim();

  if (!supabaseClient) {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
      alert("Supabase JS Library is not loaded.");
      return;
    }
  }

  showEl('loader');
  hideEl('standard-main');
  hideEl('login-screen');

  try {
    if (cleanPass) {
      try { await KK.login(supabaseClient, cleanUser, pass); }
      catch (error) { showLoginError(error.message); return; }
    }
    const session = await KK.session(supabaseClient);
    if (!session) { showLoginError('Session expired. Sign in with your user ID and password.'); return; }
    currentRole = session.role;
    currentUserId = session.user;
    currentEmployeeId = session.empId;
    currentDisplayName = session.displayName;
    isAdmin = currentRole === 'Admin';

    // KK-CEO-003: Owner/Admin read-only dashboard data.
    if (!['owner', 'admin'].includes(session.secureRole)) {
      throw new Error('This dashboard requires Owner or Admin access.');
    }

    const { data: authSession, error: authError } =
      await supabaseClient.auth.getSession();

    const accessToken = authSession?.session?.access_token;

    if (authError || !accessToken) {
      throw new Error('Session expired. Please sign in again.');
    }

    const dashboardResponse = await fetch('/api/owner-dashboard', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    if (!dashboardResponse.ok) {
      throw new Error('Secure dashboard data could not be loaded.');
    }

    const dashboardData = await dashboardResponse.json();

    if (
      dashboardData?.read_only !== true ||
      !Array.isArray(dashboardData.sales) ||
      !Array.isArray(dashboardData.receivables) ||
      !Array.isArray(dashboardData.bills_master) ||
      ['sales', 'receivables', 'bills_master'].some(name =>
        dashboardData.counts?.[name] !== dashboardData[name].length)
    ) {
      throw new Error('Incomplete dashboard response.');
    }

    renderProductionMonthlySnapshot(dashboardData.production_monthly_snapshot);

    const recRows = dashboardData.receivables;
    const masters = dashboardData.bills_master;
    const allSalesRecords = dashboardData.sales;
    const masterIndex = KK.invoiceIndex(masters);
    const reconciled = KK.invoiceGroups(allSalesRecords, masterIndex);
    KK.reconciliationNotice(reconciled.excluded, reconciled.issues, dashboardData.reconciliation?.duplicate_invoice_references || 0);
    const settledReceivablesMap = new Map();
    for (const receipt of recRows) {
      const match = KK.matchInvoice(receipt, masterIndex);
      if (!match.ambiguous && receipt.bank_account) {
        if (!settledReceivablesMap.has(match.key)) settledReceivablesMap.set(match.key, []);
        settledReceivablesMap.get(match.key).push({ account: receipt.bank_account, amount: KK.number(receipt.amount) });
      }
    }
    const cleanSales = [];
    reconciled.groups.forEach(({ key: invoiceKey, master: masterBill, items }) => {
      const billNoUpper = KK.invoiceParts(items[0]).bill || invoiceKey;
      const masterTotal = masterBill ? (parseFloat(masterBill.bill_amount) || 0) : null;
      const masterBranch = masterBill ? normalizeBranch(masterBill.branch) : null;
      const masterDate = masterBill ? parseToYYYYMMDD(masterBill.bill_date) : null;
      const masterAgent = masterBill ? resolveStaffToMasterName(masterBill.sm_name) : null;
      const masterChannel = masterBill ? classifyExactChannel(masterBill) : null;

      const computedItemAmounts = KK.amounts(items, masterTotal);
      const lineItemSum = computedItemAmounts.reduce((sum, n) => sum + n, 0);

      items.forEach((r, idx) => {
        const rawBillNo = (r.bill_no || r['BILL NO'] || r['Bill No'] || billNoUpper).toString().trim();
        const rawDate = masterDate || parseToYYYYMMDD(r.bill_date || r.date || r['Bill Date'] || r.created_at);
        const rawStore = masterBranch || extractStoreBranch(r);
        const rawItem = (r.item_name || r['ITEM NAME'] || r['Item Name'] || 'General Item').trim();
        const rawQty = KK.quantity(r);
        const rawSM = masterAgent || extractStaffName(r);
        const rawPayMode = (r.pay_mode || r['PAY MODE'] || r['Pay Mode'] || 'Cash').toString().trim();
        const allocations = settledReceivablesMap.get(invoiceKey) || [];
        const rawBank = allocations.length === 1 ? allocations[0].account : 'Unallocated';
        const rawSaleType = masterChannel || classifyExactChannel(r);

        let itemRevenue = computedItemAmounts[idx];
        cleanSales.push({
          'id': r.id || `${billNoUpper}_${idx}`,
          'Bill No': rawBillNo,
          'Bill Key': invoiceKey,
          'Bill Date': rawDate,
          'Store': rawStore,
          'Item Name': rawItem,
          'Qty': rawQty,
          'Final Amount': itemRevenue,
          'amount': itemRevenue,
          'SM Name': rawSM,
          'PayMode': rawPayMode,
          'Sale type': rawSaleType,
          'Acc No': rawBank,
          'Bank Allocations': allocations,
          'Invoice Total': masterTotal ?? lineItemSum
        });
      });
    });

    rawData = cleanSales;

    // Attendance/payroll are deferred from the read-only first release.
    rawAttendanceData = [];

    bankAccountsList = ['Cash', '42441-TJ', 'KC'];
    updateHeaderRoleBadges();
    routeUserToRolePrimaryDashboard();

  } catch (err) {
    rawData = [];
    hideEl('standard-header');
    hideEl('standard-main');
    showLoginError(err.message || 'Dashboard unavailable. Please retry.');
    console.error("Fetch Error:", err);
    alert("Connection failed: " + (err.message || "Network Error"));
  } finally {
    hideEl('loader');
  }
}

function renderProductionMonthlySnapshot(snapshot) {
  const panel = document.getElementById('production-monthly-panel');
  if (!panel) return;
  panel.classList.add('hidden');
  const rows = document.getElementById('production-monthly-rows');
  const total = document.getElementById('production-monthly-total');
  const note = document.getElementById('production-monthly-note');
  rows.replaceChildren();
  if (!snapshot || snapshot.type !== 'read_only_production_aggregate_snapshot' ||
      !Array.isArray(snapshot.items) || snapshot.items.length !== 8) return;
  const money = paise => '₹' + (paise / 100).toLocaleString('en-IN',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let sum = 0, count = 0;
  for (const item of snapshot.items) {
    if (!Number.isSafeInteger(item.recorded_sales_paise) ||
        !Number.isSafeInteger(item.sales_rows) ||
        !/^2026-(0[6-9]|10)$/.test(item.month) ||
        !['KHPS', 'Main Branch'].includes(item.branch)) return;
    sum += item.recorded_sales_paise;
    count += item.sales_rows;
    const tr = document.createElement('tr');
    tr.className = 'border-b border-stone-200';
    for (const value of [item.month, item.branch, item.sales_rows.toLocaleString('en-IN'), money(item.recorded_sales_paise)]) {
      const td = document.createElement('td');
      td.className = 'py-2';
      td.textContent = String(value);
      tr.appendChild(td);
    }
    rows.appendChild(tr);
  }
  if (sum !== 4545148532 || count !== 5051) {
    rows.replaceChildren();
    return;
  }
  note.textContent = 'Read-only aggregate extract · June–October 2026 · October partial · No customer details';
  total.textContent = `${money(sum)} recorded sales · ${count.toLocaleString('en-IN')} sales rows`;
  panel.classList.remove('hidden');
}

function showLoginError(message) {
  showEl('login-screen');
  hideEl('loader');
  const errEl = getEl('login-error');
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.remove('hidden');
  }
}

function updateHeaderRoleBadges() {
  const badge = getEl('user-role-badge');
  const nameEl = getEl('user-display-name');

  if (badge) {
    if (isAdmin) {
      badge.textContent = 'OWNER / ADMIN · READ ONLY';
      badge.className = "text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full bg-[#DAA520] text-[#5C0612] tracking-wider font-sans";
    } else {
      badge.textContent = '👁️ VIEWER (READ ONLY)';
      badge.className = "text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-300 tracking-wider font-sans";
    }
  }

  if (nameEl) nameEl.textContent = `${currentDisplayName} (${currentEmployeeId})`;

  document.querySelectorAll('.admin-only, .role-admin-only').forEach(el => {
    if (isAdmin) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });

  const targetInput = getEl('target-input-field');
  if (targetInput) {
    targetInput.disabled = !isAdmin;
    if (!isAdmin) targetInput.classList.add('opacity-70', 'cursor-not-allowed');
  }
}

function routeUserToRolePrimaryDashboard() {
  showEl('standard-header');
  hideEl('login-screen');
  hideEl('loader');
  showEl('standard-main');

  detectDateRanges();
  detectAndPopulateStores();
  populateBankDropdown();
  populateAttendanceMonthDropdown();
  processData();
}

function detectAndPopulateStores() {
  const storeSelect = getEl('store-filter');
  if (!storeSelect) return;
  const storeSet = new Set();
  rawData.forEach(row => {
    const sName = normalizeBranch(row['Store']);
    if (sName && sName !== 'All') storeSet.add(sName);
  });
  storeSelect.innerHTML = `<option value="All">All Branches / Stores</option>`;
  storeSet.forEach(sName => {
    storeSelect.innerHTML += `<option value="${KK.escape(sName)}">${KK.escape(sName)}</option>`;
  });
}

function selectStoreFilter(storeName) {
  const storeSelect = getEl('store-filter');
  if (storeSelect) {
    storeSelect.value = storeName;
    processData();
  }
}

function populateBankDropdown() {
  const bSelect = getEl('bank-filter-select');
  if (!bSelect) return;
  const bankSet = new Set(['Cash', '42441-TJ', 'KC', ...bankAccountsList]);
  bSelect.innerHTML = `<option value="All">All Bank Accounts</option>`;
  bankSet.forEach(bk => {
    bSelect.innerHTML += `<option value="${KK.escape(bk)}">${KK.escape(bk)}</option>`;
  });
}

function populateAttendanceMonthDropdown() {
  const mSelect = getEl('attendance-month-select');
  if (!mSelect) return;

  const monthSet = new Set();
  rawAttendanceData.forEach(emp => {
    if (emp['Month_Sheet']) monthSet.add(emp['Month_Sheet']);
  });

  const list = Array.from(monthSet);
  if (list.length === 0) list.push("September 2026");

  mSelect.innerHTML = list.map(m => `<option value="${KK.escape(m)}" ${m === selectedAttendanceMonth ? 'selected' : ''}>${KK.escape(m)}</option>`).join('');
}

function detectDateRanges() {
  const fromEl = getEl('from-date');
  const toEl = getEl('to-date');
  const allDates = getAllNormalizedDates();

  if (allDates.length === 0) return;
  if (fromEl) fromEl.value = allDates[0];
  if (toEl) toEl.value = allDates[allDates.length - 1];
  highlightActiveQuickDateButton('all');
}

function getAllNormalizedDates() {
  if (!rawData || rawData.length === 0) return [];
  const dateSet = new Set();
  rawData.forEach(row => {
    const norm = row['Bill Date'];
    if (norm) dateSet.add(norm);
  });
  return Array.from(dateSet).sort();
}

function setQuickDateRange(preset) {
  const allDates = getAllNormalizedDates();
  const realToday = new Date();
  const realTodayStr = parseToYYYYMMDD(realToday);

  let refDateStr = allDates.length > 0 ? (allDates.includes(realTodayStr) ? realTodayStr : allDates[allDates.length - 1]) : realTodayStr;
  const [y, m, d] = refDateStr.split('-').map(Number);

  let fromDate = refDateStr, toDate = refDateStr;

  if (preset === 'today') {
    fromDate = refDateStr;
    toDate = refDateStr;
  } else if (preset === 'yesterday') {
    const yest = new Date(y, m - 1, d - 1);
    fromDate = parseToYYYYMMDD(yest);
    toDate = fromDate;
  } else if (preset === 'latest' && allDates.length > 0) {
    fromDate = allDates[allDates.length - 1];
    toDate = allDates[allDates.length - 1];
  } else if (preset === 'week') {
    const refDate = new Date(y, m - 1, d);
    const dayOfWeek = refDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(y, m - 1, d - diffToMonday);
    fromDate = parseToYYYYMMDD(monday);
    toDate = refDateStr;
  } else if (preset === 'month') {
    fromDate = parseToYYYYMMDD(new Date(y, m - 1, 1));
    toDate = parseToYYYYMMDD(new Date(y, m, 0));
  } else if (preset === 'all' && allDates.length > 0) {
    fromDate = allDates[0];
    toDate = allDates[allDates.length - 1];
  }

  const fromEl = getEl('from-date');
  const toEl = getEl('to-date');
  if (fromEl) fromEl.value = fromDate;
  if (toEl) toEl.value = toDate;

  highlightActiveQuickDateButton(preset);
  processData();
}

function highlightActiveQuickDateButton(activePreset) {
  document.querySelectorAll('.quick-date-btn').forEach(btn => {
    btn.className = "quick-date-btn bg-[#FAF6EE] hover:bg-[#EFE5C9] text-stone-700 font-bold px-2.5 py-1 rounded-lg border border-[#E5D5C6] transition-all";
  });
  const activeBtn = getEl(`btn-date-${activePreset}`);
  if (activeBtn) {
    activeBtn.className = "quick-date-btn bg-[#5C0612] text-[#EFE5C9] font-black px-2.5 py-1 rounded-lg border border-[#DAA520] shadow-xs transition-all";
  }
}

// =============================================================
// 5. CORE ANALYTICS ENGINE (AUDITED DUAL CRITERIA RECONCILIATION)
// =============================================================
function processData() {
  const rawFrom = getEl('from-date') ? getEl('from-date').value.trim() : '';
  const rawTo = getEl('to-date') ? getEl('to-date').value.trim() : '';
  const fromDate = parseToYYYYMMDD(rawFrom);
  const toDate = parseToYYYYMMDD(rawTo);
  const searchVal = getEl('product-search') ? getEl('product-search').value.toLowerCase().trim() : '';
  selectedStore = getEl('store-filter') ? getEl('store-filter').value : 'All';

  // STRICT DUAL CRITERIA FILTER (Store Branch + Date Range)
  const filtered = rawData.filter(row => {
    const rDate = row['Bill Date'];
    if (fromDate && (!rDate || rDate < fromDate)) return false;
    if (toDate && (!rDate || rDate > toDate)) return false;
    if (selectedStore !== 'All' && normalizeBranch(row['Store']) !== normalizeBranch(selectedStore)) return false;
    return true;
  });

  let totalSales = 0, totalOnline = 0, totalOffline = 0, totalWholesale = 0, totalUnits = 0;
  let payUpiStore = 0, payUpiOnline = 0, payCash = 0, payCard = 0, payHand = 0;

  const uniqueBills = new Set();
  const productsObj = {}, agentsObj = {}, dayWiseObj = {}, accountTotals = {};
  const billBaskets = {};

  priceTierBreakdown = {
    budget: { label: 'Budget (<₹1,500)', count: 0, revenue: 0, color: 'text-amber-700', border: 'border-amber-300' },
    mid: { label: 'Mid-Range (₹1.5k–₹5k)', count: 0, revenue: 0, color: 'text-blue-700', border: 'border-blue-300' },
    premium: { label: 'Premium Silk (₹5k–₹12k)', count: 0, revenue: 0, color: 'text-purple-700', border: 'border-purple-300' },
    luxury: { label: 'Luxury Heritage (>₹12k)', count: 0, revenue: 0, color: 'text-[#5C0612]', border: 'border-[#DAA520]' }
  };

  dayOfWeekHeatmap = {
    'Sun': { label: 'Sunday', revenue: 0, bills: new Set() },
    'Mon': { label: 'Monday', revenue: 0, bills: new Set() },
    'Tue': { label: 'Tuesday', revenue: 0, bills: new Set() },
    'Wed': { label: 'Wednesday', revenue: 0, bills: new Set() },
    'Thu': { label: 'Thursday', revenue: 0, bills: new Set() },
    'Fri': { label: 'Friday', revenue: 0, bills: new Set() },
    'Sat': { label: 'Saturday', revenue: 0, bills: new Set() }
  };

  filtered.forEach(row => {
    const amount = parseFloat(row['amount']) || 0;
    const qty = KK.number(row['Qty'], 1);
    const item = row['Item Name'] || 'General Item';
    const agent = row['SM Name'] || 'No Agent';
    const payMode = (row['PayMode'] || 'Cash').toLowerCase();
    const billDate = row['Bill Date'];
    const billNo = row['Bill Key'] || row['Bill No'];
    const channel = row['Sale type'];

    totalSales += amount;
    totalUnits += qty;

    const bAcc = row['Acc No'] || 'Cash';
    const allocations = row['Bank Allocations'] || [];
    const invoiceTotal = row['Invoice Total'];
    let allocated = 0;
    if (invoiceTotal > 0) allocations.forEach(split => {
      const share = split.amount * amount / invoiceTotal;
      accountTotals[split.account] = (accountTotals[split.account] || 0) + share;
      allocated += share;
    });
    accountTotals['Unallocated'] = (accountTotals['Unallocated'] || 0) + amount - allocated;

    if (payMode.includes('cash')) payCash += amount;
    else if (payMode.includes('card')) payCard += amount;
    else if (payMode.includes('hand') || payMode.includes('wholesale') || payMode.includes('tbh')) payHand += amount;
    else if (channel === 'Online') payUpiOnline += amount;
    else payUpiStore += amount;

    if (channel === 'Online') totalOnline += amount;
    else if (channel === 'Wholesale') totalWholesale += amount;
    else totalOffline += amount;

    const billKey = row['Bill Key'] || KK.invoiceParts(row).key;
    uniqueBills.add(billKey);

    if (!billBaskets[billKey]) billBaskets[billKey] = [];
    billBaskets[billKey].push(item);

    const unitPrice = qty > 0 ? (amount / qty) : amount;
    if (unitPrice < 1500) { priceTierBreakdown.budget.count += qty; priceTierBreakdown.budget.revenue += amount; }
    else if (unitPrice <= 5000) { priceTierBreakdown.mid.count += qty; priceTierBreakdown.mid.revenue += amount; }
    else if (unitPrice <= 12000) { priceTierBreakdown.premium.count += qty; priceTierBreakdown.premium.revenue += amount; }
    else { priceTierBreakdown.luxury.count += qty; priceTierBreakdown.luxury.revenue += amount; }

    if (billDate && channel !== 'Wholesale') {
      const dt = new Date(billDate);
      const dayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
      if (dayOfWeekHeatmap[dayShort]) {
        dayOfWeekHeatmap[dayShort].revenue += amount;
        dayOfWeekHeatmap[dayShort].bills.add(billKey);
      }
    }

    if (billDate) {
      if (!dayWiseObj[billDate]) dayWiseObj[billDate] = { total: 0, agents: {} };
      dayWiseObj[billDate].total += amount;
      dayWiseObj[billDate].agents[agent] = (dayWiseObj[billDate].agents[agent] || 0) + amount;
    }

    if (!productsObj[item]) {
      productsObj[item] = { name: item, qty: 0, revenue: 0, onlineQty: 0, offlineQty: 0, wholesaleQty: 0 };
    }
    productsObj[item].qty += qty;
    productsObj[item].revenue += amount;
    if (channel === 'Online') productsObj[item].onlineQty += qty;
    else if (channel === 'Wholesale') productsObj[item].wholesaleQty += qty;
    else productsObj[item].offlineQty += qty;

    if (!agentsObj[agent]) {
      agentsObj[agent] = {
        name: agent,
        revenue: 0,
        onlineRevenue: 0,
        offlineRevenue: 0,
        tbhRevenue: 0,
        bills: {},
        unitCount: 0
      };
    }
    agentsObj[agent].revenue += amount;
    agentsObj[agent].unitCount += qty;
    if (channel === 'Online') agentsObj[agent].onlineRevenue += amount;
    else if (channel === 'Wholesale') agentsObj[agent].tbhRevenue += amount;
    else agentsObj[agent].offlineRevenue += amount;

    if (!agentsObj[agent].bills[billKey]) agentsObj[agent].bills[billKey] = 0;
    agentsObj[agent].bills[billKey] += amount;
  });

  const pairCounts = {};
  Object.values(billBaskets).forEach(items => {
    if (items.length >= 2) {
      const distinctNames = Array.from(new Set(items));
      for (let i = 0; i < distinctNames.length; i++) {
        for (let j = i + 1; j < distinctNames.length; j++) {
          const pairKey = [distinctNames[i], distinctNames[j]].sort().join(' + ');
          pairCounts[pairKey] = (pairCounts[pairKey] || 0) + 1;
        }
      }
    }
  });

  crossSellPairsList = Object.entries(pairCounts)
    .map(([pair, count]) => ({ pair, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  setText('metric-total', `₹${Math.round(totalSales).toLocaleString('en-IN')}`);
  setText('metric-online', `₹${Math.round(totalOnline).toLocaleString('en-IN')}`);
  setText('metric-offline', `₹${Math.round(totalOffline).toLocaleString('en-IN')}`);
  setText('metric-wholesale', `₹${Math.round(totalWholesale).toLocaleString('en-IN')}`);

  const targetPct = monthlyTarget > 0 ? Math.min(100, Math.round((totalSales / monthlyTarget) * 100)) : 0;
  setText('target-percent-text', `${targetPct}%`);
  setText('target-achieved-text', `₹${Math.round(totalSales).toLocaleString('en-IN')}`);
  const targetBar = getEl('target-progress-bar');
  if (targetBar) targetBar.style.width = `${targetPct}%`;

  setText('paymode-upi-store', `₹${Math.round(payUpiStore).toLocaleString('en-IN')}`);
  setText('paymode-upi-onl', `₹${Math.round(payUpiOnline).toLocaleString('en-IN')}`);
  setText('paymode-cash', `₹${Math.round(payCash).toLocaleString('en-IN')}`);
  setText('paymode-card', `₹${Math.round(payCard).toLocaleString('en-IN')}`);
  setText('paymode-hand', `₹${Math.round(payHand).toLocaleString('en-IN')}`);

  const totalTransactions = uniqueBills.size;
  setText('metric-upt', (totalTransactions > 0 ? (totalUnits / totalTransactions) : 0).toFixed(2));
  setText('metric-atv', `₹${Math.round(totalTransactions > 0 ? (totalSales / totalTransactions) : 0).toLocaleString('en-IN')}`);
  setText('metric-auv', `₹${Math.round(totalUnits > 0 ? (totalSales / totalUnits) : 0).toLocaleString('en-IN')}`);
  setText('metric-asp', `₹${Math.round(totalUnits > 0 ? (totalSales / totalUnits) : 0).toLocaleString('en-IN')}`);

  const accContainer = getEl('account-split-container');
  if (accContainer) {
    accContainer.innerHTML = Object.entries(accountTotals).map(([acc, amt]) => `
      <div class="bg-amber-50/60 p-2.5 rounded-xl border border-amber-200 text-center">
        <span class="block text-[8px] font-bold text-amber-800 uppercase font-traditional tracking-wider">${KK.escape(acc)}</span>
        <strong class="text-xs font-black text-[#5C0612] font-numeric">₹${Math.round(amt).toLocaleString('en-IN')}</strong>
      </div>
    `).join('');
  }

  productsList = Object.values(productsObj).map(p => {
    p.category = getItemCategory(p.name);
    return p;
  }).filter(p => p.name.toLowerCase().includes(searchVal));

  agentsList = Object.values(agentsObj).map(a => {
    a.billCount = Object.keys(a.bills).length;
    a.upt = a.billCount > 0 ? (a.unitCount / a.billCount) : 0;
    a.atv = a.billCount > 0 ? (a.revenue / a.billCount) : 0;
    return a;
  });

  renderProductsTable();
  renderAgentsTable();
  renderDayWiseSales(dayWiseObj);
  renderAttendanceSalaryModule(totalSales, filtered);
  renderAdvancedSalesInsights(totalSales, totalTransactions);
}

// -------------------------------------------------------------
// 6. RENDER TABLES & ADVANCED INSIGHTS
// -------------------------------------------------------------
function renderAdvancedSalesInsights(totalSales, totalTransactions) {
  const crossSellContainer = getEl('cross-sell-pairs-container');
  if (crossSellContainer) {
    if (crossSellPairsList.length === 0) {
      crossSellContainer.innerHTML = `<p class="text-xs text-stone-400 p-3 text-center col-span-2">No multi-item bills recorded in this period.</p>`;
    } else {
      crossSellContainer.innerHTML = crossSellPairsList.map(pair => `
        <div class="flex justify-between items-center bg-[#FAF6EE] p-2.5 rounded-xl border border-[#E5D5C6] text-xs">
          <span class="font-bold text-stone-800"><i class="fa-solid fa-link text-[#DAA520] mr-1.5"></i> ${KK.escape(pair.pair)}</span>
          <span class="bg-[#5C0612] text-[#EFE5C9] font-black px-2 py-0.5 rounded-lg text-[10px] font-numeric">${pair.count} Bills</span>
        </div>
      `).join('');
    }
  }

  const priceTierContainer = getEl('price-tier-cards-container');
  if (priceTierContainer) {
    priceTierContainer.innerHTML = Object.values(priceTierBreakdown).map(tier => {
      const sharePct = totalSales > 0 ? Math.round((tier.revenue / totalSales) * 100) : 0;
      return `
        <div class="bg-[#FFFDF9] p-3.5 rounded-2xl border ${tier.border} warm-shadow space-y-1">
          <p class="text-[9px] font-bold text-stone-500 uppercase font-traditional">${tier.label}</p>
          <p class="text-base font-black ${tier.color} font-numeric">₹${Math.round(tier.revenue).toLocaleString('en-IN')}</p>
          <div class="flex justify-between text-[9px] text-stone-500 font-numeric pt-1 border-t border-stone-200">
            <span>${tier.count} Units Sold</span>
            <strong class="text-stone-800 font-bold">${sharePct}% Revenue</strong>
          </div>
        </div>
      `;
    }).join('');
  }

  const dayHeatmapContainer = getEl('day-of-week-heatmap-container');
  if (dayHeatmapContainer) {
    const totalWeeklyVelocity = Object.values(dayOfWeekHeatmap).reduce((sum, d) => sum + d.revenue, 0);

    dayHeatmapContainer.innerHTML = Object.entries(dayOfWeekHeatmap).map(([dayKey, dayData]) => {
      const sharePct = totalWeeklyVelocity > 0
        ? ((dayData.revenue / totalWeeklyVelocity) * 100).toFixed(1)
        : '0.0';
      const invoiceCount = dayData.bills ? dayData.bills.size : (dayData.count || 0);

      return `
        <div class="p-3 rounded-2xl border text-center font-numeric bg-[#FAF6EE] border-[#E5D5C6] warm-shadow flex flex-col justify-between hover:border-[#DAA520] transition-all">
          <div>
            <div class="flex items-center justify-between gap-1 mb-1">
              <span class="text-[10px] font-bold text-stone-700 uppercase font-traditional tracking-wider">${dayData.label}</span>
              <span class="bg-[#5C0612] text-[#EFE5C9] font-black px-1.5 py-0.5 rounded text-[9px] font-numeric">${sharePct}%</span>
            </div>
            <strong class="block text-sm sm:text-base font-black text-[#5C0612] mt-0.5">
              ₹${Math.round(dayData.revenue).toLocaleString('en-IN')}
            </strong>
            <div class="w-full bg-[#E5D5C6]/40 h-1.5 rounded-full overflow-hidden my-1.5">
              <div class="bg-[#DAA520] h-full rounded-full transition-all duration-300" style="width: ${sharePct}%"></div>
            </div>
          </div>
          <div class="pt-1 border-t border-[#E5D5C6]/50 text-[9px] text-stone-500 font-semibold">
            ${invoiceCount} Invoices
          </div>
        </div>
      `;
    }).join('');
  }
}

function filterCategory(cat) {
  selectedCategory = cat;
  ['All', 'Sarees', 'Fabrics', 'Frames'].forEach(c => {
    const btn = getEl(`cat-btn-${c.toLowerCase()}`);
    if (btn) {
      btn.className = c === cat
        ? "px-3 py-1 rounded-full bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-bold shadow-sm"
        : "px-3 py-1 rounded-full bg-[#FFFDF9] text-stone-600 border border-[#E5D5C6] hover:bg-stone-100 font-bold";
    }
  });
  renderProductsTable();
}

function renderProductsTable() {
  const tbody = getEl('products-table-body');
  if (!tbody) return;

  let filtered = productsList.filter(p => selectedCategory === 'All' || p.category === selectedCategory);
  filtered.sort((a, b) => b.revenue - a.revenue);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-stone-400 font-traditional">No products found for this period</td></tr>`;
    return;
  }

  const totalStoreSales = productsList.reduce((sum, pr) => sum + (pr.revenue || 0), 0);

  tbody.innerHTML = filtered.map(p => {
    const prodSharePct = totalStoreSales > 0 ? ((p.revenue / totalStoreSales) * 100).toFixed(1) : '0.0';
    const onlQtyPct = p.qty > 0 ? ((p.onlineQty / p.qty) * 100).toFixed(1) : '0.0';
    const offQtyPct = p.qty > 0 ? ((p.offlineQty / p.qty) * 100).toFixed(1) : '0.0';
    const wsQtyPct  = p.qty > 0 ? ((p.wholesaleQty / p.qty) * 100).toFixed(1) : '0.0';

    return `
      <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showProductDetails(${KK.eventArg(p.name)})">
        <td class="p-3.5">
          <div class="font-bold text-stone-800 text-xs flex justify-between items-center">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span>${KK.escape(p.name)}</span>
              <span class="bg-[#5C0612] text-[#EFE5C9] font-black px-1.5 py-0.5 rounded text-[9px] font-numeric">${prodSharePct}% of Period Sales</span>
            </div>
            <span class="text-[9px] uppercase px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-[#5C0612] rounded font-traditional">${KK.escape(p.category)}</span>
          </div>
          <div class="text-[10px] text-stone-500 font-bold mt-1 font-sans flex flex-wrap gap-x-2 gap-y-0.5">
            <span class="text-blue-600">Online: ${p.onlineQty} (${onlQtyPct}%)</span> •
            <span class="text-orange-600">Offline: ${p.offlineQty} (${offQtyPct}%)</span> •
            <span class="text-purple-600">Takebyhand: ${p.wholesaleQty} (${wsQtyPct}%)</span>
          </div>
        </td>
        <td class="p-3.5 text-center font-bold text-stone-700">${p.qty}</td>
        <td class="p-3.5 text-right font-black text-[#5C0612]">
          <div>₹${Math.round(p.revenue).toLocaleString('en-IN')}</div>
          <span class="text-[9px] text-stone-500 font-bold font-numeric">${prodSharePct}%</span>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAgentsTable() {
  const tbody = getEl('agents-table-body');
  if (!tbody) return;

  agentsList.sort((a, b) => b.revenue - a.revenue);

  if (agentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" class="p-6 text-center text-stone-400 font-traditional">No staff sales recorded in this period</td></tr>`;
    return;
  }

  const totalStoreSales = agentsList.reduce((sum, ag) => sum + (ag.revenue || 0), 0);

  tbody.innerHTML = agentsList.map(a => {
    const staffSharePct = totalStoreSales > 0 ? ((a.revenue / totalStoreSales) * 100).toFixed(1) : '0.0';
    const offPct = a.revenue > 0 ? ((a.offlineRevenue / a.revenue) * 100).toFixed(1) : '0.0';
    const onlPct = a.revenue > 0 ? ((a.onlineRevenue / a.revenue) * 100).toFixed(1) : '0.0';
    const wsPct  = a.revenue > 0 ? ((a.tbhRevenue / a.revenue) * 100).toFixed(1) : '0.0';

    return `
      <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showAgentDetails(${KK.eventArg(a.name)})">
        <td class="p-3.5 font-bold text-stone-700 font-sans">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-bold text-stone-800">${KK.escape(a.name)}</span>
              <span class="bg-[#5C0612] text-[#EFE5C9] font-black px-1.5 py-0.5 rounded text-[9px] font-numeric">${staffSharePct}% of Period Sales</span>
            </div>
            <span class="text-[9px] text-[#DAA520] font-bold font-numeric">${a.billCount} Bills <i class="fa-solid fa-chevron-right text-[8px] ml-1"></i></span>
          </div>
          <div class="text-[9px] text-stone-500 font-bold mt-1 font-sans flex flex-wrap gap-x-2 gap-y-0.5">
            <span>Offline (Showroom): <strong class="text-orange-700 font-numeric">₹${Math.round(a.offlineRevenue || 0).toLocaleString('en-IN')} (${offPct}%)</strong></span> •
            <span>Online: <strong class="text-blue-700 font-numeric">₹${Math.round(a.onlineRevenue || 0).toLocaleString('en-IN')} (${onlPct}%)</strong></span> •
            <span>Wholesale: <strong class="text-purple-700 font-numeric">₹${Math.round(a.tbhRevenue || 0).toLocaleString('en-IN')} (${wsPct}%)</strong></span>
          </div>
        </td>
        <td class="p-3.5 text-right font-black text-[#5C0612] font-numeric">
          <div>₹${Math.round(a.revenue).toLocaleString('en-IN')}</div>
          <span class="text-[9px] text-stone-500 font-bold font-numeric">${staffSharePct}%</span>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDayWiseSales(dayWiseObj) {
  const container = getEl('daywise-sales-container');
  if (!container) return;
  const sortedDates = Object.keys(dayWiseObj).sort((a, b) => b.localeCompare(a));
  if (sortedDates.length === 0) {
    container.innerHTML = `<p class="p-6 text-center text-stone-400 font-traditional">No sales records in this date range.</p>`;
    return;
  }

  container.innerHTML = sortedDates.map(dateStr => {
    const dayData = dayWiseObj[dateStr];
    const sortedAgents = Object.entries(dayData.agents).sort((a, b) => b[1] - a[1]);
    return `
      <div class="border border-[#E5D5C6] rounded-xl bg-[#FFFDF9] overflow-hidden warm-shadow mb-3">
        <div class="bg-[#F3EFE9] px-4 py-2.5 border-b border-[#E5D5C6] flex justify-between items-center">
          <span class="font-traditional font-bold text-stone-800 text-xs">${KK.escape(dateStr)}</span>
          <span class="font-numeric font-black text-[#5C0612] text-xs">Total: ₹${Math.round(dayData.total).toLocaleString('en-IN')}</span>
        </div>
        <div class="p-3 divide-y divide-[#E5D5C6]/10">
          ${sortedAgents.map(([agentName, rev]) => `
            <div class="flex justify-between items-center py-1.5 text-[11px] text-stone-600">
              <span>${KK.escape(agentName)}</span>
              <strong class="font-numeric text-stone-800">₹${Math.round(rev).toLocaleString('en-IN')}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------
// 7. ATTENDANCE & PAYROLL MODULE
// -------------------------------------------------------------
function setAttendanceViewMode(mode) {
  attendanceViewMode = mode;
  const gridBtn = getEl('btn-attendance-mode-grid');
  const sumBtn = getEl('btn-attendance-mode-summary');

  if (mode === 'grid') {
    if (gridBtn) gridBtn.className = "px-3.5 py-1.5 text-xs font-bold rounded-xl bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-traditional flex items-center gap-1.5 shadow-sm";
    if (sumBtn) sumBtn.className = "px-3.5 py-1.5 text-xs font-bold rounded-xl bg-white text-stone-600 border border-[#E5D5C6] font-traditional flex items-center gap-1.5";
    showEl('staff-salary-list');
    hideEl('staff-salary-summary-view');
  } else {
    if (gridBtn) gridBtn.className = "px-3.5 py-1.5 text-xs font-bold rounded-xl bg-white text-stone-600 border border-[#E5D5C6] font-traditional flex items-center gap-1.5";
    if (sumBtn) sumBtn.className = "px-3.5 py-1.5 text-xs font-bold rounded-xl bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-traditional flex items-center gap-1.5 shadow-sm";
    hideEl('staff-salary-list');
    showEl('staff-salary-summary-view');
  }
}

function filterAttendanceMonth(m) {
  selectedAttendanceMonth = m;
  processData();
}

function getStaffPeriodSalesAmount(empName, empId, filteredRecords) {
  if (!empName) return 0;
  const allowedAliases = (empId && STAFF_ALIASES_MAP[empId]) ? STAFF_ALIASES_MAP[empId] : [];
  const cleanEmp = empName.toLowerCase().replace(/[^a-z0-9]/g, '');

  let totalRevenueFound = 0;
  const records = filteredRecords || rawData;

  records.forEach(row => {
    const rowAgent = (row['SM Name'] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let matched = false;

    for (let alias of allowedAliases) {
      const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (rowAgent === cleanAlias || rowAgent.includes(cleanAlias) || cleanAlias.includes(rowAgent)) {
        matched = true;
        break;
      }
    }

    if (matched || rowAgent === cleanEmp) {
      totalRevenueFound += (parseFloat(row['amount']) || 0);
    }
  });

  return totalRevenueFound;
}

function renderAttendanceSalaryModule(periodRevenue = 0, currentFiltered = []) {
  const container = getEl('staff-salary-list');
  const summaryTbody = getEl('staff-salary-summary-tbody');
  if (!container) return;

  container.innerHTML = '';
  if (summaryTbody) summaryTbody.innerHTML = '';

  const monthContext = getMonthYearContext(selectedAttendanceMonth);
  let staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());


  let totalStorePayroll = 0;
  setText('payroll-staff-count', `${staffList.length} Staff`);
  setText('profit-store-sales', `₹${Math.round(periodRevenue).toLocaleString('en-IN')}`);

  const summaryRowsHTML = [];

  staffList.forEach((emp, index) => {
    const empId = emp['Emp ID'] || `KS-${103 + index}`;
    const name = emp['Employee Name'] || `Staff ${index + 1}`;
    const role = emp['Designation'] || 'Sales (Fabrics)';
    const phone = emp['Phone Number'] || '';

    let fullSalary = KK.number(emp['Monthly Salary'], 10000);
    let commPct = KK.number(emp['Commission Pct'], 0);
    let advance = parseFloat(emp['Advance Taken']) || 0;

    const totalSold = getStaffPeriodSalesAmount(name, empId, currentFiltered);
    const calculatedIncentive = (commPct > 0) ? Math.round(totalSold * (commPct / 100)) : 0;

    let countP = 0, countHD = 0, countA = 0, countPL = 0, countWO = 0;
    let sundaysWorked = 0;
    const gridDayBadges = [];

    for (let d = 1; d <= 31; d++) {
      const dayData = monthContext.dayInfo[d];
      const isDateValid = dayData.valid;
      const rawVal = (emp[d.toString()] || emp[d < 10 ? '0' + d : d.toString()] || '').toString().toUpperCase().trim();

      let badgeBg = 'bg-stone-50 text-stone-300 border-stone-200 opacity-60';
      let displayText = '-';

      if (!isDateValid) {
        badgeBg = 'bg-stone-100/40 text-stone-300 border-stone-200/40 opacity-30';
        displayText = '•';
      } else if (rawVal === 'P' || rawVal === 'PRESENT') {
        countP++;
        badgeBg = dayData.isSunday ? 'bg-amber-100 text-amber-900 border-amber-300 font-black' : 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
        displayText = 'P';
        if (dayData.isSunday) sundaysWorked++;
      } else if (rawVal === 'WO') {
        countWO++;
        badgeBg = 'bg-teal-100 text-teal-800 border-teal-300 font-bold';
        displayText = 'WO';
      } else if (rawVal === 'HD') {
        countHD++;
        badgeBg = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
        displayText = 'HD';
        if (dayData.isSunday) sundaysWorked += 0.5;
      } else if (rawVal === 'A') {
        countA++;
        badgeBg = 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
        displayText = 'A';
      } else if (rawVal === 'PL' || rawVal === 'SL' || rawVal === 'CL') {
        countPL++;
        badgeBg = 'bg-blue-100 text-blue-800 border-blue-300 font-bold';
        displayText = rawVal;
      }

      gridDayBadges.push(`
        <div onclick="cycleDayStatus(${index}, ${d})" class="flex flex-col items-center justify-center border rounded-xl ${badgeBg} text-[8px] py-1.5 font-numeric cursor-pointer hover:scale-105 transition-transform select-none">
          <span class="text-[7px] ${dayData.isSunday ? 'text-amber-700 font-black' : 'text-stone-400'}">${dayData.label}</span>
          <span class="text-[10px] font-black leading-none mt-0.5">${displayText}</span>
        </div>
      `);
    }

    const payableDays = countP + (countHD * 0.5) + countPL + countWO;
    const baseEarned = Math.round(payableDays * (fullSalary / monthContext.daysInMonth));
    const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);
    totalStorePayroll += netSalary;

    const card = document.createElement('div');
    card.className = "bg-[#FFFDF9] rounded-3xl border border-[#E5D5C6] warm-shadow p-5 space-y-3 relative overflow-hidden";
    card.innerHTML = `
      <div class="zari-border absolute top-0 left-0 right-0"></div>
      <div class="flex justify-between items-start border-b border-[#E5D5C6]/60 pb-2">
        <div>
          <span class="text-[9px] font-bold text-[#5C0612] bg-[#EFE5C9] px-2 py-0.5 rounded font-numeric border border-[#DAA520]">${KK.escape(empId)}</span>
          <h4 class="font-bold text-stone-800 text-sm font-sans mt-1">${KK.escape(name)}</h4>
          <p class="text-[10px] text-stone-500 font-traditional">${KK.escape(role)} ${phone ? `• 📞 ${KK.escape(phone)}` : ''}</p>
        </div>
        <div class="text-right font-numeric">
          <p class="text-[9px] text-stone-500 uppercase font-traditional">Net Payable</p>
          <p class="text-lg font-black text-[#5C0612]">₹${netSalary.toLocaleString('en-IN')}</p>
          <div class="flex gap-1 mt-1 justify-end export-ignore">
            <button onclick="shareStaffPayslipWhatsApp(${index})" class="text-[8px] bg-[#25D366] text-white px-2 py-0.5 rounded-lg font-bold uppercase flex items-center gap-1 active:scale-95">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </button>
            <button onclick="exportSingleStaffPayslipPDF(${index})" class="text-[8px] bg-[#5C0612] text-[#EFE5C9] px-2 py-0.5 rounded-lg font-bold uppercase flex items-center gap-1 border border-[#DAA520] active:scale-95">
              <i class="fa-solid fa-file-pdf"></i> PDF
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-1.5 bg-[#FAF6EE] p-2 rounded-2xl border border-[#E5D5C6] text-center font-numeric text-xs">
        <div><span class="block text-[7px] text-emerald-800 uppercase">Payable</span><strong class="text-emerald-900 font-black">${payableDays}/${monthContext.daysInMonth}</strong></div>
        <div><span class="block text-[7px] text-amber-800 uppercase">☀️ Sundays</span><strong class="text-amber-900 font-black">${sundaysWorked}/${monthContext.totalSundaysInMonth}</strong></div>
        <div><span class="block text-[7px] text-rose-800 uppercase">Absent</span><strong class="text-rose-900 font-black">${countA}</strong></div>
        <div><span class="block text-[7px] text-blue-800 uppercase">Half Days</span><strong class="text-blue-900 font-black">${countHD}</strong></div>
      </div>

      <div class="grid grid-cols-7 sm:grid-cols-11 gap-1 pt-0.5">
        ${gridDayBadges.join('')}
      </div>

      <div class="grid grid-cols-3 gap-2 bg-[#FAF6EE] p-2.5 rounded-2xl border border-[#E5D5C6] text-xs font-numeric">
        <div>
          <label class="block text-[8px] font-bold text-stone-500 uppercase mb-0.5">Base Salary (₹)</label>
          <input type="number" value="${fullSalary}" onchange="updateStaffPayroll(${index}, 'salary', this.value)" class="w-full text-xs font-bold border border-[#E5D5C6] bg-white rounded-lg p-1.5 text-stone-800 focus:outline-none" ${!isAdmin ? 'disabled' : ''}>
          <span class="text-[8px] text-stone-400 block mt-0.5">Earned: ₹${baseEarned.toLocaleString('en-IN')}</span>
        </div>
        <div>
          <label class="block text-[8px] font-bold text-stone-500 uppercase mb-0.5">Incentive Rate (%)</label>
          <input type="number" value="${commPct}" step="0.1" onchange="updateStaffPayroll(${index}, 'commission', this.value)" class="w-full text-xs font-bold border border-[#E5D5C6] bg-white rounded-lg p-1.5 text-stone-800 focus:outline-none" ${!isAdmin ? 'disabled' : ''}>
          <span class="text-[8px] text-emerald-800 font-bold block mt-0.5">Period Sales: ₹${Math.round(totalSold).toLocaleString('en-IN')}</span>
        </div>
        <div>
          <label class="block text-[8px] font-bold text-stone-500 uppercase mb-0.5">Advance (₹)</label>
          <input type="number" value="${advance}" onchange="updateStaffPayroll(${index}, 'advance', this.value)" class="w-full text-xs font-bold border border-[#E5D5C6] bg-white rounded-lg p-1.5 text-stone-800 focus:outline-none" ${!isAdmin ? 'disabled' : ''}>
        </div>
      </div>
    `;
    container.appendChild(card);

    summaryRowsHTML.push(`
      <tr class="hover:bg-amber-50/20 transition-colors">
        <td class="p-3">
          <strong class="text-stone-800 font-sans">${KK.escape(name)}</strong>
          <span class="text-[9px] text-[#5C0612] bg-[#EFE5C9] px-1.5 py-0.5 rounded ml-1 font-numeric">${KK.escape(empId)}</span>
          <div class="text-[9px] text-stone-400">${KK.escape(role)}</div>
        </td>
        <td class="p-3 text-center font-bold text-emerald-800">${payableDays} / ${monthContext.daysInMonth}</td>
        <td class="p-3 text-center font-bold text-amber-900">☀️ ${sundaysWorked} / ${monthContext.totalSundaysInMonth}</td>
        <td class="p-3 text-right font-bold text-stone-700">₹${Math.round(totalSold).toLocaleString('en-IN')}</td>
        <td class="p-3 text-right font-numeric">₹${Math.round(fullSalary).toLocaleString('en-IN')}</td>
        <td class="p-3 text-right text-emerald-800 font-bold">+₹${calculatedIncentive.toLocaleString('en-IN')} (${commPct}%)</td>
        <td class="p-3 text-right text-rose-700 font-bold">-₹${advance.toLocaleString('en-IN')}</td>
        <td class="p-3 text-right font-black text-[#5C0612] text-sm">₹${netSalary.toLocaleString('en-IN')}</td>
        <td class="p-3 text-center export-ignore">
          <div class="flex items-center justify-center gap-1">
            <button onclick="shareStaffPayslipWhatsApp(${index})" class="p-1 bg-[#25D366] text-white rounded text-xs"><i class="fa-brands fa-whatsapp"></i></button>
            <button onclick="exportSingleStaffPayslipPDF(${index})" class="p-1 bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] rounded text-xs"><i class="fa-solid fa-file-pdf"></i></button>
          </div>
        </td>
      </tr>
    `);
  });

  if (summaryTbody) summaryTbody.innerHTML = summaryRowsHTML.join('');
  setText('payroll-total-amount', `₹${totalStorePayroll.toLocaleString('en-IN')}`);

  const grossProfitEl = getEl('profit-gross-amount');
  if (grossProfitEl) {
    const grossVal = periodRevenue - totalStorePayroll;
    grossProfitEl.textContent = `₹${Math.round(grossVal).toLocaleString('en-IN')}`;
    grossProfitEl.className = grossVal >= 0 ? "text-xl font-black text-emerald-700 font-numeric" : "text-xl font-black text-rose-700 font-numeric";
  }
}

function cycleDayStatus(staffIndex, dayNumber) {
  if (!isAdmin) return alert("Only Admin can edit attendance.");
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[staffIndex] || rawAttendanceData[staffIndex];
  if (!emp) return;

  const dKey = dayNumber.toString();
  const currentVal = (emp[dKey] || '').toUpperCase().trim();
  const cycleOrder = ['', 'P', 'A', 'HD', 'WO', 'PL'];
  let nextIdx = (cycleOrder.indexOf(currentVal) + 1) % cycleOrder.length;
  emp[dKey] = cycleOrder[nextIdx];

  processData();
}

function updateStaffPayroll(index, field, val) {
  if (!isAdmin) return alert("Only Admin can edit salary.");
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[index] || rawAttendanceData[index];
  if (!emp) return;

  if (field === 'salary') emp['Monthly Salary'] = parseFloat(val) || 0;
  else if (field === 'commission') emp['Commission Pct'] = parseFloat(val) || 0;
  else if (field === 'advance') emp['Advance Taken'] = parseFloat(val) || 0;

  processData();
}

async function saveAttendanceToSupabase() {
  throw new Error('Attendance writes are unavailable in this read-only release.');
  if (!isAdmin) return alert("Only Admin can save attendance to database.");

  const saveBtn = getEl('btn-save-attendance-main');
  const saveText = getEl('save-attendance-main-text');
  if (saveBtn) saveBtn.disabled = true;
  if (saveText) saveText.textContent = "⏳ Saving...";

  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const targetList = staffList;

  const upsertPayload = targetList.map(emp => {
    const daysObj = {};
    for (let d = 1; d <= 31; d++) {
      const val = (emp[d.toString()] || emp[d < 10 ? '0' + d : d.toString()] || '').toString().toUpperCase().trim();
      if (val) daysObj[d.toString()] = val;
    }

    return {
      emp_id: emp['Emp ID'],
      employee_name: emp['Employee Name'],
      designation: emp['Designation'] || 'Sales (Fabrics)',
      month_sheet: selectedAttendanceMonth,
      phone_number: emp['Phone Number'] || '',
      monthly_salary: KK.number(emp['Monthly Salary'], 10000),
      commission_pct: KK.number(emp['Commission Pct'], 0),
      advance_taken: parseFloat(emp['Advance Taken']) || 0,
      status: emp.status || 'Active',
      joining_date: emp.joining_date || null,
      relieving_date: emp.relieving_date || null,
      termination_reason: emp.termination_reason || '',
      days_data: daysObj
    };
  });

  try {
    const { error } = await supabaseClient
      .from('attendance')
      .upsert(upsertPayload, { onConflict: 'emp_id,month_sheet' });

    if (error) throw error;
    alert(`✅ Attendance for ${KK.escape(selectedAttendanceMonth)} saved to Supabase!`);
  } catch (err) {
    console.error("Supabase Save Error:", err);
    alert("❌ DATABASE SAVE FAILED: " + err.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (saveText) saveText.textContent = "💾 Save to Supabase";
  }
}

function shareStaffPayslipWhatsApp(index) {
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[index] || rawAttendanceData[index];
  if (!emp) return;

  const name = emp['Employee Name'] || 'Staff';
  const empId = emp['Emp ID'] || `KS-${103 + index}`;
  const fullSalary = KK.number(emp['Monthly Salary'], 10000);
  const commPct = KK.number(emp['Commission Pct'], 0);
  const advance = parseFloat(emp['Advance Taken']) || 0;

  const mCtx = getMonthYearContext(selectedAttendanceMonth);
  let countP = 0, countHD = 0, countPL = 0, countWO = 0;
  for (let d = 1; d <= mCtx.daysInMonth; d++) {
    const val = (emp[d.toString()] || '').toUpperCase().trim();
    if (val === 'P') countP++;
    else if (val === 'HD') countHD++;
    else if (val === 'WO') countWO++;
    else if (val === 'PL' || val === 'SL' || val === 'CL') countPL++;
  }

  const payableDays = countP + (countHD * 0.5) + countPL + countWO;
  const baseEarned = Math.round(payableDays * (fullSalary / mCtx.daysInMonth));

  const rawFrom = getEl('from-date') ? getEl('from-date').value.trim() : '';
  const rawTo = getEl('to-date') ? getEl('to-date').value.trim() : '';
  const fromDate = parseToYYYYMMDD(rawFrom);
  const toDate = parseToYYYYMMDD(rawTo);

  const activeFiltered = rawData.filter(row => {
    const rDate = row['Bill Date'];
    if (fromDate && (!rDate || rDate < fromDate)) return false;
    if (toDate && (!rDate || rDate > toDate)) return false;
    if (selectedStore !== 'All' && normalizeBranch(row['Store']) !== normalizeBranch(selectedStore)) return false;
    return true;
  });

  const totalSold = getStaffPeriodSalesAmount(name, empId, activeFiltered);
  const calculatedIncentive = commPct > 0 ? Math.round(totalSold * (commPct / 100)) : 0;
  const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);

  let msg = `🌸 *KAILASH KALAMKARI - OFFICIAL MONTHLY PAYSLIP* 🌸\n\n`;
  msg += `🆔 *Staff ID:* ${KK.escape(empId)}\n`;
  msg += `👤 *Staff Name:* ${KK.escape(name)}\n`;
  msg += `📅 *Month / Period:* ${KK.escape(selectedAttendanceMonth)}\n`;
  msg += `📊 *Attendance:* ${payableDays} / ${mCtx.daysInMonth} Payable Days\n`;
  msg += `--------------------------------------\n`;
  msg += `💵 *Monthly Base Salary:* ₹${fullSalary.toLocaleString('en-IN')}\n`;
  msg += `✅ *Earned Base Pay:* ₹${baseEarned.toLocaleString('en-IN')}\n`;
  msg += `🛍️ *Store Sales Achieved:* ₹${Math.round(totalSold).toLocaleString('en-IN')}\n`;
  if (calculatedIncentive > 0) msg += `🎁 *Sales Incentive (${commPct}%):* +₹${calculatedIncentive.toLocaleString('en-IN')}\n`;
  if (advance > 0) msg += `📉 *Advance Deducted:* -₹${advance.toLocaleString('en-IN')}\n`;
  msg += `--------------------------------------\n`;
  msg += `💰 *FINAL NET SALARY PAYABLE:* ₹${netSalary.toLocaleString('en-IN')}\n\n`;
  msg += `_Thank you for your valuable dedication to Kailash Kalamkari!_`;

  const phone = emp['Phone Number'] ? `91${emp['Phone Number'].replace(/\D/g, '')}` : '';
  if (phone) window.open(`https://api.whatsapp.com/send?phone=${KK.escape(phone)}&text=${encodeURIComponent(msg)}`, '_blank');
  else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function exportSingleStaffPayslipPDF(index) {
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[index] || rawAttendanceData[index];
  if (!emp || typeof html2pdf === 'undefined') return;

  const name = emp['Employee Name'] || 'Staff Member';
  const empId = emp['Emp ID'] || `KS-${103 + index}`;
  const role = emp['Designation'] || 'Sales Executive';
  const fullSalary = KK.number(emp['Monthly Salary'], 10000);
  const commPct = KK.number(emp['Commission Pct'], 0);
  const advance = parseFloat(emp['Advance Taken']) || 0;

  const mCtx = getMonthYearContext(selectedAttendanceMonth);
  let countP = 0, countHD = 0, countPL = 0, countWO = 0;
  for (let d = 1; d <= mCtx.daysInMonth; d++) {
    const val = (emp[d.toString()] || '').toUpperCase().trim();
    if (val === 'P') countP++;
    else if (val === 'HD') countHD++;
    else if (val === 'WO') countWO++;
    else if (val === 'PL' || val === 'SL' || val === 'CL') countPL++;
  }

  const payableDays = countP + (countHD * 0.5) + countPL + countWO;
  const baseEarned = Math.round(payableDays * (fullSalary / mCtx.daysInMonth));

  const rawFrom = getEl('from-date') ? getEl('from-date').value.trim() : '';
  const rawTo = getEl('to-date') ? getEl('to-date').value.trim() : '';
  const fromDate = parseToYYYYMMDD(rawFrom);
  const toDate = parseToYYYYMMDD(rawTo);

  const activeFiltered = rawData.filter(row => {
    const rDate = row['Bill Date'];
    if (fromDate && (!rDate || rDate < fromDate)) return false;
    if (toDate && (!rDate || rDate > toDate)) return false;
    if (selectedStore !== 'All' && normalizeBranch(row['Store']) !== normalizeBranch(selectedStore)) return false;
    return true;
  });

  const totalSold = getStaffPeriodSalesAmount(name, empId, activeFiltered);
  const calculatedIncentive = commPct > 0 ? Math.round(totalSold * (commPct / 100)) : 0;
  const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);

  const payslipContainer = document.createElement('div');
  payslipContainer.className = "p-8 bg-[#FFFDF9] border-2 border-[#5C0612] max-w-xl mx-auto rounded-3xl font-numeric text-stone-800 space-y-4";
  payslipContainer.innerHTML = `
    <div class="text-center border-b-2 border-[#DAA520] pb-3">
      <h2 class="text-2xl font-bold font-traditional text-[#5C0612]">KAILASH KALAMKARI</h2>
      <p class="text-[10px] text-stone-600 uppercase font-semibold">Official Staff Payslip & Performance Voucher</p>
      <p class="text-[9px] text-[#DAA520] font-bold uppercase mt-0.5">${KK.escape(selectedAttendanceMonth)}</p>
    </div>
    <div class="grid grid-cols-2 gap-4 text-xs border-b border-[#E5D5C6] pb-3">
      <div>
        <p class="text-stone-500 text-[10px]">Employee ID</p>
        <p class="font-black text-[#5C0612]">${KK.escape(empId)}</p>
        <p class="text-stone-500 text-[10px] uppercase font-semibold mt-1">Employee Name</p>
        <p class="font-bold text-stone-800">${KK.escape(name)}</p>
      </div>
      <div class="text-right">
        <p class="text-stone-500 text-[10px]">Designation</p>
        <p class="font-bold text-stone-800">${KK.escape(role)}</p>
        <p class="text-stone-500 text-[10px] mt-1">Payable Days</p>
        <p class="font-bold text-emerald-800">${payableDays} / ${mCtx.daysInMonth} Days</p>
      </div>
    </div>
    <div class="space-y-1.5 text-xs">
      <div class="flex justify-between py-1 border-b border-stone-200"><span>Monthly Base Salary (Full CTC)</span><strong>₹${fullSalary.toLocaleString('en-IN')}</strong></div>
      <div class="flex justify-between py-1 border-b border-stone-200 text-stone-800 font-bold"><span>Earned Base Salary</span><strong>₹${baseEarned.toLocaleString('en-IN')}</strong></div>
      <div class="flex justify-between py-1 border-b border-stone-200"><span>Store Sales Generated</span><strong>₹${Math.round(totalSold).toLocaleString('en-IN')}</strong></div>
      ${commPct > 0 ? `<div class="flex justify-between py-1 border-b border-stone-200 text-emerald-800"><span>Sales Incentive (${commPct}%)</span><strong>+₹${calculatedIncentive.toLocaleString('en-IN')}</strong></div>` : ''}
      ${advance > 0 ? `<div class="flex justify-between py-1 border-b border-stone-200 text-rose-800"><span>Advance Deducted</span><strong>-₹${advance.toLocaleString('en-IN')}</strong></div>` : ''}
    </div>
    <div class="bg-[#5C0612] text-[#EFE5C9] p-3 rounded-xl flex justify-between items-center border border-[#DAA520]">
      <span class="font-traditional uppercase font-bold text-xs">Net Payable Salary</span>
      <span class="text-xl font-black">₹${netSalary.toLocaleString('en-IN')}</span>
    </div>
  `;

  document.body.appendChild(payslipContainer);
  html2pdf().set({ margin: 0.3, filename: `Payslip_${KK.escape(name)}_${KK.escape(empId)}.pdf` }).from(payslipContainer).save().then(() => {
    document.body.removeChild(payslipContainer);
  });
}

// -------------------------------------------------------------
// 8. DRILLDOWNS & MODALS
// -------------------------------------------------------------
function showProductDetails(productName) {
  setText('detail-product-name', productName);
  const rawFrom = getEl('from-date') ? getEl('from-date').value.trim() : '';
  const rawTo = getEl('to-date') ? getEl('to-date').value.trim() : '';
  const fromVal = parseToYYYYMMDD(rawFrom);
  const toVal = parseToYYYYMMDD(rawTo);

  const agentStats = {};
  rawData.forEach(row => {
    const rDate = row['Bill Date'];
    if (fromVal && (!rDate || rDate < fromVal)) return;
    if (toVal && (!rDate || rDate > toVal)) return;
    if (selectedStore !== 'All' && normalizeBranch(row['Store']) !== normalizeBranch(selectedStore)) return;
    if (row['Item Name'] !== productName) return;

    const agent = row['SM Name'] || 'No Agent';
    const amount = parseFloat(row['amount']) || 0;
    const channel = row['Sale type'];

    if (!agentStats[agent]) agentStats[agent] = { online: 0, offline: 0, wholesale: 0, total: 0 };
    if (channel === 'Online') agentStats[agent].online += amount;
    else if (channel === 'Wholesale') agentStats[agent].wholesale += amount;
    else agentStats[agent].offline += amount;
    agentStats[agent].total += amount;
  });

  const sortedAgents = Object.entries(agentStats).sort((a, b) => b[1].total - a[1].total);
  const tbody = getEl('product-detail-table-body');
  if (tbody) {
    tbody.innerHTML = sortedAgents.length === 0 ? `<tr><td colspan="5" class="p-3 text-center text-stone-400">No sales recorded</td></tr>` : sortedAgents.map(([agentName, stats]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-2 font-bold text-stone-700">${KK.escape(agentName)}</td>
        <td class="p-2 text-right text-blue-600 font-bold font-numeric">₹${Math.round(stats.online).toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-orange-600 font-bold font-numeric">₹${Math.round(stats.offline).toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-purple-600 font-bold font-numeric">₹${Math.round(stats.wholesale).toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-[#5C0612] font-black font-numeric">₹${Math.round(stats.total).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  showEl('product-detail-card');
}

function closeProductDetail() {
  hideEl('product-detail-card');
}

function showAgentDetails(agentName) {
  activeAnalysisAgent = agentName;
  applyState({ view: 'agent-analysis', name: agentName });
}

function populateAgentAnalysisScreenDOM(agentName) {
  const rawFrom = getEl('from-date') ? getEl('from-date').value.trim() : '';
  const rawTo = getEl('to-date') ? getEl('to-date').value.trim() : '';
  const fromVal = parseToYYYYMMDD(rawFrom);
  const toVal = parseToYYYYMMDD(rawTo);

  setText('agent-analysis-title', `${KK.escape(agentName)} Performance Ledger`);
  setText('agent-analysis-subtitle', `Period: ${fromVal || 'All Time'} to ${toVal || 'Current'}`);

  const targetAgentNorm = resolveStaffToMasterName(agentName).toLowerCase();

  const agentRows = rawData.filter(row => {
    const rDate = row['Bill Date'];
    if (fromVal && (!rDate || rDate < fromVal)) return false;
    if (toVal && (!rDate || rDate > toVal)) return false;
    if (selectedStore !== 'All' && normalizeBranch(row['Store']) !== normalizeBranch(selectedStore)) return false;
    return resolveStaffToMasterName(row['SM Name']).toLowerCase() === targetAgentNorm;
  });

  let totalRevenue = 0, onlineSales = 0, offlineSales = 0, tbhSales = 0;
  const dailyGroup = {};

  agentRows.forEach(row => {
    const amount = parseFloat(row['amount']) || 0;
    const channel = row['Sale type'];
    const date = row['Bill Date'];
    const billNo = row['Bill No'];

    totalRevenue += amount;
    if (channel === 'Online') onlineSales += amount;
    else if (channel === 'Wholesale') tbhSales += amount;
    else offlineSales += amount;

    if (!dailyGroup[date]) dailyGroup[date] = { total: 0, bills: {} };
    dailyGroup[date].total += amount;
    if (!dailyGroup[date].bills[billNo]) dailyGroup[date].bills[billNo] = 0;
    dailyGroup[date].bills[billNo] += amount;
  });

  setText('agent-analysis-total-revenue', `₹${Math.round(totalRevenue).toLocaleString('en-IN')}`);
  setText('agent-analysis-online-sales', `₹${Math.round(onlineSales).toLocaleString('en-IN')}`);
  setText('agent-analysis-offline-sales', `₹${Math.round(offlineSales).toLocaleString('en-IN')}`);
  setText('agent-analysis-takebyhand-sales', `₹${Math.round(tbhSales).toLocaleString('en-IN')}`);

  const dailyContainer = getEl('agent-analysis-daily-list');
  if (dailyContainer) {
    const sortedDates = Object.keys(dailyGroup).sort((a, b) => b.localeCompare(a));
    dailyContainer.innerHTML = sortedDates.map(dateStr => `
      <div class="border border-[#E5D5C6] rounded-xl bg-[#FFFDF9] overflow-hidden warm-shadow mb-3">
        <div class="bg-[#F3EFE9] px-4 py-2.5 border-b border-[#E5D5C6] flex justify-between items-center">
          <span class="font-traditional font-bold text-stone-800 text-xs">${KK.escape(dateStr)}</span>
          <span class="font-numeric font-black text-[#5C0612] text-xs">Day Total: ₹${Math.round(dailyGroup[dateStr].total).toLocaleString('en-IN')}</span>
        </div>
        <div class="p-3 divide-y divide-[#E5D5C6]/10">
          ${Object.entries(dailyGroup[dateStr].bills).map(([bNo, bAmt]) => `
            <div class="flex justify-between items-center py-1 text-xs">
              <span>Invoice: <strong>${KK.escape(bNo)}</strong></span>
              <strong class="text-[#5C0612] font-numeric">₹${Math.round(bAmt).toLocaleString('en-IN')}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }
}

function selectChannel(channel) {
  if (channel === 'All') {
    applyState({ view: 'home' });
    return;
  }
  applyState({ view: 'channel', channel: channel });
}

function populateChannelScreenDOM(channel) {
  const rawFrom = getEl('from-date') ? getEl('from-date').value.trim() : '';
  const rawTo = getEl('to-date') ? getEl('to-date').value.trim() : '';
  const fromVal = parseToYYYYMMDD(rawFrom);
  const toVal = parseToYYYYMMDD(rawTo);

  const displayTitle = channel === 'Wholesale' ? 'Take by Hand (Wholesale)' : `${channel} Channel`;
  setText('channel-view-title', `${displayTitle} Sales`);
  setText('channel-view-subtitle', `Period: ${fromVal || 'All Time'} to ${toVal || 'Current'}`);

  const filtered = rawData.filter(row => {
    const rDate = row['Bill Date'];
    if (fromVal && (!rDate || rDate < fromVal)) return false;
    if (toVal && (!rDate || rDate > toVal)) return false;
    if (selectedStore !== 'All' && normalizeBranch(row['Store']) !== normalizeBranch(selectedStore)) return false;
    return row['Sale type'] === channel;
  });

  let totalChannelRevenue = 0;
  const agentsObj = {};

  filtered.forEach(row => {
    const amount = parseFloat(row['amount']) || 0;
    const agent = row['SM Name'] || 'No Agent';
    totalChannelRevenue += amount;
    agentsObj[agent] = (agentsObj[agent] || 0) + amount;
  });

  setText('channel-view-total', `₹${Math.round(totalChannelRevenue).toLocaleString('en-IN')}`);

  const agentTable = getEl('channel-agents-table');
  if (agentTable) {
    const sortedA = Object.entries(agentsObj).sort((a, b) => b[1] - a[1]);
    agentTable.innerHTML = sortedA.length === 0 ? `<tr><td colspan="2" class="p-4 text-center text-stone-400">No staff sales for ${displayTitle}</td></tr>` : sortedA.map(([aName, amt]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700 font-sans">${KK.escape(aName)}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${Math.round(amt).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

function closeChannelScreen() { applyState({ view: 'home' }); }
function closeAgentAnalysisScreen() { applyState({ view: 'home' }); }

function applyState(state, isPopState = false) {
  if (!state) state = { view: 'home' };
  const session = checkSession();
  if (!session.valid) {
    hideEl('standard-header');
    hideEl('standard-main');
    showEl('login-screen');
    return;
  }

  showEl('standard-header');
  hideEl('channel-view');
  hideEl('agent-analysis-view');

  if (state.view === 'home') {
    showEl('standard-main');
  } else if (state.view === 'channel') {
    hideEl('standard-main');
    showEl('channel-view');
    populateChannelScreenDOM(state.channel);
  } else if (state.view === 'agent-analysis') {
    hideEl('standard-main');
    showEl('agent-analysis-view');
    populateAgentAnalysisScreenDOM(state.name);
  }

  if (!isPopState) history.pushState(state, '');
}

window.addEventListener('popstate', (e) => {
  applyState(e.state, true);
});

function switchTab(tabId) {
  if (tabId === 'attendance-tab') return;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  showEl(tabId);

  const btnMap = {
    'products-tab': 'btn-products-tab',
    'agents-tab': 'btn-agents-tab',
    'daywise-tab': 'btn-daywise-tab',
    'attendance-tab': 'btn-attendance-tab',
    'insights-tab': 'btn-insights-tab'
  };

  Object.entries(btnMap).forEach(([tId, bId]) => {
    const btn = getEl(bId);
    if (btn) {
      btn.className = (tId === tabId)
        ? "flex-1 min-w-[90px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional"
        : "flex-1 min-w-[90px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional";
    }
  });
}

function updateMonthlyTarget(val) {
  if (!isAdmin) return alert("Only Admin can update target.");
  monthlyTarget = parseFloat(val) || 0;
  localStorage.setItem('kk_monthly_target', monthlyTarget.toString());
  processData();
}

function exportSectionToPDF(elementId, titleFilename) {
  const element = getEl(elementId);
  if (!element || typeof html2pdf === 'undefined') {
    alert("PDF Engine is loading.");
    return;
  }
  html2pdf().set({
    margin: 0.3,
    filename: `${titleFilename}_${parseToYYYYMMDD(new Date())}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
  }).from(element).save();
}

function shareOwnerDailySummaryWhatsApp() {
  const totalSalesText = getEl('metric-total')?.textContent || '₹0';
  let msg = `🌸 *KAILASH KALAMKARI - EXECUTIVE SALES SUMMARY* 🌸\n💰 *Total Revenue:* ${totalSalesText}\n`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

// -------------------------------------------------------------
// 9. BOOTSTRAP EVENT LISTENERS
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = getEl('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = (getEl('login-username')?.value || '').trim();
      const pass = getEl('login-password')?.value || '';
      await fetchData(user, pass);
    });
  }

  ['from-date', 'to-date'].forEach(id => {
    const el = getEl(id);
    if (el) {
      el.addEventListener('change', processData);
      el.addEventListener('input', processData);
    }
  });

  getEl('product-search')?.addEventListener('input', processData);
  getEl('store-filter')?.addEventListener('change', processData);
  getEl('refresh-btn')?.addEventListener('click', () => {
    const s = checkSession();
    if (s.valid) fetchData(s.user, '');
  });

  const session = await KK.session(supabaseClient);
  if (session?.valid) {
    fetchData(session.user, '');
  } else {
    showEl('login-screen');
    hideEl('loader');
  }
});
