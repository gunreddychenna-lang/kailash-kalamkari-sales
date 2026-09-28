/**
 * =========================================================================
 * KAILASH KALAMKARI - LIVE SUPABASE ANALYTICS ENGINE (app.js)
 * Enterprise client with automatic date calibration (Today/Yesterday default),
 * full staff leaderboard, attendance & payroll, and online channel breakdown.
 * =========================================================================
 */

// 1. SUPABASE CREDENTIALS
const SUPABASE_URL = "https://dqvqqrbvklpiibzqivbp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxdnFxcmJ2a2xwaWlienFpdmJwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDYxOTY5NSwiZXhwIjoyMTA2MTk1Njk1fQ.UCnBDjxE-JePOJOVnzKlyJ9iWckja9WbUMdN_Fp-gGc"; // <-- Paste your Supabase anon public key here

let supabaseClient = null;
if (typeof supabase !== 'undefined' && supabase.createClient) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const SESSION_TIMEOUT = 6 * 60 * 60 * 1000;

// RBAC & User Session Context
let currentRole = 'Admin';
let currentUserId = '';
let currentEmployeeId = '';
let currentDisplayName = '';
let isAdmin = true;

// Global Data Sets
let rawData = [];
let rawAttendanceData = [];
let bankAccountsList = [];
let productsList = [];
let agentsList = [];
let selectedAgentDetail = null;

// Multi-Split Payment Tracking Maps
let globalBillSplitsMap = {}; 
let globalBillBankMap = {};
let agentBillsViewMode = 'summary';
let attendanceViewMode = 'grid';

// Filter States & Settings
let selectedStore = "All";
let selectedCategory = "All";
let selectedAttendanceMonth = "All";
let selectedChannel = "All";
let activeAnalysisAgent = "";
let monthlyTarget = parseFloat(localStorage.getItem('kk_monthly_target')) || 1000000;
let defaultCommissionPct = 1.0;

// Metrics & Sorting States
let currentDaySales = [0, 0, 0, 0, 0, 0, 0];

// SPA Routing State
if (history.state === null) history.replaceState({ view: 'home' }, '');
window.addEventListener('popstate', e => applyState(e.state, true));

// Safe DOM Helpers
function getEl(id) { return document.getElementById(id); }
function showEl(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hideEl(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

// -------------------------------------------------------------
// STRICT DATE FORMATTING & YEAR 2500 VALIDATION
// -------------------------------------------------------------
function formatToYYYYMMDD(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return d.trim();
  const dateObj = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dateObj.getTime())) return '';
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeToDateString(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) return formatToYYYYMMDD(dateVal);

  let strVal = dateVal.toString().trim();
  if (!strVal) return '';

  // ISO YYYY-MM-DD
  const isoMatch = strVal.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    // Ignore invalid years like 2500
    if (y > 2027 || y < 2020) return '';
    return `${y}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
  }

  // DD-MMM-YYYY (e.g. 08-Jun-2026 or 08-Jun-26)
  const dMmmYyyyMatch = strVal.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})/);
  if (dMmmYyyyMatch) {
    const day = String(dMmmYyyyMatch[1]).padStart(2, '0');
    const monthStr = dMmmYyyyMatch[2].substring(0, 3).toLowerCase();
    let year = parseInt(dMmmYyyyMatch[3], 10);
    if (year < 100) year = 2000 + year;
    if (year > 2027 || year < 2020) return '';

    const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    if (months[monthStr]) return `${year}-${months[monthStr]}-${day}`;
  }

  // DD-MM-YYYY
  const dmyMatch = strVal.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmyMatch) {
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year = 2000 + year;
    if (year > 2027 || year < 2020) return '';
    return `${year}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
  }

  const parsed = new Date(strVal);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    if (y <= 2027 && y >= 2020) return formatToYYYYMMDD(parsed);
  }

  return '';
}

function getAllNormalizedDates() {
  if (!rawData || rawData.length === 0) return [];
  const dateSet = new Set();
  rawData.forEach(row => {
    const norm = normalizeToDateString(row['Bill Date']);
    if (norm && /^\d{4}-\d{2}-\d{2}$/.test(norm)) dateSet.add(norm);
  });
  return Array.from(dateSet).sort();
}

function getRowAmount(row) {
  if (!row || typeof row !== 'object') return 0;
  const directKeys = [
    'amount', 'billAmoun', 'billAmount', 'Bill Amount', 'BillAmount', 
    'Final Amount', 'FinalAmount', 'Total Value', 'TotalValue', 
    'Net Invoice Value', 'Net Value', 'NetValue', 'Gross Value', 'Total', 'Rate', 'rate'
  ];
  for (let k of directKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const parsed = parseFloat(row[k].toString().replace(/[^0-9.-]+/g, ""));
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }
  return 0;
}

function getBillNo(row) {
  if (!row || typeof row !== 'object') return 'N/A';
  const directKeys = ['bill_no', 'Bil No', 'Bil No.', 'BilNo', 'Bill No', 'Bill No.', 'Invoice No', 'Invoice No.'];
  for (let k of directKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const val = row[k].toString().trim();
      if (val && val !== '0' && !val.includes('T') && !val.includes('Z') && val.toLowerCase() !== 'null') return val;
    }
  }
  return 'N/A';
}

