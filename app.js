/**
 * =========================================================================
 * KAILASH KALAMKARI - LIVE SUPABASE ANALYTICS & ATTENDANCE ENGINE (app.js)
 * Enterprise client with direct "Save Attendance to Supabase" button,
 * 11 staff members (KS-103 to KS-113), 31-day interactive grid, and payroll.
 * =========================================================================
 */

// 1. SUPABASE CREDENTIALS CONFIGURATION
const SUPABASE_URL = "https://dqvqqrbvklpiibzqivbp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxdnFxcmJ2a2xwaWlienFpdmJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MTk2OTUsImV4cCI6MjEwNjE5NTY5NX0.ljhpD3QBpXvi5DjrQ2wE6R4NdhOicu_3ODH7pX79K58";

let supabaseClient = null;
if (typeof supabase !== 'undefined' && supabase.createClient) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

const SESSION_TIMEOUT = 6 * 60 * 60 * 1000; // 6 Hours

// RBAC & Context
let currentRole = 'Admin';
let currentUserId = '';
let currentEmployeeId = '';
let currentDisplayName = '';
let isAdmin = true;

// 2. MASTER 11 STAFF DATASET (From attendancesep.csv)
const DEFAULT_ATTENDANCE_DATA = [
  { 'Emp ID': 'KS-103', 'Employee Name': 'B varalakshmi', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'A', '7':'P' },
  { 'Emp ID': 'KS-104', 'Employee Name': 'Ty mounika', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '8317649338', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'P', '7':'P' },
  { 'Emp ID': 'KS-105', 'Employee Name': 'r sanjana', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'P', '7':'P' },
  { 'Emp ID': 'KS-106', 'Employee Name': 'geethika', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '7995218133', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'P', '7':'P' },
  { 'Emp ID': 'KS-107', 'Employee Name': 'J sandhya', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '9618854507', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'P', '7':'P' },
  { 'Emp ID': 'KS-108', 'Employee Name': 'c Pushpa', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '7893617526', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'A', '7':'A' },
  { 'Emp ID': 'KS-109', 'Employee Name': 'Bharathamma', 'Designation': 'Sweeper', 'Month_Sheet': 'September 2026', 'Phone Number': '', 'Monthly Salary': 8000, 'Commission Pct': 0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'P', '7':'P' },
  { 'Emp ID': 'KS-110', 'Employee Name': 'Nandhini', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'P', '6':'P', '7':'P' },
  { 'Emp ID': 'KS-111', 'Employee Name': 'Harika', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '5':'HD', '6':'A', '7':'P' },
  { 'Emp ID': 'KS-112', 'Employee Name': 'Dhanalakshmi', 'Designation': 'Sales (Fabrics)', 'Month_Sheet': 'September 2026', 'Phone Number': '', 'Monthly Salary': 10000, 'Commission Pct': 1.0, 'Advance Taken': 0, 'status': 'Active', '4':'A', '5':'A', '6':'P', '7':'P' },
  { 'Emp ID': 'KS-113', 'Employee Name': 'M.Ammulu', 'Designation': 'Sweeper', 'Month_Sheet': 'September 2026', 'Phone Number': '', 'Monthly Salary': 8000, 'Commission Pct': 0, 'Advance Taken': 0, 'status': 'Active', '7':'P' }
];

// 3. MASTER STAFF ALIAS RESOLUTION MAP
const STAFF_ALIASES_MAP = {
  'KS-103': ['varalakshmi', 'vara lakshmi', 'b varalakshmi', 'b. varalakshmi', 'varalaxmi'],
  'KS-104': ['mouni', 'mounika', 'ty mounika', 't y mounika', 't.y. mounika'],
  'KS-105': ['sanjana', 'r sanjana', 'r. sanjana'],
  'KS-106': ['geethika', 'githika'],
  'KS-107': ['sandhya', 'j sandhya', 'j. sandhya'],
  'KS-108': ['pushpa', 'c pushpa', 'c. pushpa'],
  'KS-109': ['bharathamma'],
  'KS-110': ['nandhini', 'nandini'],
  'KS-111': ['harika'],
  'KS-112': ['dhanalakshmi', 'dhana lakshmi', 'dhana laskhmi', 'dhana laskhmi akka', 'dhanalakshmi akka'],
  'KS-113': ['ammulu', 'm.ammulu', 'm ammulu']
};

const WHOLESALE_AGENT_KEYWORDS = [
  'village', 'kalamkari', 'ayyappa', 'wholesale', 'sujatha', 'chengal', 'rayudu', 
  'prasanna', 'sravan', 'ravi', 'bala', 'thirumalesh', 'madhuri', 'leela', 'shireesha', 'swathi', 'preethi'
];

// Global Data Sets
let rawData = [];
let rawAttendanceData = JSON.parse(JSON.stringify(DEFAULT_ATTENDANCE_DATA));
let bankAccountsList = ['Cash', '42441-TJ', 'KC'];
let productsList = [];
let agentsList = [];

// Filters & Settings
let selectedStore = "All";
let selectedCategory = "All";
let selectedAttendanceMonth = "September 2026";
let selectedChannel = "All";
let activeAnalysisAgent = "";
let monthlyTarget = parseFloat(localStorage.getItem('kk_monthly_target')) || 1000000;
let defaultCommissionPct = 1.0;
let attendanceViewMode = 'grid'; // 'grid' | 'summary'