function getSalesType(payMode, saleType) {
  if (saleType) {
    const st = saleType.toString().toLowerCase().trim();
    if (st.includes('onl')) return 'Online';
    if (st.includes('hand') || st.includes('wholesale') || st.includes('tbh')) return 'Wholesale';
    return 'Offline';
  }
  if (!payMode) return 'Offline';
  const pm = payMode.toString().toLowerCase().trim();
  if (pm.includes('onl') || pm.includes('online') || pm.includes('web')) return 'Online';
  if (pm.includes('hand') || pm.includes('wholesale') || pm.includes('take by hand') || pm.includes('tbh')) return 'Wholesale';
  return 'Offline';
}

function getItemCategory(itemName) {
  if (!itemName) return 'General';
  const name = itemName.toString().toLowerCase();
  if (name.includes('frame') || name.includes('painting') || name.includes('art') || name.includes('photo') || name.includes('canvas')) return 'Frames';
  if (name.includes('saree') || name.includes('sari') || name.includes('silk') || name.includes('pattu') || name.includes('tussar') || name.includes('cotton')) return 'Sarees';
  if (name.includes('fabric') || name.includes('meter') || name.includes('dupatta') || name.includes('kurti') || name.includes('dress')) return 'Fabrics';
  return 'General';
}

function getRowBank(row) {
  if (!row) return 'Not Defined';
  return row.bank_account || row['Acc Name'] || row['Acc No'] || row['Bank'] || 'Not Defined';
}

// -------------------------------------------------------------
// AUTHENTICATION & SUPABASE FETCHER
// -------------------------------------------------------------
function checkSession() {
  const savedUser = localStorage.getItem('kk_user');
  const loginTime = localStorage.getItem('kk_login_time');
  if (!savedUser || !loginTime) return { valid: false };
  if (Date.now() - parseInt(loginTime, 10) > SESSION_TIMEOUT) {
    localStorage.clear();
    return { valid: false };
  }
  currentRole = localStorage.getItem('kk_role') || 'Admin';
  currentUserId = savedUser;
  currentEmployeeId = localStorage.getItem('kk_emp_id') || 'KS-001';
  currentDisplayName = localStorage.getItem('kk_display_name') || savedUser;
  isAdmin = true;
  return { valid: true, user: savedUser, role: currentRole, empId: currentEmployeeId };
}

function handleLogout() {
  localStorage.clear();
  location.reload();
}

async function fetchData(user, pass) {
  const cleanUser = (user || 'admin').trim().toLowerCase();

  if (!supabaseClient) {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
      alert("Supabase JS Library is not loaded. Please verify the script tag in index.html");
      return;
    }
  }

  showEl('loader');
  hideEl('standard-main');
  hideEl('login-screen');

  try {
    currentRole = 'Admin';
    currentEmployeeId = 'KS-001';
    currentDisplayName = cleanUser.toUpperCase();
    currentUserId = cleanUser;
    isAdmin = true;

    localStorage.setItem('kk_user', cleanUser);
    localStorage.setItem('kk_role', currentRole);
    localStorage.setItem('kk_emp_id', currentEmployeeId);
    localStorage.setItem('kk_display_name', currentDisplayName);
    localStorage.setItem('kk_login_time', Date.now().toString());

    // 1. Fetch all sales from Supabase
    let allSalesRecords = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = supabaseClient.from('sales').select('*').range(from, from + step - 1);
      const { data, error } = await query;
      if (error) throw error;

      if (data && data.length > 0) {
        allSalesRecords.push(...data);
        if (data.length < step) hasMore = false;
        else from += step;
      } else {
        hasMore = false;
      }
    }

    // 2. Normalizing Records
    const seenRecords = new Set();
    const cleanSales = [];

    allSalesRecords.forEach(r => {
      const rawDate = normalizeToDateString(r.bill_date || r['Bill Date'] || r.date);
      if (!rawDate) return; // Skip invalid year rows

      const rawAmt = getRowAmount(r);
      const rawItem = r.item_name || r['Item Name'] || r.item || 'Product';
      const rawBillNo = getBillNo(r);
      const rawStore = r.store_name || r.store || r['Branch Name'] || 'Main Branch';
      const rawSM = r.sm_name || r['SM Name'] || r['Agent'] || 'No Agent';
      const rawPayMode = r.pay_mode || r['PayMode'] || 'Cash';
      const rawSaleType = r.sale_type || r['Sale type'] || getSalesType(rawPayMode);
      const rawBank = r.bank_account || r['Acc Name'] || 'Cash';

      const recordKey = `${rawStore}_${rawBillNo}_${rawItem}_${rawDate}_${rawAmt}`.toLowerCase();
      if (!seenRecords.has(recordKey)) {
        seenRecords.add(recordKey);
        cleanSales.push({
          'Bill No': rawBillNo,
          'Bill Date': rawDate,
          'Store': rawStore,
          'Item Name': rawItem,
          'Qty': parseInt(r.qty || r['Qty'] || 1, 10) || 1,
          'Final Amount': rawAmt,
          'amount': rawAmt,
          'SM Name': rawSM,
          'PayMode': rawPayMode,
          'Sale type': rawSaleType,
          'Acc No': rawBank
        });
      }
    });

    rawData = cleanSales;

    // 3. Fallback Attendance Generation for Sales Staff
    const staffSet = new Set();
    rawData.forEach(r => {
      if (r['SM Name'] && r['SM Name'] !== 'No Agent') staffSet.add(r['SM Name']);
    });

    rawAttendanceData = Array.from(staffSet).map((staffName, idx) => ({
      'Emp ID': `KS-${101 + idx}`,
      'Employee Name': staffName,
      'Month_Sheet': 'Current Month',
      'Designation': 'Sales Executive',
      'Monthly Salary': 15000,
      'Commission Pct': 1.0,
      'Advance Taken': 0
    }));

    bankAccountsList = ['Cash', '42441-TJ', 'KC'];
    updateHeaderRoleBadges();
    routeUserToRolePrimaryDashboard();

  } catch (err) {
    console.error("Supabase Fetch Error:", err);
    alert("Connection failed: " + (err.message || "Network Error"));
  } finally {
    hideEl('loader');
  }
}

function updateHeaderRoleBadges() {
  const badge = getEl('user-role-badge');
  const nameEl = getEl('user-display-name');
  if (badge) badge.textContent = 'ADMIN';
  if (nameEl) nameEl.textContent = `${currentDisplayName} (${currentEmployeeId})`;
  document.querySelectorAll('.admin-only, .role-admin-only').forEach(el => el.classList.remove('hidden'));
}

function routeUserToRolePrimaryDashboard() {
  showEl('standard-header');
  hideEl('login-screen');
  hideEl('loader');
  showEl('standard-main');

  detectDateRanges(); // Opens on TODAY or YESTERDAY!
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
    const sName = (row['Store'] || 'Main Branch').toString().trim();
    if (sName) storeSet.add(sName);
  });
  storeSelect.innerHTML = `<option value="All">All Branches / Stores</option>`;
  storeSet.forEach(sName => {
    storeSelect.innerHTML += `<option value="${sName}">${sName}</option>`;
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
    bSelect.innerHTML += `<option value="${bk}">${bk}</option>`;
  });
}

function populateAttendanceMonthDropdown() {
  const mSelect = getEl('attendance-month-select');
  if (!mSelect) return;
  mSelect.innerHTML = `<option value="All">All Months (Combined)</option>`;
}

// -------------------------------------------------------------
// DEFAULT DATE SELECTION (TODAY OR YESTERDAY DEFAULT)
// -------------------------------------------------------------
function detectDateRanges() {
  const fromEl = getEl('from-date');
  const toEl = getEl('to-date');
  const allDates = getAllNormalizedDates();

  const now = new Date();
  const todayStr = formatToYYYYMMDD(now);
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yestStr = formatToYYYYMMDD(yest);

  let defaultDate = todayStr;

  // If today has records, use today. If not, check yesterday. Otherwise use the latest valid date.
  if (allDates.includes(todayStr)) {
    defaultDate = todayStr;
    highlightActiveQuickDateButton('today');
  } else if (allDates.includes(yestStr)) {
    defaultDate = yestStr;
    highlightActiveQuickDateButton('yesterday');
  } else if (allDates.length > 0) {
    defaultDate = allDates[allDates.length - 1];
    highlightActiveQuickDateButton('latest');
  }

  if (fromEl) fromEl.value = defaultDate;
  if (toEl) toEl.value = defaultDate;
}