// Safe DOM Helpers
function getEl(id) { return document.getElementById(id); }
function showEl(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hideEl(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

// -------------------------------------------------------------
// STANDARDIZE STAFF & AGENT NAMES (Fixes Case & Typo Duplicates)
// -------------------------------------------------------------
function normalizeStaffName(name) {
  if (!name) return 'No Agent';
  let clean = name.toString().trim();
  if (!clean || clean === '-' || clean === 'N/A') return 'No Agent';
  if (/^\d+$/.test(clean)) return 'No Agent';

  const lower = clean.toLowerCase().replace(/\s+/g, ' ');
  if (lower === 'chenna kesava reddy' || lower === 'chenna kesavareddy' || lower === 'chenna kesava') return 'Chenna Kesava Reddy';
  if (lower === 'venkatesh') return 'Venkatesh';
  if (lower === 'mouni' || lower === 'mounika' || lower === 'ty mounika') return 'Mouni';
  if (lower === 'vara lakshmi' || lower === 'b varalakshmi' || lower === 'varalakshmi') return 'Vara Lakshmi';
  if (lower === 'dhana laskhmi akka' || lower === 'dhanalakshmi akka' || lower === 'dhanalakshmi' || lower === 'dhana lakshmi') return 'Dhanalakshmi';
  if (lower === 'kailash anna' || lower === 'kailash') return 'Kailash Anna';
  if (lower === 'admin') return 'ADMIN';
  if (lower === 'sravan') return 'Sravan';
  if (lower === 'prasanna') return 'Prasanna';
  if (lower === 'sujatha') return 'Sujatha';
  if (lower === 'chengal rayudu') return 'Chengal Rayudu';
  if (lower === 'village kalamkari') return 'Village Kalamkari';
  if (lower === 'ayyappa kalamkari') return 'Ayyappa Kalamkari';
  if (lower === 'sanjana' || lower === 'r sanjana') return 'Sanjana';
  if (lower === 'keerthi') return 'Keerthi';
  if (lower === 'harika') return 'Harika';
  if (lower === 'geethika') return 'Geethika';

  return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// -------------------------------------------------------------
// STRICT DATE PARSING & SANITIZATION
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

  const isoMatch = strVal.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    if (y >= 2020 && y <= 2027) return `${y}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
  }

  const dMmmYyyyMatch = strVal.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})/);
  if (dMmmYyyyMatch) {
    const day = String(dMmmYyyyMatch[1]).padStart(2, '0');
    const monthStr = dMmmYyyyMatch[2].substring(0, 3).toLowerCase();
    let year = parseInt(dMmmYyyyMatch[3], 10);
    if (year < 100) year = 2000 + year;
    const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    if (months[monthStr] && year >= 2020 && year <= 2027) return `${year}-${months[monthStr]}-${day}`;
  }

  const dmyMatch = strVal.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmyMatch) {
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year = 2000 + year;
    if (year >= 2020 && year <= 2027) return `${year}-${String(dmyMatch[2]).padStart(2, '0')}-${String(dmyMatch[1]).padStart(2, '0')}`;
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
    if (norm) dateSet.add(norm);
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
      if (!isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function getBillNo(row) {
  if (!row) return 'N/A';
  const directKeys = ['bill_no', 'Bil No', 'Bill No', 'Invoice No'];
  for (let k of directKeys) {
    if (row[k]) return row[k].toString().trim();
  }
  return 'N/A';
}

// -------------------------------------------------------------
// PRECISE CHANNEL CLASSIFIER (Online vs. Offline vs. Wholesale)
// -------------------------------------------------------------
function getSalesType(payMode, saleType, billNo, bankAcc) {
  const st = (saleType || '').toString().toLowerCase().trim();
  const pm = (payMode || '').toString().toLowerCase().trim();
  const bn = (billNo || '').toString().toUpperCase().trim();
  const bk = (bankAcc || '').toString().toLowerCase().trim();

  if (st.includes('onl') || pm.includes('onl') || pm.includes('online')) {
    return 'Online';
  }

  if (st.includes('hand') || st.includes('wholesale') || st.includes('tbh') || 
      pm.includes('hand') || pm.includes('wholesale') || pm.includes('tbh') || 
      bk.includes('tbh') || bn.includes('SN')) {
    return 'Wholesale';
  }

  return 'Offline';
}

// -------------------------------------------------------------
// FIXED PRODUCT CATEGORIZATION ENGINE
// Priority: Check Dupattas/Fabrics BEFORE Sarees
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// BULLETPROOF STAFF SALES CALCULATOR WITH ALIAS MATCHING
// -------------------------------------------------------------
function getStaffSalesAmount(empName, empId) {
  if (!empName) return 0;
  const cleanEmp = empName.toLowerCase().replace(/[^a-z0-9]/g, '');

  const allowedAliases = STAFF_ALIASES_MAP[empId] || [];
  let totalRevenueFound = 0;
  let matchedAgentKeys = new Set();

  agentsList.forEach(a => {
    const rawAgentName = (a.name || '').toString().toLowerCase().trim();
    const cleanAgentName = rawAgentName.replace(/[^a-z0-9]/g, '');

    for (let alias of allowedAliases) {
      const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanAgentName === cleanAlias || cleanAgentName.includes(cleanAlias) || cleanAlias.includes(cleanAgentName)) {
        if (!matchedAgentKeys.has(rawAgentName)) {
          matchedAgentKeys.add(rawAgentName);
          totalRevenueFound += a.revenue;
        }
        return;
      }
    }

    if (cleanAgentName === cleanEmp && !matchedAgentKeys.has(rawAgentName)) {
      matchedAgentKeys.add(rawAgentName);
      totalRevenueFound += a.revenue;
    }
  });

  return totalRevenueFound;
}

// -------------------------------------------------------------
// ATTENDANCE CALENDAR CONTEXT (31-Day & Sundays)
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// AUTHENTICATION & SUPABASE FETCH ENGINE
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
  isAdmin = (currentRole === 'Admin');
  return { valid: true, user: savedUser, role: currentRole, empId: currentEmployeeId };
}

function handleLogout() {
  localStorage.clear();
  location.reload();
}

async function fetchData(user, pass) {
  const cleanUser = (user || 'admin').trim().toLowerCase();
  const cleanPass = (pass || '').trim();

  if (!supabaseClient) {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
      alert("Supabase JS Library is not loaded. Check script tag in index.html");
      return;
    }
  }

  showEl('loader');
  hideEl('standard-main');
  hideEl('login-screen');

  try {
    const session = checkSession();

    // Verify login if credentials provided; otherwise verify session validity
    if (cleanPass) {
      const { data: userRow } = await supabaseClient
        .from('users')
        .select('*')
        .eq('username', cleanUser)
        .eq('password', cleanPass)
        .maybeSingle();

      if (!userRow) {
        if (cleanUser === 'admin' && (cleanPass === 'admin123' || cleanPass === 'admin')) {
          currentRole = 'Admin';
          currentDisplayName = 'Store Management';
          currentEmployeeId = 'KS-001';
        } else {
          showLoginError("Invalid username or password");
          return;
        }
      } else {
        currentRole = userRow.role || 'Viewer';
        currentDisplayName = userRow.display_name || cleanUser;
        currentEmployeeId = userRow.employee_id || 'KS-100';
      }

      currentUserId = cleanUser;
      isAdmin = (currentRole === 'Admin');

      localStorage.setItem('kk_user', cleanUser);
      localStorage.setItem('kk_role', currentRole);
      localStorage.setItem('kk_emp_id', currentEmployeeId);
      localStorage.setItem('kk_display_name', currentDisplayName);
      localStorage.setItem('kk_login_time', Date.now().toString());
    } else if (!session.valid) {
      showLoginError("Session expired. Please log in.");
      return;
    }

    // 1. Fetch All Sales with deterministic ID ordering
    let allSalesRecords = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    while (hasMore) {
      let query = supabaseClient
        .from('sales')
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + step - 1);

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

    // 2. Normalizing Sales Records
    // Unique key combines store + bill_no + sl_no (or unique id) so duplicate imports are dropped,
    // while multiple items on the same bill (with unique sl_no) are 100% preserved.
    const seenLineKeys = new Set();
    const cleanSales = [];

    allSalesRecords.forEach(r => {
      const rawStore = (r.store_name || r.store || r['Branch Name'] || 'Main Branch').trim();
      const rawBillNo = getBillNo(r);
      const rawSlNo = (r.sl_no !== undefined && r.sl_no !== null && r.sl_no !== '') ? r.sl_no.toString().trim() : '';

      const uniqueLineKey = (rawBillNo !== 'N/A' && rawSlNo !== '') 
        ? `${rawStore}_${rawBillNo}_${rawSlNo}` 
        : (r.id ? `id_${r.id}` : `${rawStore}_${rawBillNo}_${cleanSales.length}`);

      if (seenLineKeys.has(uniqueLineKey)) return;
      seenLineKeys.add(uniqueLineKey);

      let rawDate = normalizeToDateString(r.bill_date || r['Bill Date'] || r.date);
      if (!rawDate && r.created_at) {
        const splitDate = (r.created_at || '').toString().split('T')[0].split(' ')[0];
        rawDate = normalizeToDateString(splitDate);
      }
      if (!rawDate) rawDate = "2026-09-01";

      const rawAmt = getRowAmount(r);
      const rawItem = r.item_name || r['Item Name'] || r.item || 'Product';

      const rawSM = normalizeStaffName(r.sm_name || r.agent_name || r['SM Name'] || r['Agent']);
      const rawPayMode = r.pay_mode || r['PayMode'] || 'Cash';
      const rawBank = r.bank_account || r['Acc Name'] || 'Cash';
      const rawSaleType = getSalesType(rawPayMode, r.sale_type || r['Sale type'], rawBillNo, rawBank);

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
    });

    rawData = cleanSales;

    // 3. Fetch Master Attendance from Supabase with Safe JSON Parsing
    try {
      const { data: attRows, error: attError } = await supabaseClient
        .from('attendance')
        .select('*');

      if (!attError && attRows && attRows.length > 0) {
        rawAttendanceData = attRows.map(a => {
          let parsedDays = {};
          if (typeof a.days_data === 'string') {
            try { parsedDays = JSON.parse(a.days_data); } catch (e) { parsedDays = {}; }
          } else if (typeof a.days_data === 'object' && a.days_data !== null) {
            parsedDays = a.days_data;
          }

          return {
            'id': a.id,
            'Emp ID': a.emp_id,
            'Employee Name': a.employee_name,
            'Designation': a.designation || 'Sales (Fabrics)',
            'Month_Sheet': a.month_sheet || 'September 2026',
            'Phone Number': a.phone_number || '',
            'Monthly Salary': parseFloat(a.monthly_salary) || 10000,
            'Commission Pct': parseFloat(a.commission_pct) || 1.0,
            'Advance Taken': parseFloat(a.advance_taken) || 0,
            'status': a.status || 'Active',
            ...parsedDays,
            '_notes': a.notes_data || {}
          };
        });
      } else {
        rawAttendanceData = JSON.parse(JSON.stringify(DEFAULT_ATTENDANCE_DATA));
      }
    } catch (e) {
      rawAttendanceData = JSON.parse(JSON.stringify(DEFAULT_ATTENDANCE_DATA));
    }

    bankAccountsList = ['Cash', '42441-TJ', 'KC'];
    updateHeaderRoleBadges();
    routeUserToRolePrimaryDashboard();

  } catch (err) {
    console.error("Fetch Error:", err);
    alert("Connection failed: " + (err.message || "Network Error"));
  } finally {
    hideEl('loader');
  }
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
      badge.textContent = '👑 ADMIN (FULL ACCESS)';
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

  const monthSet = new Set();
  rawAttendanceData.forEach(emp => {
    if (emp['Month_Sheet']) monthSet.add(emp['Month_Sheet']);
  });

  const list = Array.from(monthSet);
  if (list.length === 0) list.push("September 2026");

  mSelect.innerHTML = list.map(m => `<option value="${m}" ${m === selectedAttendanceMonth ? 'selected' : ''}>${m}</option>`).join('');
  if (!list.includes(selectedAttendanceMonth)) {
    selectedAttendanceMonth = list[0];
    mSelect.value = selectedAttendanceMonth;
  }
}

function detectDateRanges() {
  const fromEl = getEl('from-date');
  const toEl = getEl('to-date');
  const allDates = getAllNormalizedDates();

  if (allDates.length === 0) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const firstDayOfMonth = `${year}-${month}-01`;
  const latestDate = allDates[allDates.length - 1];

  const defaultFrom = allDates.includes(firstDayOfMonth) ? firstDayOfMonth : (allDates[0] < firstDayOfMonth ? firstDayOfMonth : allDates[0]);

  if (fromEl) fromEl.value = defaultFrom;
  if (toEl) toEl.value = latestDate;

  highlightActiveQuickDateButton('month');
}

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
    const type = row['Sale type'];

    totalSales += amount;
    totalUnits += qty;

    const bAcc = row['Acc No'] || 'Cash';
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

  // Display Exact Revenue matching Supabase SQL
  setText('metric-total', `₹${totalSales.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  setText('metric-online', `₹${totalOnline.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  setText('metric-offline', `₹${totalOffline.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  setText('metric-wholesale', `₹${totalWholesale.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Target Progress Card Updates
  const targetPct = monthlyTarget > 0 ? Math.min(100, Math.round((totalSales / monthlyTarget) * 100)) : 0;
  setText('target-percent-text', `${targetPct}%`);
  setText('target-achieved-text', `₹${Math.round(totalSales).toLocaleString('en-IN')}`);
  const targetBar = getEl('target-progress-bar');
  if (targetBar) targetBar.style.width = `${targetPct}%`;
  setText('target-forecast-text', `Target: ₹${monthlyTarget.toLocaleString('en-IN')} (${targetPct}% Achieved)`);

  // Dynamic Store Cards
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
            <p class="text-lg sm:text-2xl font-black ${style.text} mt-2 font-numeric">₹${storeTotals[sName].toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
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

  const digitalSales = payUpiStore + payUpiOnline + payCard;
  const digitalPct = totalSales > 0 ? Math.round((digitalSales / totalSales) * 100) : 0;
  setText('metric-digital-pct', `${digitalPct}% Digital`);

  // Bank Split Summary Container
  const accContainer = getEl('account-split-container');
  if (accContainer) {
    accContainer.innerHTML = Object.entries(accountTotals).map(([acc, amt]) => `
      <div class="bg-amber-50/60 p-2.5 rounded-xl border border-amber-200 text-center">
        <span class="block text-[8px] font-bold text-amber-800 uppercase font-traditional tracking-wider">${acc}</span>
        <strong class="text-xs font-black text-[#5C0612] font-numeric">₹${Math.round(amt).toLocaleString('en-IN')}</strong>
      </div>
    `).join('');
  }

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

    const cleanA = a.name.toLowerCase();
    const isWholesale = WHOLESALE_AGENT_KEYWORDS.some(kw => cleanA.includes(kw));
    const isManagement = cleanA.includes('admin') || cleanA.includes('kailash');
    
    if (isManagement) a.typeLabel = 'Store Management';
    else if (isWholesale) a.typeLabel = 'Wholesale Partner';
    else a.typeLabel = 'Sales Staff';

    return a;
  });

  renderProductsTable();
  renderAgentsTable();
  renderDayWiseSales(dayWiseObj);
  renderBankLedgerModule();
  renderAttendanceSalaryModule(totalSales);
}

// -------------------------------------------------------------
// TABLE RENDERERS
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
          <span class="text-[9px] font-bold uppercase text-[#5C0612] bg-[#EFE5C9] px-2 py-0.5 rounded font-traditional border border-[#DAA520]">${p.category}</span>
        </div>
        <div class="text-[10px] text-stone-500 font-bold mt-1 font-sans">
          <span class="text-blue-600">Online: ${p.onlineQty}</span> • 
          <span class="text-orange-600">Offline: ${p.offlineQty}</span> • 
          <span class="text-purple-600">Takebyhand: ${p.wholesaleQty}</span>
        </div>
      </td>
      <td class="p-3.5 text-center font-bold text-stone-700">${p.qty}</td>
      <td class="p-3.5 text-right font-black text-[#5C0612]">₹${Math.round(p.revenue).toLocaleString('en-IN')}</td>
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

  tbody.innerHTML = agentsList.map(a => {
    let badgeStyle = "bg-blue-100 text-blue-800 border-blue-300";
    if (a.typeLabel === 'Wholesale Partner') badgeStyle = "bg-purple-100 text-purple-800 border-purple-300";
    if (a.typeLabel === 'Store Management') badgeStyle = "bg-amber-100 text-amber-800 border-amber-300";

    return `
      <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showAgentDetails('${a.name.replace(/'/g, "\\'")}')">
        <td class="p-3.5 font-bold text-stone-700 font-sans">
          <div class="flex justify-between items-center">
            <span class="flex items-center gap-1.5">
              <span>${a.name}</span>
              <span class="text-[8px] font-bold px-1.5 py-0.5 rounded border ${badgeStyle}">${a.typeLabel}</span>
            </span>
            <span class="text-[9px] text-[#DAA520] font-bold flex items-center gap-1 font-traditional">Ledger <i class="fa-solid fa-chevron-right text-[8px]"></i></span>
          </div>
          <div class="text-[9px] text-stone-500 font-bold mt-1 font-sans">
            Invoices: <strong class="font-numeric">${a.billCount}</strong> • Basket (UPT): <strong class="font-numeric">${a.upt.toFixed(1)}</strong> • Avg Ticket (ATV): <strong class="text-[#5C0612] font-numeric">₹${Math.round(a.billCount > 0 ? (a.revenue / a.billCount) : 0).toLocaleString('en-IN')}</strong>
          </div>
        </td>
        <td class="p-3.5 text-right font-black text-[#5C0612] font-numeric">₹${Math.round(a.revenue).toLocaleString('en-IN')}</td>
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
    const agentsListHTML = sortedAgents.map(([agentName, rev]) => `
      <div class="flex justify-between items-center py-1.5 text-[11px] text-stone-600">
        <span class="font-sans font-medium text-stone-700">${agentName}</span>
        <span class="font-numeric font-bold text-stone-800">₹${Math.round(rev).toLocaleString('en-IN')}</span>
      </div>
    `).join('');

    return `
      <div class="border border-[#E5D5C6] rounded-xl bg-[#FFFDF9] overflow-hidden warm-shadow mb-3">
        <div class="bg-[#F3EFE9] px-4 py-2.5 border-b border-[#E5D5C6] flex justify-between items-center">
          <span class="font-traditional font-bold text-stone-800 text-xs">${dateStr}</span>
          <span class="font-numeric font-black text-[#5C0612] text-xs">Total: ₹${Math.round(dayData.total).toLocaleString('en-IN')}</span>
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
      <td class="p-3"><span class="bg-amber-100 text-amber-900 text-[9px] font-bold px-2 py-0.5 rounded">${r['Acc No'] || 'Cash'}</span></td>
      <td class="p-3 text-right font-black text-[#5C0612]">₹${Math.round(getRowAmount(r)).toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// 31-DAY ATTENDANCE & MULTI-MONTH PAYROLL ENGINE
// -------------------------------------------------------------
function setAttendanceViewMode(mode) {
  attendanceViewMode = mode;
  const gridBtn = getEl('btn-attendance-mode-grid');
  const sumBtn = getEl('btn-attendance-mode-summary');

  if (mode === 'grid') {
    if (gridBtn) gridBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-traditional flex items-center justify-center gap-1.5 shadow-sm";
    if (sumBtn) sumBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-white text-stone-600 border border-[#E5D5C6] font-traditional flex items-center justify-center gap-1.5";
    showEl('staff-salary-list');
    hideEl('staff-salary-summary-view');
  } else {
    if (gridBtn) gridBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-white text-stone-600 border border-[#E5D5C6] font-traditional flex items-center justify-center gap-1.5";
    if (sumBtn) sumBtn.className = "flex-1 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-traditional flex items-center justify-center gap-1.5 shadow-sm";
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

  const monthContext = getMonthYearContext(selectedAttendanceMonth);

  let staffList = rawAttendanceData.filter(emp => {
    if (selectedAttendanceMonth === 'All') return true;
    return (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase();
  });

  if (staffList.length === 0) {
    staffList = rawAttendanceData;
  }

  let totalStorePayroll = 0;
  setText('payroll-staff-count', `${staffList.length} Staff`);
  setText('profit-store-sales', `₹${Math.round(storeRevenue).toLocaleString('en-IN')}`);

  const summaryRowsHTML = [];

  staffList.forEach((emp, index) => {
    const empId = emp['Emp ID'] || `KS-${103 + index}`;
    const name = emp['Employee Name'] || `Staff ${index + 1}`;
    const role = emp['Designation'] || 'Sales (Fabrics)';
    const phone = emp['Phone Number'] || '';
    
    let fullSalary = parseFloat(emp['Monthly Salary']) || 10000;
    let commPct = parseFloat(emp['Commission Pct']) || 1.0;
    let advance = parseFloat(emp['Advance Taken']) || 0;

    const totalSold = getStaffSalesAmount(name, empId);
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
        badgeBg = dayData.isSunday 
          ? 'bg-amber-100 text-amber-900 border-amber-300 font-black ring-1 ring-amber-400' 
          : 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
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
        <div onclick="cycleDayStatus(${index}, ${d})" class="flex flex-col items-center justify-center border rounded-xl ${badgeBg} text-[8px] py-1.5 font-numeric cursor-pointer hover:scale-105 transition-transform select-none" title="Day ${d} (${dayData.label}): Click to toggle status">
          <span class="text-[7px] ${dayData.isSunday ? 'text-amber-700 font-black' : 'text-stone-400'}">${dayData.label}</span>
          <span class="text-[10px] font-black leading-none mt-0.5">${displayText}</span>
        </div>
      `);
    }

    const payableDays = countP + (countHD * 0.5) + countPL + countWO;
    const baseEarned = Math.round(payableDays * (fullSalary / monthContext.daysInMonth));
    const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);
    totalStorePayroll += netSalary;

    // View 1: 31-Day Grid Card
    const card = document.createElement('div');
    card.className = "bg-[#FFFDF9] rounded-3xl border border-[#E5D5C6] warm-shadow p-5 space-y-3 relative overflow-hidden";
    card.innerHTML = `
      <div class="zari-border absolute top-0 left-0 right-0"></div>
      <div class="flex justify-between items-start border-b border-[#E5D5C6]/60 pb-2">
        <div>
          <span class="text-[9px] font-bold text-[#5C0612] bg-[#EFE5C9] px-2 py-0.5 rounded font-numeric border border-[#DAA520]">${empId}</span>
          <h4 class="font-bold text-stone-800 text-sm font-sans mt-1">${name}</h4>
          <p class="text-[10px] text-stone-500 font-traditional">${role} ${phone ? `• 📞 ${phone}` : ''}</p>
        </div>
        <div class="text-right font-numeric">
          <p class="text-[9px] text-stone-500 uppercase font-traditional">Net Payable</p>
          <p class="text-lg font-black text-[#5C0612]">₹${netSalary.toLocaleString('en-IN')}</p>
          <div class="flex gap-1 mt-1 justify-end export-ignore">
            <button onclick="shareStaffPayslipWhatsApp(${index})" class="text-[8px] bg-[#25D366] text-white px-2 py-0.5 rounded-lg font-bold uppercase flex items-center gap-1 active:scale-95">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </button>
            <button onclick="exportSingleStaffPayslipPDF(${index})" class="text-[8px] bg-[#5C0612] text-[#EFE5C9] px-2 py-0.5 rounded-lg font-bold uppercase flex items-center gap-1 border border-[#DAA520] active:scale-95">
              <i class="fa-solid fa-file-pdf"></i> PDF Slip
            </button>
          </div>
        </div>
      </div>

      <!-- ATTENDANCE STATS -->
      <div class="grid grid-cols-4 gap-1.5 bg-[#FAF6EE] p-2 rounded-2xl border border-[#E5D5C6] text-center font-numeric text-xs">
        <div><span class="block text-[7px] text-emerald-800 uppercase">Payable</span><strong class="text-emerald-900 font-black">${payableDays}/${monthContext.daysInMonth}</strong></div>
        <div><span class="block text-[7px] text-amber-800 uppercase">☀️ Sundays</span><strong class="text-amber-900 font-black">${sundaysWorked}/${monthContext.totalSundaysInMonth}</strong></div>
        <div><span class="block text-[7px] text-rose-800 uppercase">Absent</span><strong class="text-rose-900 font-black">${countA}</strong></div>
        <div><span class="block text-[7px] text-blue-800 uppercase">Half Days</span><strong class="text-blue-900 font-black">${countHD}</strong></div>
      </div>

      <!-- 31-DAY CALENDAR GRID -->
      <div class="space-y-1">
        <div class="flex justify-between items-center text-[9px] font-traditional text-stone-500">
          <span>31-Day Attendance Grid (Click cell to change status)</span>
          <span>${monthContext.monthName} ${monthContext.year}</span>
        </div>
        <div class="grid grid-cols-7 sm:grid-cols-11 gap-1 pt-0.5">
          ${gridDayBadges.join('')}
        </div>
      </div>

      <!-- SALARY EDITABLE INPUTS -->
      <div class="grid grid-cols-3 gap-2 bg-[#FAF6EE] p-2.5 rounded-2xl border border-[#E5D5C6] text-xs font-numeric">
        <div>
          <label class="block text-[8px] font-bold text-stone-500 uppercase mb-0.5">Base Salary (₹)</label>
          <input type="number" value="${fullSalary}" oninput="updateStaffPayroll(${index}, 'salary', this.value)" class="w-full text-xs font-bold border border-[#E5D5C6] bg-white rounded-lg p-1.5 text-stone-800 focus:outline-none">
        </div>
        <div>
          <label class="block text-[8px] font-bold text-stone-500 uppercase mb-0.5">Incentive Rate (%)</label>
          <input type="number" value="${commPct}" step="0.1" oninput="updateStaffPayroll(${index}, 'commission', this.value)" class="w-full text-xs font-bold border border-[#E5D5C6] bg-white rounded-lg p-1.5 text-stone-800 focus:outline-none">
          <span class="text-[8px] text-emerald-800 font-bold block mt-0.5">Sold: ₹${Math.round(totalSold).toLocaleString('en-IN')}</span>
        </div>
        <div>
          <label class="block text-[8px] font-bold text-stone-500 uppercase mb-0.5">Advance (₹)</label>
          <input type="number" value="${advance}" oninput="updateStaffPayroll(${index}, 'advance', this.value)" class="w-full text-xs font-bold border border-[#E5D5C6] bg-white rounded-lg p-1.5 text-stone-800 focus:outline-none">
        </div>
      </div>
    `;
    container.appendChild(card);

    // View 2: Summary Row
    summaryRowsHTML.push(`
      <tr class="hover:bg-amber-50/20 transition-colors">
        <td class="p-3">
          <strong class="text-stone-800 font-sans">${name}</strong>
          <span class="text-[9px] text-[#5C0612] bg-[#EFE5C9] px-1.5 py-0.5 rounded ml-1 font-numeric">${empId}</span>
          <div class="text-[9px] text-stone-400">${role}</div>
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
    const grossVal = storeRevenue - totalStorePayroll;
    grossProfitEl.textContent = `₹${Math.round(grossVal).toLocaleString('en-IN')}`;
    grossProfitEl.className = grossVal >= 0 ? "text-xl font-black text-emerald-700 font-numeric" : "text-xl font-black text-rose-700 font-numeric";
  }
}

function cycleDayStatus(staffIndex, dayNumber) {
  if (!isAdmin) {
    alert("🔒 Access Denied: Only Admin can modify staff attendance.");
    return;
  }
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[staffIndex] || rawAttendanceData[staffIndex];
  if (!emp) return;

  const dKey = dayNumber.toString();
  const currentVal = (emp[dKey] || '').toUpperCase().trim();

  const cycleOrder = ['', 'P', 'A', 'HD', 'WO', 'PL'];
  let nextIdx = (cycleOrder.indexOf(currentVal) + 1) % cycleOrder.length;
  emp[dKey] = cycleOrder[nextIdx];

  renderAttendanceSalaryModule(parseFloat((getEl('metric-total')?.textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
}

function updateStaffPayroll(index, field, val) {
  if (!isAdmin) {
    alert("🔒 Access Denied: Only Admin can modify staff salary structure.");
    return;
  }
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[index] || rawAttendanceData[index];
  if (!emp) return;
  if (field === 'salary') emp['Monthly Salary'] = parseFloat(val) || 0;
  else if (field === 'commission') emp['Commission Pct'] = parseFloat(val) || 0;
  else if (field === 'advance') emp['Advance Taken'] = parseFloat(val) || 0;
  renderAttendanceSalaryModule(parseFloat((getEl('metric-total')?.textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
}

// -------------------------------------------------------------
// SAVE ATTENDANCE DIRECTLY TO SUPABASE (PERMANENT ROW PERSISTENCE)
// -------------------------------------------------------------
async function saveAttendanceToSupabase() {
  if (!isAdmin) {
    alert("🔒 Access Denied: Only Admin can save attendance to database.");
    return;
  }

  const saveBtn = getEl('btn-save-attendance-main');
  const saveText = getEl('save-attendance-main-text');
  if (saveBtn) saveBtn.disabled = true;
  if (saveText) saveText.textContent = "⏳ Saving to Database...";

  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const targetList = staffList.length > 0 ? staffList : rawAttendanceData;

  const upsertPayload = targetList.map(emp => {
    const daysObj = {};
    for (let d = 1; d <= 31; d++) {
      const val = (emp[d.toString()] || emp[d < 10 ? '0' + d : d.toString()] || '').toString().toUpperCase().trim();
      if (val) daysObj[d.toString()] = val;
    }

    const payloadItem = {
      emp_id: emp['Emp ID'],
      employee_name: emp['Employee Name'],
      designation: emp['Designation'] || 'Sales (Fabrics)',
      month_sheet: selectedAttendanceMonth,
      phone_number: emp['Phone Number'] || '',
      monthly_salary: parseFloat(emp['Monthly Salary']) || 10000,
      commission_pct: parseFloat(emp['Commission Pct']) || 1.0,
      advance_taken: parseFloat(emp['Advance Taken']) || 0,
      status: emp.status || 'Active',
      days_data: daysObj
    };

    // If record already exists in Supabase with a UUID, pass it so it directly updates the row!
    if (emp.id) {
      payloadItem.id = emp.id;
    }

    return payloadItem;
  });

  try {
    const { data, error } = await supabaseClient
      .from('attendance')
      .upsert(upsertPayload, { onConflict: 'emp_id,month_sheet' })
      .select();

    if (error) throw error;

    if (data && data.length > 0) {
      data.forEach(savedRow => {
        const match = targetList.find(t => t['Emp ID'] === savedRow.emp_id);
        if (match) match.id = savedRow.id;
      });
    }

    alert(`✅ SUCCESS: Attendance for ${selectedAttendanceMonth} is permanently saved in Supabase!`);
  } catch (err) {
    console.error("Supabase Save Error:", err);
    alert("❌ DATABASE SAVE FAILED: " + err.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (saveText) saveText.textContent = "💾 Save Attendance to Supabase";
  }
}

// -------------------------------------------------------------
// WHATSAPP & PDF PAYSLIP GENERATION
// -------------------------------------------------------------
function shareStaffPayslipWhatsApp(index) {
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[index] || rawAttendanceData[index];
  if (!emp) return;

  const monthContext = getMonthYearContext(selectedAttendanceMonth);
  const name = emp['Employee Name'] || 'Staff';
  const empId = emp['Emp ID'] || `KS-${103 + index}`;
  const fullSalary = parseFloat(emp['Monthly Salary']) || 10000;
  const commPct = parseFloat(emp['Commission Pct']) || 1.0;
  const advance = parseFloat(emp['Advance Taken']) || 0;

  const totalSold = getStaffSalesAmount(name, empId);
  const calculatedIncentive = commPct > 0 ? Math.round(totalSold * (commPct / 100)) : 0;
  const netSalary = Math.max(0, (fullSalary + calculatedIncentive) - advance);

  let msg = `🌸 *KAILASH KALAMKARI - OFFICIAL MONTHLY PAYSLIP* 🌸\n\n`;
  msg += `🆔 *Staff ID:* ${empId}\n`;
  msg += `👤 *Staff Name:* ${name}\n`;
  msg += `📅 *Month / Period:* ${selectedAttendanceMonth}\n`;
  msg += `--------------------------------------\n`;
  msg += `💵 *Base Monthly Salary:* ₹${fullSalary.toLocaleString('en-IN')}\n`;
  msg += `🛍️ *Store Sales Achieved:* ₹${Math.round(totalSold).toLocaleString('en-IN')}\n`;
  if (calculatedIncentive > 0) msg += `🎁 *Sales Incentive (${commPct}%):* +₹${calculatedIncentive.toLocaleString('en-IN')}\n`;
  if (advance > 0) msg += `📉 *Advance Deducted:* -₹${advance.toLocaleString('en-IN')}\n`;
  msg += `--------------------------------------\n`;
  msg += `💰 *FINAL NET SALARY PAYABLE:* ₹${netSalary.toLocaleString('en-IN')}\n\n`;
  msg += `_Thank you for your valuable dedication to Kailash Kalamkari!_`;

  const phone = emp['Phone Number'] ? `91${emp['Phone Number'].replace(/\D/g, '')}` : '';
  if (phone) window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`, '_blank');
  else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function exportSingleStaffPayslipPDF(index) {
  const staffList = rawAttendanceData.filter(emp => (emp['Month_Sheet'] || '').toLowerCase() === selectedAttendanceMonth.toLowerCase());
  const emp = staffList[index] || rawAttendanceData[index];
  if (!emp || typeof html2pdf === 'undefined') return;

  const monthContext = getMonthYearContext(selectedAttendanceMonth);
  const name = emp['Employee Name'] || 'Staff Member';
  const empId = emp['Emp ID'] || `KS-${103 + index}`;
  const role = emp['Designation'] || 'Sales Executive';
  const fullSalary = parseFloat(emp['Monthly Salary']) || 10000;
  const commPct = parseFloat(emp['Commission Pct']) || 1.0;
  const advance = parseFloat(emp['Advance Taken']) || 0;

  const totalSold = getStaffSalesAmount(name, empId);
  const calculatedIncentive = commPct > 0 ? Math.round(totalSold * (commPct / 100)) : 0;
  const netSalary = Math.max(0, (fullSalary + calculatedIncentive) - advance);

  const payslipContainer = document.createElement('div');
  payslipContainer.className = "p-8 bg-[#FFFDF9] border-2 border-[#5C0612] max-w-xl mx-auto rounded-3xl font-numeric text-stone-800 space-y-4";
  payslipContainer.innerHTML = `
    <div class="text-center border-b-2 border-[#DAA520] pb-3">
      <h2 class="text-2xl font-bold font-traditional text-[#5C0612]">KAILASH KALAMKARI</h2>
      <p class="text-[10px] text-stone-600 uppercase font-semibold">Official Staff Payslip & Performance Voucher</p>
      <p class="text-[9px] text-[#DAA520] font-bold uppercase mt-0.5">${selectedAttendanceMonth}</p>
    </div>
    <div class="grid grid-cols-2 gap-4 text-xs border-b border-[#E5D5C6] pb-3">
      <div>
        <p class="text-stone-500 text-[10px]">Employee ID</p>
        <p class="font-black text-[#5C0612]">${empId}</p>
        <p class="text-stone-500 text-[10px] mt-1">Employee Name</p>
        <p class="font-bold text-stone-800">${name}</p>
      </div>
      <div class="text-right">
        <p class="text-stone-500 text-[10px]">Designation</p>
        <p class="font-bold text-stone-800">${role}</p>
      </div>
    </div>
    <div class="space-y-1.5 text-xs">
      <div class="flex justify-between py-1 border-b border-stone-200"><span>Base Monthly Salary</span><strong>₹${fullSalary.toLocaleString('en-IN')}</strong></div>
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
  html2pdf().set({ margin: 0.3, filename: `Payslip_${name}_${empId}.pdf` }).from(payslipContainer).save().then(() => {
    document.body.removeChild(payslipContainer);
  });
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
    const type = row['Sale type'];

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
        <td class="p-2 text-right text-blue-600 font-bold font-numeric">₹${Math.round(stats.online).toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-orange-600 font-bold font-numeric">₹${Math.round(stats.offline).toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-purple-600 font-bold font-numeric">₹${Math.round(stats.wholesale).toLocaleString('en-IN')}</td>
        <td class="p-2 text-right text-[#5C0612] font-black font-numeric">₹${Math.round(stats.total).toLocaleString('en-IN')}</td>
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
    const channel = row['Sale type'];
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

  setText('agent-analysis-total-revenue', `₹${Math.round(totalRevenue).toLocaleString('en-IN')}`);
  setText('agent-analysis-online-sales', `₹${Math.round(onlineSales).toLocaleString('en-IN')}`);
  setText('agent-analysis-offline-sales', `₹${Math.round(offlineSales).toLocaleString('en-IN')}`);
  setText('agent-analysis-takebyhand-sales', `₹${Math.round(tbhSales).toLocaleString('en-IN')}`);

  const productContainer = getEl('agent-analysis-product-share');
  if (productContainer) {
    const sortedProds = Object.values(productSales).sort((a, b) => b.revenue - a.revenue);
    productContainer.innerHTML = sortedProds.map(p => {
      const pct = totalRevenue > 0 ? ((p.revenue / totalRevenue) * 100).toFixed(1) : 0;
      return `
        <div class="space-y-1">
          <div class="flex justify-between items-center text-xs font-semibold text-stone-700">
            <span>${p.name} (${p.qty} sold)</span>
            <span class="font-numeric font-black text-[#5C0612]">₹${Math.round(p.revenue).toLocaleString('en-IN')} (${pct}%)</span>
          </div>
          <div class="w-full bg-[#E5D5C6]/40 h-2 rounded-full overflow-hidden">
            <div class="bg-[#DAA520] h-full rounded-full" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  const dailyContainer = getEl('agent-analysis-daily-list');
  if (dailyContainer) {
    const sortedDates = Object.keys(dailyGroup).sort((a, b) => b.localeCompare(a));
    dailyContainer.innerHTML = sortedDates.map(dateStr => `
      <div class="border border-[#E5D5C6] rounded-xl bg-[#FFFDF9] overflow-hidden warm-shadow mb-3">
        <div class="bg-[#F3EFE9] px-4 py-2.5 border-b border-[#E5D5C6] flex justify-between items-center">
          <span class="font-traditional font-bold text-stone-800 text-xs">${dateStr}</span>
          <span class="font-numeric font-black text-[#5C0612] text-xs">Day Total: ₹${Math.round(dailyGroup[dateStr].total).toLocaleString('en-IN')}</span>
        </div>
        <div class="p-3 divide-y divide-[#E5D5C6]/10">
          ${Object.entries(dailyGroup[dateStr].bills).map(([bNo, bData]) => `
            <div class="flex justify-between items-center py-1 text-xs">
              <span>Bill No: <strong>${bNo}</strong></span>
              <strong class="text-[#5C0612] font-numeric">₹${Math.round(bData.total).toLocaleString('en-IN')}</strong>
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
    return row['Sale type'] === channel;
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

  setText('channel-view-total', `₹${totalChannelRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  const agentTable = getEl('channel-agents-table');
  if (agentTable) {
    const sortedA = Object.entries(agentsObj).sort((a, b) => b[1] - a[1]);
    agentTable.innerHTML = sortedA.length === 0 ? `<tr><td colspan="2" class="p-4 text-center text-stone-400">No staff sales for ${channel}</td></tr>` : sortedA.map(([aName, amt]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700 font-sans">${aName}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${Math.round(amt).toLocaleString('en-IN')}</td>
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
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${Math.round(pObj.revenue).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

// -------------------------------------------------------------
// SPA NAVIGATION & TAB SWITCHER
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
  if (!isAdmin) {
    alert("🔒 Access Denied: Only Admin can update monthly target.");
    return;
  }
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
    filename: `${titleFilename}_${formatToYYYYMMDD(new Date())}.pdf`, 
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
// BOOTSTRAP INITIALIZATION
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