// -------------------------------------------------------------
// QUICK DATE PRESETS ENGINE
// -------------------------------------------------------------
function setQuickDateRange(preset) {
  const allDates = getAllNormalizedDates();
  const realToday = new Date();
  const realTodayStr = formatToYYYYMMDD(realToday);

  let refDateStr = allDates.length > 0 ? (allDates.includes(realTodayStr) ? realTodayStr : allDates[allDates.length - 1]) : realTodayStr;
  const [y, m, d] = refDateStr.split('-').map(Number);
  const refDate = new Date(y, m - 1, d);

  let fromDate = refDateStr, toDate = refDateStr;

  if (preset === 'today') {
    fromDate = realTodayStr;
    toDate = realTodayStr;
  } else if (preset === 'yesterday') {
    const yest = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() - 1);
    fromDate = formatToYYYYMMDD(yest);
    toDate = fromDate;
  } else if (preset === 'latest' && allDates.length > 0) {
    fromDate = allDates[allDates.length - 1];
    toDate = allDates[allDates.length - 1];
  } else if (preset === 'week') {
    const dayOfWeek = refDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(y, m - 1, d - diffToMonday);
    fromDate = formatToYYYYMMDD(monday);
    toDate = refDateStr;
  } else if (preset === 'month') {
    fromDate = formatToYYYYMMDD(new Date(y, m - 1, 1));
    toDate = refDateStr;
  } else if (preset === 'lastmonth') {
    fromDate = formatToYYYYMMDD(new Date(y, m - 2, 1));
    toDate = formatToYYYYMMDD(new Date(y, m - 1, 0));
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

// -------------------------------------------------------------
// CORE ANALYTICS PROCESSING ENGINE
// -------------------------------------------------------------
function processData() {
  const fromDate = getEl('from-date') ? getEl('from-date').value : '';
  const toDate = getEl('to-date') ? getEl('to-date').value : '';
  const searchVal = getEl('product-search') ? getEl('product-search').value.toLowerCase() : '';
  
  selectedStore = getEl('store-filter') ? getEl('store-filter').value : 'All';

  let storeTotals = {};
  let accountTotals = {}; 

  rawData.forEach(row => {
    const rDate = normalizeToDateString(row['Bill Date']);
    let dateMatch = (!fromDate || rDate >= fromDate) && (!toDate || rDate <= toDate);
    if (dateMatch) {
      const amount = getRowAmount(row);
      const storeName = row['Store'] || 'Main Branch';
      storeTotals[storeName] = (storeTotals[storeName] || 0) + amount;
    }
  });

  const filtered = rawData.filter(row => {
    const rDate = normalizeToDateString(row['Bill Date']);
    let match = (!fromDate || rDate >= fromDate) && (!toDate || rDate <= toDate);
    if (selectedStore !== 'All' && (row['Store'] || 'Main Branch').toLowerCase() !== selectedStore.toLowerCase()) match = false;
    return match;
  });

  let totalSales = 0, totalOnline = 0, totalOffline = 0, totalWholesale = 0, totalUnits = 0;
  let payUpiStore = 0, payUpiOnline = 0, payCash = 0, payCard = 0, payHand = 0;

  const uniqueBills = new Set();
  const productsObj = {}, agentsObj = {}, dayWiseObj = {};

  filtered.forEach(row => {
    const amount = getRowAmount(row);
    const qty = parseInt(row['Qty'] || 1, 10) || 1;
    const item = row['Item Name'] || 'General Item';
    const agent = row['SM Name'] || 'No Agent';
    const payMode = row['PayMode'] || 'Cash';
    const billDate = normalizeToDateString(row['Bill Date']);
    const billNo = getBillNo(row);
    const type = getSalesType(payMode, row['Sale type']);

    totalSales += amount;
    totalUnits += qty;

    const bAcc = getRowBank(row);
    accountTotals[bAcc] = (accountTotals[bAcc] || 0) + amount;

    const cleanPm = payMode.toLowerCase();
    if (cleanPm.includes('cash')) payCash += amount;
    else if (cleanPm.includes('card')) payCard += amount;
    else if (cleanPm.includes('hand') || cleanPm.includes('wholesale')) payHand += amount;
    else if (cleanPm.includes('onl')) payUpiOnline += amount;
    else payUpiStore += amount;

    if (type === 'Online') totalOnline += amount;
    else if (type === 'Wholesale') totalWholesale += amount;
    else totalOffline += amount;

    const billKey = billNo !== 'N/A' ? billNo : `${billDate}-${amount}`;
    uniqueBills.add(billKey);

    if (billDate) {
      if (!dayWiseObj[billDate]) dayWiseObj[billDate] = { total: 0, agents: {} };
      dayWiseObj[billDate].total += amount;
      dayWiseObj[billDate].agents[agent] = (dayWiseObj[billDate].agents[agent] || 0) + amount;
    }

    if (!productsObj[item]) productsObj[item] = { name: item, qty: 0, revenue: 0, onlineQty: 0, offlineQty: 0, wholesaleQty: 0 };
    productsObj[item].qty += qty;
    productsObj[item].revenue += amount;
    if (type === 'Online') productsObj[item].onlineQty += qty;
    else if (type === 'Wholesale') productsObj[item].wholesaleQty += qty;
    else productsObj[item].offlineQty += qty;

    if (!agentsObj[agent]) agentsObj[agent] = { name: agent, revenue: 0, items: {}, bills: {}, unitCount: 0 };
    agentsObj[agent].revenue += amount;
    agentsObj[agent].unitCount += qty;

    if (!agentsObj[agent].items[item]) agentsObj[agent].items[item] = { qty: 0, revenue: 0 };
    agentsObj[agent].items[item].qty += qty;
    agentsObj[agent].items[item].revenue += amount;

    if (!agentsObj[agent].bills[billKey]) {
      agentsObj[agent].bills[billKey] = { billNo: billNo, date: billDate, amount: 0, bank: bAcc };
    }
    agentsObj[agent].bills[billKey].amount += amount;
  });

  setText('metric-total', `₹${totalSales.toLocaleString('en-IN')}`);
  setText('metric-online', `₹${totalOnline.toLocaleString('en-IN')}`);
  setText('metric-offline', `₹${totalOffline.toLocaleString('en-IN')}`);
  setText('metric-wholesale', `₹${totalWholesale.toLocaleString('en-IN')}`);

  // Dynamic Store Comparison Cards
  const storeBreakdownContainer = getEl('store-breakdown-container');
  if (storeBreakdownContainer) {
    const storeNames = Object.keys(storeTotals);
    if (storeNames.length <= 1) {
      storeBreakdownContainer.innerHTML = '';
    } else {
      const colors = [
        { border: 'border-amber-400', badge: 'bg-amber-600', text: 'text-stone-800' },
        { border: 'border-indigo-400', badge: 'bg-indigo-600', text: 'text-[#5C0612]' }
      ];
      storeBreakdownContainer.innerHTML = storeNames.map((sName, idx) => {
        const style = colors[idx % colors.length];
        const isSelected = selectedStore === sName;
        return `
          <div onclick="selectStoreFilter('${sName}')" class="bg-[#FFFDF9] p-4 rounded-2xl border ${isSelected ? 'border-[#5C0612] ring-2 ring-[#5C0612]' : style.border} warm-shadow cursor-pointer transition-all hover:scale-[1.01]">
            <p class="text-[9px] font-bold text-stone-500 uppercase tracking-wider flex items-center justify-between font-traditional">
              <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${style.badge} inline-block"></span> ${sName}</span>
              <span class="text-[8px] text-[#5C0612] font-bold uppercase">${isSelected ? 'Active' : 'Filter →'}</span>
            </p>
            <p class="text-lg sm:text-2xl font-black ${style.text} mt-2 font-numeric">₹${storeTotals[sName].toLocaleString('en-IN')}</p>
          </div>
        `;
      }).join('');
    }
  }

  // Payment Breakdown
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

  productsList = Object.values(productsObj).map(p => {
    p.category = getItemCategory(p.name);
    return p;
  }).filter(p => p.name.toLowerCase().includes(searchVal));

  agentsList = Object.values(agentsObj).map(a => {
    a.billCount = Object.keys(a.bills).length;
    a.upt = a.billCount > 0 ? (a.unitCount / a.billCount) : 0;
    return a;
  });

  renderProductsTable();
  renderAgentsTable();
  renderDayWiseSales(dayWiseObj);
  renderBankLedgerModule();
  renderAttendanceSalaryModule(totalSales);
}

// -------------------------------------------------------------
// TABLE RENDERERS & DRILLDOWNS
// -------------------------------------------------------------
function filterCategory(cat) {
  selectedCategory = cat;
  ['All', 'Sarees', 'Fabrics', 'Frames'].forEach(c => {
    const btn = getEl(`cat-btn-${c.toLowerCase()}`);
    if (btn) {
      btn.className = c === cat ? "px-3 py-1 rounded-full bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-bold shadow-sm" : "px-3 py-1 rounded-full bg-[#FFFDF9] text-stone-600 border border-[#E5D5C6] hover:bg-stone-100 font-bold";
    }
  });
  renderProductsTable();
}

function renderProductsTable() {
  const tbody = getEl('products-table-body');
  if (!tbody) return;

  let displayList = productsList.filter(p => selectedCategory === 'All' || p.category === selectedCategory);
  displayList.sort((a, b) => b.revenue - a.revenue);

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-stone-400 font-traditional">No items found for this selection</td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map(p => `
    <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showProductDetails('${p.name.replace(/'/g, "\\'")}')">
      <td class="p-3.5">
        <div class="font-bold text-stone-800 flex justify-between items-center font-sans text-xs">
          <span>${p.name}</span>
          <i class="fa-solid fa-angle-right text-[10px] text-stone-400 mr-2"></i>
        </div>
        <div class="text-[10px] text-stone-500 font-bold mt-1 font-sans">
          <span class="text-blue-600">Online: ${p.onlineQty}</span> • 
          <span class="text-orange-600">Offline: ${p.offlineQty}</span> • 
          <span class="text-purple-600">Takebyhand: ${p.wholesaleQty}</span>
        </div>
      </td>
      <td class="p-3.5 text-center font-bold text-stone-700">${p.qty}</td>
      <td class="p-3.5 text-right font-black text-[#5C0612]">₹${p.revenue.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}

function renderAgentsTable() {
  const tbody = getEl('agents-table-body');
  if (!tbody) return;

  agentsList.sort((a, b) => b.revenue - a.revenue);

  if (agentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" class="p-6 text-center text-stone-400 font-traditional">No staff sales recorded in this date range</td></tr>`;
    return;
  }

  tbody.innerHTML = agentsList.map(a => `
    <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showAgentDetails('${a.name.replace(/'/g, "\\'")}')">
      <td class="p-3.5 font-bold text-stone-700 font-sans">
        <div class="flex justify-between items-center">
          <span>${a.name}</span>
          <span class="text-[9px] text-[#DAA520] font-bold flex items-center gap-1 font-traditional">Ledger <i class="fa-solid fa-chevron-right text-[8px]"></i></span>
        </div>
        <div class="text-[9px] text-stone-500 font-bold mt-1 font-sans">
          Basket (UPT): <strong class="font-numeric">${a.upt.toFixed(1)}</strong> • Avg Ticket (ATV): <strong class="text-[#5C0612] font-numeric">₹${Math.round(a.billCount > 0 ? (a.revenue / a.billCount) : 0).toLocaleString('en-IN')}</strong>
        </div>
      </td>
      <td class="p-3.5 text-right font-black text-[#5C0612] font-numeric">₹${a.revenue.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
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
    const agentsListHTML = sortedAgents.map(([agentName, rev]) => `
      <div class="flex justify-between items-center py-1.5 text-[11px] text-stone-600">
        <span class="font-sans font-medium text-stone-700">${agentName}</span>
        <span class="font-numeric font-bold text-stone-800">₹${rev.toLocaleString('en-IN')}</span>
      </div>
    `).join('');

    return `
      <div class="border border-[#E5D5C6] rounded-xl bg-[#FFFDF9] overflow-hidden warm-shadow mb-3">
        <div class="bg-[#F3EFE9] px-4 py-2.5 border-b border-[#E5D5C6] flex justify-between items-center">
          <span class="font-traditional font-bold text-stone-800 text-xs">${dateStr}</span>
          <span class="font-numeric font-black text-[#5C0612] text-xs">Total: ₹${dayData.total.toLocaleString('en-IN')}</span>
        </div>
        <div class="p-3 divide-y divide-[#E5D5C6]/10">${agentsListHTML}</div>
      </div>
    `;
  }).join('');
}

function renderBankLedgerModule() {
  const tbody = getEl('bank-ledger-tbody');
  if (!tbody) return;
  tbody.innerHTML = rawData.slice(0, 100).map(r => `
    <tr class="hover:bg-amber-50/20">
      <td class="p-3 text-stone-700 font-numeric">${r['Bill Date']}</td>
      <td class="p-3 font-bold text-stone-800 font-numeric">${r['Bill No']}</td>
      <td class="p-3">${r['Store']}</td>
      <td class="p-3">${r['SM Name']}</td>
      <td class="p-3"><span class="bg-amber-100 text-amber-900 text-[9px] font-bold px-2 py-0.5 rounded">${getRowBank(r)}</span></td>
      <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${getRowAmount(r).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// ATTENDANCE & PAYROLL MODULE
// -------------------------------------------------------------
function setAttendanceViewMode(mode) {
  attendanceViewMode = mode;
  const gridBtn = getEl('btn-attendance-mode-grid');
  const sumBtn = getEl('btn-attendance-mode-summary');

  if (mode === 'grid') {
    if (gridBtn) gridBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-traditional";
    if (sumBtn) sumBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-white text-stone-600 border border-[#E5D5C6] font-traditional";
    showEl('staff-salary-list');
    hideEl('staff-salary-summary-view');
  } else {
    if (gridBtn) gridBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-white text-stone-600 border border-[#E5D5C6] font-traditional";
    if (sumBtn) sumBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-traditional";
    hideEl('staff-salary-list');
    showEl('staff-salary-summary-view');
  }
}

function filterAttendanceMonth(m) {
  selectedAttendanceMonth = m;
  renderAttendanceSalaryModule(parseFloat((getEl('metric-total')?.textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
}

function renderAttendanceSalaryModule(storeRevenue = 0) {
  const container = getEl('staff-salary-list');
  const summaryTbody = getEl('staff-salary-summary-tbody');
  if (!container) return;

  container.innerHTML = '';
  if (summaryTbody) summaryTbody.innerHTML = '';

  let totalStorePayroll = 0;
  setText('payroll-staff-count', rawAttendanceData.length);
  setText('profit-store-sales', `₹${storeRevenue.toLocaleString('en-IN')}`);

  const summaryRowsHTML = [];

  rawAttendanceData.forEach((emp, index) => {
    const empId = emp['Emp ID'] || `KS-${101 + index}`;
    const name = emp['Employee Name'] || `Staff ${index + 1}`;
    const role = emp['Designation'] || 'Sales Staff';
    const baseSalary = parseFloat(emp['Monthly Salary']) || 15000;
    const commPct = parseFloat(emp['Commission Pct']) || 1.0;
    const advance = parseFloat(emp['Advance Taken']) || 0;

    const staffObj = agentsList.find(a => a.name.toLowerCase() === name.toLowerCase());
    const totalSold = staffObj ? staffObj.revenue : 0;
    const incentive = Math.round(totalSold * (commPct / 100));
    const netPay = Math.max(0, (baseSalary + incentive) - advance);
    totalStorePayroll += netPay;

    // Grid Card
    const card = document.createElement('div');
    card.className = "bg-[#FFFDF9] rounded-3xl border border-[#E5D5C6] warm-shadow p-5 space-y-3 relative overflow-hidden";
    card.innerHTML = `
      <div class="zari-border absolute top-0 left-0 right-0"></div>
      <div class="flex justify-between items-start border-b border-[#E5D5C6]/60 pb-2">
        <div>
          <span class="text-[9px] font-bold text-[#5C0612] bg-[#EFE5C9] px-2 py-0.5 rounded font-numeric border border-[#DAA520]">${empId}</span>
          <h4 class="font-bold text-stone-800 text-sm font-sans mt-1">${name}</h4>
          <p class="text-[10px] text-stone-500 font-traditional">${role}</p>
        </div>
        <div class="text-right font-numeric">
          <p class="text-[9px] text-stone-500 uppercase">Net Salary</p>
          <p class="text-lg font-black text-[#5C0612]">₹${netPay.toLocaleString('en-IN')}</p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 bg-[#FAF6EE] p-2.5 rounded-2xl border border-[#E5D5C6] text-center font-numeric text-xs">
        <div><span class="block text-[8px] text-stone-500">Sales Generated</span><strong class="text-stone-800 font-bold">₹${totalSold.toLocaleString('en-IN')}</strong></div>
        <div><span class="block text-[8px] text-emerald-800">Incentive (${commPct}%)</span><strong class="text-emerald-900 font-bold">+₹${incentive.toLocaleString('en-IN')}</strong></div>
        <div><span class="block text-[8px] text-rose-800">Advance</span><strong class="text-rose-900 font-bold">-₹${advance.toLocaleString('en-IN')}</strong></div>
      </div>
    `;
    container.appendChild(card);

    // Summary Table Row
    summaryRowsHTML.push(`
      <tr class="hover:bg-amber-50/20">
        <td class="p-3"><strong class="text-stone-800">${name}</strong> (${empId})</td>
        <td class="p-3 text-center font-bold text-emerald-800">30 / 30</td>
        <td class="p-3 text-center font-bold text-amber-900">4 / 4</td>
        <td class="p-3 text-right font-bold text-stone-700">₹${totalSold.toLocaleString('en-IN')}</td>
        <td class="p-3 text-right">₹${baseSalary.toLocaleString('en-IN')}</td>
        <td class="p-3 text-right text-emerald-800 font-bold">+₹${incentive.toLocaleString('en-IN')}</td>
        <td class="p-3 text-right text-rose-700 font-bold">-₹${advance.toLocaleString('en-IN')}</td>
        <td class="p-3 text-right font-black text-[#5C0612]">₹${netPay.toLocaleString('en-IN')}</td>
        <td class="p-3 text-center"><span class="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold uppercase">Active</span></td>
      </tr>
    `);
  });

  if (summaryTbody) summaryTbody.innerHTML = summaryRowsHTML.join('');
  setText('payroll-total-amount', `₹${totalStorePayroll.toLocaleString('en-IN')}`);

  const grossProfitEl = getEl('profit-gross-amount');
  if (grossProfitEl) {
    const grossVal = storeRevenue - totalStorePayroll;
    grossProfitEl.textContent = `₹${grossVal.toLocaleString('en-IN')}`;
    grossProfitEl.className = grossVal >= 0 ? "text-lg font-black text-emerald-700 font-numeric" : "text-lg font-black text-rose-700 font-numeric";
  }
}

// -------------------------------------------------------------
// PRODUCT-WISE & STAFF-WISE DRILLDOWNS
// -------------------------------------------------------------
function showProductDetails(productName) {
  setText('detail-product-name', productName);
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';

  const agentStats = {};
  rawData.forEach(row => {
    const rDate = normalizeToDateString(row['Bill Date']);
    if (fromVal && rDate < fromVal) return;
    if (toVal && rDate > toVal) return;
    if (selectedStore !== 'All' && (row['Store'] || 'Main Branch').toLowerCase() !== selectedStore.toLowerCase()) return;
    if (row['Item Name'] !== productName) return;

    const agent = row['SM Name'] || 'No Agent';
    const amount = getRowAmount(row);
    const type = getSalesType(row['PayMode'], row['Sale type']);

    if (!agentStats[agent]) agentStats[agent] = { online: 0, offline: 0, wholesale: 0, total: 0 };
    if (type === 'Online') agentStats[agent].online += amount;
    else if (type === 'Wholesale') agentStats[agent].wholesale += amount;
    else agentStats[agent].offline += amount;
    agentStats[agent].total += amount;
  });

  const sortedAgents = Object.entries(agentStats).sort((a, b) => b[1].total - a[1].total);
  const tbody = getEl('product-detail-table-body');
  if (tbody) {
    tbody.innerHTML = sortedAgents.length === 0 ? `<tr><td colspan="5" class="p-3 text-center text-stone-400 font-traditional">No sales recorded</td></tr>` : sortedAgents.map(([agentName, stats]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-2 font-bold text-stone-700">${agentName}</td>
        <td class="p-2 text-right text-blue-600 font-bold font-numeric">₹${stats.online.toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-orange-600 font-bold font-numeric">₹${stats.offline.toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-purple-600 font-bold font-numeric">₹${stats.wholesale.toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-[#5C0612] font-black font-numeric">₹${stats.total.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  showEl('product-detail-card');
}

function showAgentDetails(agentName) {
  activeAnalysisAgent = agentName;
  applyState({ view: 'agent-analysis', name: agentName });
}

function populateAgentAnalysisScreenDOM(agentName) {
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';
  
  setText('agent-analysis-title', `${agentName} Ledger`);
  setText('agent-analysis-subtitle', `Period: ${fromVal || 'Start'} to ${toVal || 'End'}`);

  const agentRows = rawData.filter(row => {
    const rDate = normalizeToDateString(row['Bill Date']);
    if (fromVal && rDate < fromVal) return false;
    if (toVal && rDate > toVal) return false;
    if (selectedStore !== 'All' && (row['Store'] || 'Main Branch').toLowerCase() !== selectedStore.toLowerCase()) return false;
    return (row['SM Name'] || '').toLowerCase() === agentName.toLowerCase();
  });

  let totalRevenue = 0, onlineSales = 0, offlineSales = 0, tbhSales = 0;
  const productSales = {}, dailyGroup = {};

  agentRows.forEach(row => {
    const amount = getRowAmount(row);
    const item = row['Item Name'];
    const channel = getSalesType(row['PayMode'], row['Sale type']);
    const date = normalizeToDateString(row['Bill Date']);
    const billNo = getBillNo(row);

    totalRevenue += amount;
    if (channel === 'Online') onlineSales += amount;
    else if (channel === 'Wholesale') tbhSales += amount;
    else offlineSales += amount;

    if (!productSales[item]) productSales[item] = { name: item, revenue: 0, qty: 0 };
    productSales[item].revenue += amount;
    productSales[item].qty += parseInt(row['Qty'] || 1, 10) || 1;

    if (!dailyGroup[date]) dailyGroup[date] = { total: 0, bills: {} };
    dailyGroup[date].total += amount;
    if (!dailyGroup[date].bills[billNo]) dailyGroup[date].bills[billNo] = { total: 0, items: [] };
    dailyGroup[date].bills[billNo].total += amount;
    dailyGroup[date].bills[billNo].items.push({ name: item, amount: amount });
  });

  setText('agent-analysis-total-revenue', `₹${totalRevenue.toLocaleString('en-IN')}`);
  setText('agent-analysis-online-sales', `₹${onlineSales.toLocaleString('en-IN')}`);
  setText('agent-analysis-offline-sales', `₹${offlineSales.toLocaleString('en-IN')}`);
  setText('agent-analysis-takebyhand-sales', `₹${tbhSales.toLocaleString('en-IN')}`);

  // Product share bars
  const productContainer = getEl('agent-analysis-product-share');
  if (productContainer) {
    const sortedProds = Object.values(productSales).sort((a, b) => b.revenue - a.revenue);
    productContainer.innerHTML = sortedProds.map(p => {
      const pct = totalRevenue > 0 ? ((p.revenue / totalRevenue) * 100).toFixed(1) : 0;
      return `
        <div class="space-y-1">
          <div class="flex justify-between items-center text-xs font-semibold text-stone-700">
            <span>${p.name} (${p.qty} sold)</span>
            <span class="font-numeric font-black text-[#5C0612]">₹${p.revenue.toLocaleString('en-IN')} (${pct}%)</span>
          </div>
          <div class="w-full bg-[#E5D5C6]/40 h-2 rounded-full overflow-hidden">
            <div class="bg-[#DAA520] h-full rounded-full" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Daily bills
  const dailyContainer = getEl('agent-analysis-daily-list');
  if (dailyContainer) {
    const sortedDates = Object.keys(dailyGroup).sort((a, b) => b.localeCompare(a));
    dailyContainer.innerHTML = sortedDates.map(dateStr => `
      <div class="border border-[#E5D5C6] rounded-xl bg-[#FFFDF9] overflow-hidden warm-shadow mb-3">
        <div class="bg-[#F3EFE9] px-4 py-2.5 border-b border-[#E5D5C6] flex justify-between items-center">
          <span class="font-traditional font-bold text-stone-800 text-xs">${dateStr}</span>
          <span class="font-numeric font-black text-[#5C0612] text-xs">Day Total: ₹${dailyGroup[dateStr].total.toLocaleString('en-IN')}</span>
        </div>
        <div class="p-3 divide-y divide-[#E5D5C6]/10">
          ${Object.entries(dailyGroup[dateStr].bills).map(([bNo, bData]) => `
            <div class="flex justify-between items-center py-1 text-xs">
              <span>Bill No: <strong>${bNo}</strong></span>
              <strong class="text-[#5C0612] font-numeric">₹${bData.total.toLocaleString('en-IN')}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }
}

// -------------------------------------------------------------
// ONLINE / OFFLINE / WHOLESALE CHANNEL SCREEN
// -------------------------------------------------------------
function selectChannel(channel) {
  if (channel === 'All') {
    applyState({ view: 'home' });
    return;
  }
  applyState({ view: 'channel', channel: channel });
}

function populateChannelScreenDOM(channel) {
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';

  setText('channel-view-title', `${channel} Channel Sales`);
  setText('channel-view-subtitle', `Period: ${fromVal || 'Start'} to ${toVal || 'End'}`);

  const filtered = rawData.filter(row => {
    const rDate = normalizeToDateString(row['Bill Date']);
    if (fromVal && rDate < fromVal) return false;
    if (toVal && rDate > toVal) return false;
    if (selectedStore !== 'All' && (row['Store'] || 'Main Branch').toLowerCase() !== selectedStore.toLowerCase()) return false;
    return getSalesType(row['PayMode'], row['Sale type']) === channel;
  });

  let totalChannelRevenue = 0;
  const agentsObj = {}, productsObj = {};

  filtered.forEach(row => {
    const amount = getRowAmount(row);
    const qty = parseInt(row['Qty'] || 1, 10) || 1;
    const item = row['Item Name'] || 'Item';
    const agent = row['SM Name'] || 'No Agent';

    totalChannelRevenue += amount;
    agentsObj[agent] = (agentsObj[agent] || 0) + amount;
    if (!productsObj[item]) productsObj[item] = { qty: 0, revenue: 0 };
    productsObj[item].qty += qty;
    productsObj[item].revenue += amount;
  });

  setText('channel-view-total', `₹${totalChannelRevenue.toLocaleString('en-IN')}`);

  const agentTable = getEl('channel-agents-table');
  if (agentTable) {
    const sortedA = Object.entries(agentsObj).sort((a, b) => b[1] - a[1]);
    agentTable.innerHTML = sortedA.length === 0 ? `<tr><td colspan="2" class="p-4 text-center text-stone-400">No staff sales for ${channel}</td></tr>` : sortedA.map(([aName, amt]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700 font-sans">${aName}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${amt.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  const prodTable = getEl('channel-products-table');
  if (prodTable) {
    const sortedP = Object.entries(productsObj).sort((a, b) => b[1].revenue - a[1].revenue);
    prodTable.innerHTML = sortedP.length === 0 ? `<tr><td colspan="3" class="p-4 text-center text-stone-400">No products sold via ${channel}</td></tr>` : sortedP.map(([pName, pObj]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700 font-sans">${pName}</td>
        <td class="p-3 text-center font-bold text-stone-600 font-numeric">${pObj.qty}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${pObj.revenue.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

// -------------------------------------------------------------
// SPA NAVIGATION & MODAL CONTROLS
// -------------------------------------------------------------
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

function closeChannelScreen() { applyState({ view: 'home' }); }
function closeAgentAnalysisScreen() { applyState({ view: 'home' }); }
function closeProductDetail() { hideEl('product-detail-card'); }

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  showEl(tabId);

  const btnMap = {
    'products-tab': 'btn-products-tab',
    'agents-tab': 'btn-agents-tab',
    'daywise-tab': 'btn-daywise-tab',
    'banks-tab': 'btn-banks-tab',
    'attendance-tab': 'btn-attendance-tab'
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
  monthlyTarget = parseFloat(val) || 0;
  localStorage.setItem('kk_monthly_target', monthlyTarget.toString());
  processData();
}

function exportSectionToPDF(elementId, titleFilename) {
  const element = getEl(elementId);
  if (!element || typeof html2pdf === 'undefined') {
    alert("PDF Engine is loading or element was not found.");
    return;
  }
  const opt = {
    margin: 0.3,
    filename: `${titleFilename}_${formatToYYYYMMDD(new Date())}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save();
}

function shareOwnerDailySummaryWhatsApp() {
  const totalSalesText = getEl('metric-total')?.textContent || '₹0';
  let msg = `🌸 *KAILASH KALAMKARI - EXECUTIVE SALES SUMMARY* 🌸\n💰 *Total Revenue:* ${totalSalesText}\n`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

// -------------------------------------------------------------
// DOM INITIALIZATION
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = getEl('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = (getEl('login-username')?.value || '').trim();
      const pass = (getEl('login-password')?.value || '').trim();
      await fetchData(user, pass);
    });
  }

  getEl('from-date')?.addEventListener('change', processData);
  getEl('to-date')?.addEventListener('change', processData);
  getEl('product-search')?.addEventListener('input', processData);
  getEl('store-filter')?.addEventListener('change', processData);
  getEl('refresh-btn')?.addEventListener('click', () => {
    const s = checkSession();
    if (s.valid) fetchData(s.user, '');
  });

  const session = checkSession();
  if (session.valid) {
    fetchData(session.user, '');
  } else {
    showEl('login-screen');
    hideEl('loader');
  }
});