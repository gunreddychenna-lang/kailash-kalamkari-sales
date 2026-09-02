/**
 * =========================================================================
 * KAILASH KALAMKARI - MULTI-ROLE EXECUTIVE PORTAL CLIENT ENGINE (app.js)
 * Enterprise-grade client script with multi-date format detection,
 * automatic date range calibration, split-bill tracking, and payroll engine.
 * =========================================================================
 */

const API_URL = "https://script.google.com/macros/s/AKfycbwSdvj2seF5EV9onv1GeirtNHBvh2A6r8RJlu1krcNOhXMY92UXWeZduiqUDpbrcG_q/exec";
const SESSION_TIMEOUT = 6 * 60 * 60 * 1000; // 6 Hours

// RBAC & User Session Context
let currentRole = 'Admin'; // 'Admin' | 'Cashier' | 'SalesGirl'
let currentUserId = '';
let currentEmployeeId = '';
let currentDisplayName = '';
let isAdmin = false;
let isCashier = false;
let isSalesGirl = false;

// Global Data Sets
let rawData = [];
let rawAttendanceData = [];
let bankAccountsList = [];
let staffDirectory = [];
let productsList = [];
let agentsList = [];
let selectedAgentDetail = null;

// Multi-Split Payment Tracking Maps
let globalBillSplitsMap = {}; 
let globalBillBankMap = {};
let agentBillsViewMode = 'summary'; // 'summary' | 'detailed'
let currentSelectedBillData = null;

// Cashier POS State
let activePosMode = "Cash";
let activePosBank = "Cash";
let cashierShiftRecords = [];

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
let prodSortCol = 'qty', prodSortAsc = false;
let agentSortCol = 'revenue', agentSortAsc = false;

// SPA Routing State
if (history.state === null) history.replaceState({ view: 'home' }, '');
window.addEventListener('popstate', e => applyState(e.state, true));

// -------------------------------------------------------------
// SAFE DOM MANIPULATION HELPERS
// -------------------------------------------------------------
function getEl(id) {
  return document.getElementById(id);
}

function showEl(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideEl(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// -------------------------------------------------------------
// PDF EXPORT UTILITY
// -------------------------------------------------------------
function exportSectionToPDF(elementId, titleFilename) {
  const element = getEl(elementId);
  if (!element || typeof html2pdf === 'undefined') {
    alert("PDF Engine is loading or view element was not found.");
    return;
  }
  const actionBtns = element.querySelectorAll('.export-ignore');
  actionBtns.forEach(btn => btn.style.display = 'none');

  const opt = {
    margin: 0.3,
    filename: `${titleFilename}_${new Date().toISOString().split('T')[0]}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    actionBtns.forEach(btn => btn.style.display = '');
  }).catch(err => {
    console.error("PDF Export error:", err);
    actionBtns.forEach(btn => btn.style.display = '');
  });
}

// -------------------------------------------------------------
// COMPREHENSIVE DATA PARSING & NORMALIZATION UTILITIES
// -------------------------------------------------------------
function normalizeToDateString(dateVal) {
  if (!dateVal) return '';
  let strVal = dateVal.toString().trim();
  if (!strVal) return '';

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) return strVal;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = strVal.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = String(dmyMatch[1]).padStart(2, '0');
    const month = String(dmyMatch[2]).padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // DD-MMM-YYYY (e.g. 05-Jul-2026 or 5-July-2026)
  const dMmmYyyyMatch = strVal.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{4})/);
  if (dMmmYyyyMatch) {
    const day = String(dMmmYyyyMatch[1]).padStart(2, '0');
    const monthStr = dMmmYyyyMatch[2].substring(0, 3).toLowerCase();
    const year = dMmmYyyyMatch[3];
    const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    if (months[monthStr]) {
      return `${year}-${months[monthStr]}-${day}`;
    }
  }

  const parsed = new Date(strVal);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return strVal.split('T')[0];
}

function getRowAmount(row) {
  if (!row || typeof row !== 'object') return 0;
  const directKeys = [
    'Final Amount', 'FinalAmount', 'Total Value', 'TotalValue', 
    'BillAmount', 'Bill Amount', 'Amount', 'Net Value', 'Net Invoice Value', 
    'NetValue', 'Gross Value', 'Total', 'Invoice Value', 'Bill_Amount', 'Sale Amount'
  ];
  for (let k of directKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const parsed = parseFloat(row[k].toString().replace(/[^0-9.-]+/g, ""));
      if (!isNaN(parsed)) return parsed;
    }
  }

  for (let key in row) {
    const cleanKey = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['finalamount', 'totalvalue', 'billamount', 'amount', 'netvalue', 'netinvoicevalue', 'total', 'saleamount'].includes(cleanKey)) {
      const parsed = parseFloat((row[key] || '0').toString().replace(/[^0-9.-]+/g, ""));
      if (!isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function getBillNo(row) {
  if (!row || typeof row !== 'object') return 'N/A';
  
  const directKeys = [
    'Bil No', 'Bil No.', 'BilNo', 'Bill No', 'Bill No.', 'BillNo', 
    'Invoice No', 'Invoice No.', 'InvoiceNo', 'Bill #', 'Invoice #', 'Bill Number', 
    'Invoice Number', 'Doc No', 'Voucher No', 'Ref No', 'Bill_No', 'Invoice_No', 'Invoice_No.'
  ];
  for (let k of directKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const val = row[k].toString().trim();
      if (val && val !== '0' && !val.includes('T') && !val.includes('Z') && val.toLowerCase() !== 'null' && val.toLowerCase() !== 'undefined') {
        return val;
      }
    }
  }

  for (let key in row) {
    const cleanKey = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['bilno', 'billno', 'billnum', 'billnumber', 'invoiceno', 'invoicenumber', 'docno', 'voucherno', 'refno', 'billcode'].includes(cleanKey)) {
      const val = (row[key] || '').toString().trim();
      if (val && val !== '0' && !val.includes('T') && !val.includes('Z') && val.toLowerCase() !== 'null' && val.toLowerCase() !== 'undefined') {
        return val;
      }
    }
  }
  return 'N/A';
}

function getRowBankDirect(row) {
  if (!row || typeof row !== 'object') return 'Not Defined';
  const ignoreKeywords = ['split payment', 'split', 'payment', 'not defined', 'not found', 'null', 'undefined', '-', '--', '0'];

  const priorityKeys = [
    'Acc No', 'Acc No.', 'AccNo', 'Acc_No', 'A/c No', 'A/c No.', 'A/C No', 'A/C No.',
    'Ac No', 'Ac No.', 'Account No', 'Account No.', 'AccountNo', 'Account_No',
    'Bank', 'Bank Name', 'BankName', 'Bank_Name', 'Bank A/c', 'Bank A/c.', 
    'Bank Account', 'Credited Bank', 'Credited Bank Name', 'Deposit Bank'
  ];

  for (let k of priorityKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const val = row[k].toString().trim();
      if (val && !ignoreKeywords.includes(val.toLowerCase())) {
        return val;
      }
    }
  }

  const secondaryKeys = ['Account Name', 'AccountName', 'Acc Name', 'AccName', 'Account Name.', 'Account', 'Bank Details'];
  for (let k of secondaryKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const val = row[k].toString().trim();
      if (val && !ignoreKeywords.includes(val.toLowerCase())) {
        return val;
      }
    }
  }

  return 'Not Defined';
}

function registerBillSplit(billNo, bankName, splitAmount, payMode) {
  if (!billNo || billNo === 'N/A') return;
  const bKey = billNo.toString().trim();
  const cleanKey = bKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bank = (bankName || 'Not Defined').toString().trim();
  const amt = parseFloat(splitAmount) || 0;

  const splitEntry = {
    bank: bank,
    amount: amt,
    mode: payMode || bank
  };

  if (!globalBillSplitsMap[bKey]) globalBillSplitsMap[bKey] = [];
  globalBillSplitsMap[bKey].push(splitEntry);

  if (cleanKey !== bKey) {
    if (!globalBillSplitsMap[cleanKey]) globalBillSplitsMap[cleanKey] = [];
    globalBillSplitsMap[cleanKey].push(splitEntry);
  }

  globalBillBankMap[bKey] = bank;
  globalBillBankMap[cleanKey] = bank;
}

function getBillSplits(billNo) {
  if (!billNo || billNo === 'N/A') return [];
  const bKey = billNo.toString().trim();
  const cleanKey = bKey.toLowerCase().replace(/[^a-z0-9]/g, '');
  return globalBillSplitsMap[bKey] || globalBillSplitsMap[cleanKey] || [];
}

function getRowBank(row) {
  if (!row || typeof row !== 'object') return 'Not Defined';
  const directVal = getRowBankDirect(row);
  if (directVal !== 'Not Defined') return directVal;

  const bNo = getBillNo(row);
  if (bNo && bNo !== 'N/A') {
    if (globalBillBankMap[bNo]) return globalBillBankMap[bNo];
    const cleanKey = bNo.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (globalBillBankMap[cleanKey]) return globalBillBankMap[cleanKey];
  }
  return 'Not Defined';
}

function getSalesType(payMode) {
  if (!payMode) return 'Offline';
  const pm = payMode.toString().toLowerCase().trim();
  if (pm.includes('onl') || pm.includes('online') || pm.includes('web')) return 'Online';
  if (pm.includes('by hand') || pm.includes('hand') || pm.includes('wholesale') || pm.includes('take by hand') || pm.includes('takebyhand') || pm.includes('tbh')) return 'Wholesale';
  return 'Offline';
}

function getItemCategory(itemName) {
  if (!itemName) return 'General';
  const name = itemName.toString().toLowerCase();
  if (name.includes('frame') || name.includes('painting') || name.includes('art') || name.includes('photo') || name.includes('wall') || name.includes('canvas') || name.includes('wood') || name.includes('chitra') || name.includes('picchwai') || name.includes('glass')) return 'Frames';
  if (name.includes('saree') || name.includes('sari') || name.includes('silk') || name.includes('pattu') || name.includes('kanchi') || name.includes('tussar') || name.includes('soft') || name.includes('organza') || name.includes('georgette') || name.includes('kota') || name.includes('linen') || name.includes('handloom') || name.includes('chanderi')) return 'Sarees';
  if (name.includes('fabric') || name.includes('meter') || name.includes('running') || name.includes('print') || name.includes('blouse') || name.includes('material') || name.includes('cotton') || name.includes('dupatta') || name.includes('stole') || name.includes('dress') || name.includes('suit') || name.includes('kurti')) return 'Fabrics';
  return 'General';
}

function getDayValue(emp, d) {
  if (!emp || typeof emp !== 'object') return '';
  const dStr = d.toString();
  const dPad = d < 10 ? '0' + d : dStr;
  const possibleKeys = [dStr, dPad, 'D' + dStr, 'D' + dPad, 'Day ' + dStr, 'Day' + dStr, 'Day ' + dPad];

  for (let key of possibleKeys) {
    if (emp[key] !== undefined && emp[key] !== null && emp[key] !== '') {
      return emp[key].toString().trim();
    }
  }

  for (let key in emp) {
    const cleanK = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanK === dStr || cleanK === dPad || cleanK === 'd' + dStr || cleanK === 'day' + dStr) {
      const val = (emp[key] || '').toString().trim();
      if (val) return val;
    }
  }
  return '';
}

function getDayNote(emp, d) {
  const notesMap = emp['_notes'] || {};
  const dStr = d.toString();
  const dPad = d < 10 ? '0' + d : dStr;
  const possibleKeys = [dStr, dPad, 'D' + dStr, 'D' + dPad, 'Day ' + dStr, 'Day' + dPad];

  for (let key of possibleKeys) {
    if (notesMap[key]) return notesMap[key].toString().trim();
  }
  return '';
}

function getEmpProp(emp, targetKeys) {
  if (!emp || typeof emp !== 'object') return "";
  const empKeys = Object.keys(emp);
  for (let target of targetKeys) {
    const cleanTarget = target.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let k of empKeys) {
      if (k.toString().toLowerCase().replace(/[^a-z0-9]/g, '') === cleanTarget && emp[k] !== undefined && emp[k] !== null && emp[k] !== "") {
        return emp[k].toString().trim();
      }
    }
  }
  return "";
}

function formatPhoneForWhatsApp(phoneRaw) {
  if (!phoneRaw) return "";
  let digits = phoneRaw.toString().replace(/\D/g, '');
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

// -------------------------------------------------------------
// AUTHENTICATION & SECURE POST DATA SYNC
// -------------------------------------------------------------
function checkSession() {
  const savedUser = localStorage.getItem('kk_user');
  const savedPass = localStorage.getItem('kk_pass');
  const savedRole = localStorage.getItem('kk_role');
  const savedEmpId = localStorage.getItem('kk_emp_id');
  const savedDisplayName = localStorage.getItem('kk_display_name');
  const loginTime = localStorage.getItem('kk_login_time');

  if (!savedUser || !savedPass || !loginTime) return { valid: false };
  if (Date.now() - parseInt(loginTime, 10) > SESSION_TIMEOUT) {
    localStorage.clear();
    return { valid: false };
  }

  currentRole = savedRole || 'Admin';
  currentUserId = savedUser;
  currentEmployeeId = savedEmpId || savedUser;
  currentDisplayName = savedDisplayName || savedUser;

  isAdmin = currentRole === 'Admin' || currentUserId.toLowerCase() === 'admin';
  isCashier = currentRole === 'Cashier';
  isSalesGirl = currentRole === 'SalesGirl';

  return { valid: true, user: savedUser, pass: savedPass, role: currentRole, empId: currentEmployeeId };
}

function handleLogout() {
  localStorage.clear();
  location.reload();
}

async function fetchData(user, pass) {
  const cleanUser = (user || '').trim().toLowerCase();
  const cleanPass = (pass || '').trim();

  showEl('loader');
  hideEl('standard-main');
  hideEl('cashier-view');
  hideEl('agent-view');
  hideEl('login-screen');

  try {
    globalBillSplitsMap = {};
    globalBillBankMap = {};

    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'fetch_all',
        username: cleanUser,
        password: cleanPass
      })
    });

    if (!response.ok) throw new Error(`Server status ${response.status}`);
    const data = await response.json();

    if (data && data.error) {
      showLoginError(data.error);
      return;
    }

    currentRole = data.role || (cleanUser === 'admin' ? 'Admin' : 'SalesGirl');
    currentEmployeeId = data.employee_id || cleanUser;
    currentDisplayName = data.displayName || cleanUser;
    currentUserId = cleanUser;

    isAdmin = currentRole === 'Admin' || cleanUser === 'admin';
    isCashier = currentRole === 'Cashier';
    isSalesGirl = currentRole === 'SalesGirl';

    localStorage.setItem('kk_user', cleanUser);
    localStorage.setItem('kk_pass', cleanPass);
    localStorage.setItem('kk_role', currentRole);
    localStorage.setItem('kk_emp_id', currentEmployeeId);
    localStorage.setItem('kk_display_name', currentDisplayName);
    localStorage.setItem('kk_login_time', Date.now().toString());

    rawData = [];
    rawAttendanceData = [];
    bankAccountsList = Array.isArray(data.banks) ? data.banks : ['Cash', '42441-TJ', 'KC'];
    staffDirectory = Array.isArray(data.staffDirectory) ? data.staffDirectory : [];

    if (Array.isArray(data)) {
      rawData = data;
    } else if (data.sales) {
      if (Array.isArray(data.sales)) {
        rawData = data.sales;
      } else if (typeof data.sales === 'object') {
        Object.keys(data.sales).forEach(tabName => {
          if (Array.isArray(data.sales[tabName])) {
            data.sales[tabName].forEach(row => {
              if (!row['Store'] && !row['Shop']) row['Store'] = tabName;
              rawData.push(row);
            });
          }
        });
      }
      rawAttendanceData = Array.isArray(data.attendance) ? data.attendance : [];
    }

    const receivablesSource = data.receivables || data.recievables || [];
    if (Array.isArray(receivablesSource)) {
      receivablesSource.forEach(r => {
        const bNo = getBillNo(r);
        const bnk = getRowBankDirect(r);
        const splitAmt = getRowAmount(r);
        const pMode = r['Acc No'] || r['Account Name'] || r['PayMode'] || bnk;

        if (bNo && bNo !== 'N/A') {
          registerBillSplit(bNo, bnk, splitAmt, pMode);
        }
      });
    }

    const targetEl = getEl('target-input-field');
    if (targetEl) targetEl.value = monthlyTarget;

    updateHeaderRoleBadges();
    routeUserToRolePrimaryDashboard();

  } catch (error) {
    console.error("Fetch Data Error:", error);
    showLoginError("Connection failed. Please check your credentials or network.");
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
  showEl('login-btn-text');
  hideEl('login-btn-spinner');
}

function updateHeaderRoleBadges() {
  const badge = getEl('user-role-badge');
  const nameEl = getEl('user-display-name');

  if (badge) {
    badge.textContent = currentRole.toUpperCase();
    if (isAdmin) badge.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-[#DAA520] text-[#5C0612] tracking-wider font-sans";
    else if (isCashier) badge.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-400 text-emerald-950 tracking-wider font-sans";
    else badge.className = "text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-400 text-blue-950 tracking-wider font-sans";
  }

  if (nameEl) nameEl.textContent = `${currentDisplayName} (${currentEmployeeId})`;

  document.querySelectorAll('.admin-only, .role-admin-only').forEach(el => {
    if (isAdmin) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });

  if (!isAdmin && getEl('attendance-tab') && !getEl('attendance-tab').classList.contains('hidden')) {
    switchTab('products-tab');
  }
}

function routeUserToRolePrimaryDashboard() {
  showEl('standard-header');
  hideEl('login-screen');
  hideEl('loader');

  if (isCashier) {
    showEl('cashier-view');
    hideEl('standard-main');
    hideEl('agent-view');
    initCashierWorkspace();
  } else if (isSalesGirl) {
    showEl('agent-view');
    hideEl('standard-main');
    hideEl('cashier-view');
    initAgentWorkspace();
  } else {
    showEl('standard-main');
    hideEl('cashier-view');
    hideEl('agent-view');
    detectDateRanges();
    detectAndPopulateStores();
    populateBankDropdown();
    populateAttendanceMonthDropdown();
    populateBillsDatalist();
    processData();
    applyState(history.state || { view: 'home' }, true);
  }
}

// -------------------------------------------------------------
// FILTER POPULATION & METADATA DETECTION
// -------------------------------------------------------------
function detectAndPopulateStores() {
  const storeSelect = getEl('store-filter');
  if (!storeSelect) return;
  const storeSet = new Set();
  rawData.forEach(row => {
    const sName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || '').toString().trim();
    if (sName) storeSet.add(sName);
  });
  const currentSelection = storeSelect.value || 'All';
  storeSelect.innerHTML = `<option value="All">All Branches / Stores</option>`;
  storeSet.forEach(sName => {
    storeSelect.innerHTML += `<option value="${sName}">${sName}</option>`;
  });
  storeSelect.value = currentSelection;
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

  const bankSet = new Set();
  ['Cash', '42441-TJ', 'KC'].forEach(bk => bankSet.add(bk));
  
  bankAccountsList.forEach(bk => {
    const bStr = (bk || '').toString().trim();
    if (bStr && bStr !== 'Not Defined') bankSet.add(bStr);
  });

  rawData.forEach(row => {
    const bName = getRowBank(row);
    if (bName && bName !== 'Not Defined') bankSet.add(bName);
  });

  Object.values(globalBillBankMap).forEach(bName => {
    if (bName && bName !== 'Not Defined') bankSet.add(bName);
  });

  const currentSelection = bSelect.value || 'All';
  bSelect.innerHTML = `<option value="All">All Bank Accounts</option>`;
  bankSet.forEach(bk => {
    bSelect.innerHTML += `<option value="${bk}">${bk}</option>`;
  });

  bSelect.value = bankSet.has(currentSelection) ? currentSelection : 'All';
}

function populateAttendanceMonthDropdown() {
  const mSelect = getEl('attendance-month-select');
  if (!mSelect) return;

  const monthSet = new Set();
  if (Array.isArray(rawAttendanceData)) {
    rawAttendanceData.forEach(emp => {
      const mStr = (emp['Month_Sheet'] || emp['Month'] || '').toString().trim();
      if (mStr) monthSet.add(mStr);
    });
  }

  const monthList = Array.from(monthSet);
  if (monthList.length === 0) {
    mSelect.innerHTML = `<option value="All">All Months (Combined)</option>`;
    return;
  }

  let optionsHTML = `<option value="All">All Months (Combined)</option>`;
  monthList.forEach(m => {
    optionsHTML += `<option value="${m}">${m}</option>`;
  });

  mSelect.innerHTML = optionsHTML;

  if (selectedAttendanceMonth === 'All') {
    const curMonthName = new Date().toLocaleString('en-US', { month: 'short' }).toLowerCase();
    let matchedSheet = monthList.find(m => m.toLowerCase() === 'attendance') || 
                       monthList.find(m => m.toLowerCase().includes(curMonthName)) || 
                       monthList[monthList.length - 1];
    if (matchedSheet) {
      selectedAttendanceMonth = matchedSheet;
    }
  }

  mSelect.value = selectedAttendanceMonth;
}

// -------------------------------------------------------------
// SPA NAVIGATION & STATE MANAGEMENT
// -------------------------------------------------------------
function applyState(state, isPopState = false) {
  if (!state) state = { view: 'home' };
  const session = checkSession();
  if (!session.valid) {
    hideEl('standard-header');
    hideEl('standard-main');
    hideEl('cashier-view');
    hideEl('agent-view');
    hideEl('channel-view');
    hideEl('weekly-view');
    hideEl('agent-analysis-view');
    showEl('login-screen');
    hideEl('loader');
    return;
  }

  if (state.view === 'weekly' && !isAdmin) {
    applyState({ view: 'home' }, true);
    return;
  }

  hideEl('agent-detail-card');
  hideEl('product-detail-card');

  showEl('standard-header');
  hideEl('standard-main');
  hideEl('channel-view');
  hideEl('weekly-view');
  hideEl('agent-analysis-view');

  if (state.view === 'home') {
    selectedChannel = 'All';
    showEl('standard-main');
    if (state.detail === 'agent') {
      selectedAgentDetail = state.name;
      if (populateAgentDetailsDOM(state.name)) {
        showEl('agent-detail-card');
      }
    } else if (state.detail === 'product') {
      populateProductDetailsDOM(state.name, false);
      showEl('product-detail-card');
    }
  } else if (state.view === 'channel') {
    selectedChannel = state.channel;
    showEl('channel-view');
    populateChannelScreenDOM(state.channel);
  } else if (state.view === 'weekly') {
    showEl('weekly-view');
    populateWeeklyScreenDOM();
  } else if (state.view === 'agent-analysis') {
    showEl('agent-analysis-view');
    populateAgentAnalysisScreenDOM(state.name);
  }

  if (!isPopState) history.pushState(state, '');
}

function detectDateRanges() {
  if (!rawData || rawData.length === 0) return;
  
  const allDates = rawData
    .map(row => normalizeToDateString(row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate']))
    .filter(Boolean)
    .sort();

  const fromEl = getEl('from-date');
  const toEl = getEl('to-date');

  if (allDates.length > 0) {
    // Automatically set from earliest date in dataset to latest date
    if (fromEl) fromEl.value = allDates[0];
    if (toEl) toEl.value = allDates[allDates.length - 1];
  } else {
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
  }
}

function setQuickDateRange(preset) {
  if (rawData.length === 0) return;
  const allDates = rawData
    .map(row => normalizeToDateString(row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate']))
    .filter(Boolean)
    .sort();
    
  const maxDateStr = allDates[allDates.length - 1] || new Date().toISOString().split('T')[0];
  const refDate = new Date(maxDateStr);

  const yyyy = refDate.getFullYear();
  const mm = String(refDate.getMonth() + 1).padStart(2, '0');
  const dd = String(refDate.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  let fromDate = todayStr, toDate = todayStr;

  if (preset === 'today') {
    fromDate = todayStr;
    toDate = todayStr;
  } else if (preset === 'yesterday') {
    const yest = new Date(refDate);
    yest.setDate(refDate.getDate() - 1);
    fromDate = normalizeToDateString(yest);
    toDate = fromDate;
  } else if (preset === 'week') {
    const day = refDate.getDay();
    const diff = refDate.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(refDate);
    startOfWeek.setDate(diff);
    fromDate = normalizeToDateString(startOfWeek);
    toDate = todayStr;
  } else if (preset === 'month') {
    fromDate = `${yyyy}-${mm}-01`;
    toDate = todayStr;
  } else if (preset === 'lastmonth') {
    const prevMonth = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1);
    const lastDayPrevMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 0);
    fromDate = normalizeToDateString(prevMonth);
    toDate = normalizeToDateString(lastDayPrevMonth);
  }

  const fromEl = getEl('from-date');
  const toEl = getEl('to-date');
  if (fromEl) fromEl.value = fromDate;
  if (toEl) toEl.value = toDate;
  processData();
}

function selectChannel(channel) {
  if (channel === 'All') {
    applyState({ view: 'home' });
    processData();
    return;
  }
  applyState({ view: 'channel', channel: channel });
}

function updateMonthlyTarget(val) {
  if (!isAdmin) return;
  monthlyTarget = parseFloat(val) || 0;
  localStorage.setItem('kk_monthly_target', monthlyTarget.toString());
  processData();
}

function getStaffSalesAmount(empName) {
  if (!empName) return 0;
  const cleanEmp = empName.toString().toLowerCase().replace(/\s+/g, '').trim();
  let match = agentsList.find(a => (a.name || '').toString().toLowerCase().replace(/\s+/g, '').trim() === cleanEmp);
  if (match) return match.revenue;
  match = agentsList.find(a => {
    const cleanAgent = (a.name || '').toString().toLowerCase().replace(/\s+/g, '').trim();
    return cleanAgent && (cleanEmp.includes(cleanAgent) || cleanAgent.includes(cleanEmp));
  });
  return match ? match.revenue : 0;
}

// -------------------------------------------------------------
// CORE METRICS & ANALYTICS COMPUTATION ENGINE
// -------------------------------------------------------------
function processData() {
  const fromDate = getEl('from-date') ? getEl('from-date').value : '';
  const toDate = getEl('to-date') ? getEl('to-date').value : '';
  const searchVal = getEl('product-search') ? getEl('product-search').value.toLowerCase() : '';
  
  const storeSelectEl = getEl('store-filter');
  selectedStore = storeSelectEl ? storeSelectEl.value : 'All';

  let storeTotals = {};
  let accountTotals = {}; 

  // 1. Calculate store totals across date range
  rawData.forEach(row => {
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    const rDate = normalizeToDateString(rawDate);
    let dateMatch = true;
    if (fromDate && rDate) dateMatch = dateMatch && (rDate >= fromDate);
    if (toDate && rDate) dateMatch = dateMatch && (rDate <= toDate);

    if (dateMatch) {
      const amount = getRowAmount(row);
      const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Main Branch').toString().trim();
      storeTotals[storeName] = (storeTotals[storeName] || 0) + amount;
    }
  });

  // 2. Filter raw rows based on date & store selection
  const filtered = rawData.filter(row => {
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    const rDate = normalizeToDateString(rawDate);
    
    let match = true;
    if (fromDate && rDate) match = match && (rDate >= fromDate);
    if (toDate && rDate) match = match && (rDate <= toDate);
    
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Main Branch').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) match = false;
    return match;
  });

  let totalSales = 0, totalOnline = 0, totalOffline = 0, totalWholesale = 0, totalUnits = 0;
  let payUpiStore = 0, payUpiOnline = 0, payCash = 0, payCard = 0, payHand = 0;
  let bucketSmall = 0, bucketMedium = 0, bucketHigh = 0;

  const uniqueBills = new Set();
  const billTotalObj = {};
  const dailyTotalObj = {};
  currentDaySales = [0, 0, 0, 0, 0, 0, 0];

  const productsObj = {};
  const agentsObj = {};
  const dayWiseObj = {}; 

  filtered.forEach(row => {
    const amount = getRowAmount(row);
    const qty = parseInt(row['Qty'] || row['QTY'] || row['Quantity'] || 1) || 1;
    const item = (row['Item Name'] || row['ItemName'] || row['Item'] || row['Product'] || 'General Item').toString().trim();
    const agent = (row['SM Name'] || row['SMName'] || row['Agent'] || row['Staff Name'] || row['Sales Staff'] || 'No Agent').toString().trim();
    const payMode = row['PayMode'] || row['Pay Mode'] || row['Paymode'] || row['Sale type'] || row['Sale Type'] || row['Saletype'] || '';
    
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    const billDate = normalizeToDateString(rawDate);
    const billNo = getBillNo(row);
    const type = getSalesType(payMode);

    totalSales += amount;
    totalUnits += qty;

    const splits = getBillSplits(billNo);

    if (splits.length > 0) {
      const splitSum = splits.reduce((sum, s) => sum + (s.amount > 0 ? s.amount : 0), 0);

      splits.forEach(s => {
        const sAmt = (s.amount > 0 && splitSum > 0) 
          ? (splitSum === amount ? s.amount : (s.amount / splitSum) * amount)
          : (amount / splits.length);

        const sBank = s.bank || 'Not Defined';
        const sModeStr = (s.mode || s.bank || '').toString().toLowerCase();

        if (sBank && sBank !== 'Not Defined') {
          accountTotals[sBank] = (accountTotals[sBank] || 0) + sAmt;
        }

        if (sModeStr.includes('cash')) {
          payCash += sAmt;
        } else if (sModeStr.includes('card')) {
          payCard += sAmt;
        } else if (sModeStr.includes('hand') || sModeStr.includes('wholesale') || sModeStr.includes('tbh')) {
          payHand += sAmt;
        } else if (sModeStr.includes('onl') || sModeStr.includes('online')) {
          payUpiOnline += sAmt;
        } else if (sModeStr.includes('store') || sModeStr.includes('counter')) {
          payUpiStore += sAmt;
        } else {
          if (type === 'Online') payUpiOnline += sAmt;
          else payUpiStore += sAmt;
        }
      });
    } else {
      const bankAcc = getRowBank(row);
      if (bankAcc && bankAcc !== 'Not Defined') {
        accountTotals[bankAcc] = (accountTotals[bankAcc] || 0) + amount;
      }

      const cleanPm = payMode.toString().toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      if (cleanPm.includes('cash')) payCash += amount;
      else if (cleanPm.includes('card')) payCard += amount;
      else if (cleanPm.includes('hand') || cleanPm.includes('wholesale') || cleanPm.includes('takebyhand') || cleanPm.includes('tbh')) payHand += amount;
      else if (cleanPm.includes('onl') || cleanPm.includes('online')) payUpiOnline += amount;
      else if (cleanPm.includes('store') || cleanPm.includes('counter') || cleanPm.includes('shop')) payUpiStore += amount;
      else if (cleanPm.includes('upi') || cleanPm.includes('gpay') || cleanPm.includes('phonepe')) {
        if (type === 'Online') payUpiOnline += amount;
        else payUpiStore += amount;
      } else {
        if (type === 'Online') payUpiOnline += amount;
        else payCash += amount;
      }
    }

    if (type === 'Online') totalOnline += amount;
    else if (type === 'Wholesale') totalWholesale += amount;
    else totalOffline += amount;

    const billKey = billNo !== 'N/A' ? billNo : `${billDate}-${amount}`;
    uniqueBills.add(billKey);
    billTotalObj[billKey] = (billTotalObj[billKey] || 0) + amount;

    if (billDate) {
      dailyTotalObj[billDate] = (dailyTotalObj[billDate] || 0) + amount;
      const parts = billDate.split('-').map(Number);
      if (parts.length === 3) {
        const dayOfWeek = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
        if (!isNaN(dayOfWeek)) currentDaySales[dayOfWeek] += amount;
      }

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

    const displayBankStr = splits.length > 0 
      ? splits.map(s => `${s.bank}: ₹${s.amount.toLocaleString('en-IN')}`).join(', ')
      : getRowBank(row);

    if (!agentsObj[agent].bills[billKey]) {
      agentsObj[agent].bills[billKey] = { billNo: billNo, date: billDate, amount: 0, bank: displayBankStr };
    }
    agentsObj[agent].bills[billKey].amount += amount;
  });

  Object.values(billTotalObj).forEach(val => {
    if (val < 10000) bucketSmall++;
    else if (val <= 100000) bucketMedium++;
    else bucketHigh++;
  });

  let peakDate = "N/A", peakVal = 0;
  Object.entries(dailyTotalObj).forEach(([d, val]) => {
    if (val > peakVal) { peakVal = val; peakDate = d; }
  });

  setText('metric-total', `₹${totalSales.toLocaleString('en-IN')}`);
  setText('metric-online', `₹${totalOnline.toLocaleString('en-IN')}`);
  setText('metric-offline', `₹${totalOffline.toLocaleString('en-IN')}`);
  setText('metric-wholesale', `₹${totalWholesale.toLocaleString('en-IN')}`);

  const storeBreakdownContainer = getEl('store-breakdown-container');
  if (storeBreakdownContainer) {
    const storeNames = Object.keys(storeTotals);
    if (storeNames.length <= 1) {
      storeBreakdownContainer.innerHTML = '';
    } else {
      const colors = [
        { border: 'border-amber-400', badge: 'bg-amber-600 text-stone-800', text: 'text-stone-800' },
        { border: 'border-indigo-400', badge: 'bg-indigo-600 text-[#5C0612]', text: 'text-[#5C0612]' }
      ];
      storeBreakdownContainer.innerHTML = storeNames.map((sName, idx) => {
        const style = colors[idx % colors.length];
        const isSelected = selectedStore === sName;
        return `
          <div onclick="selectStoreFilter('${sName}')" class="bg-[#FFFDF9] p-4 rounded-2xl border ${isSelected ? 'border-[#5C0612] ring-2 ring-[#5C0612]' : style.border} warm-shadow cursor-pointer transition-all hover:scale-[1.01]">
            <p class="text-[9px] font-bold text-stone-500 uppercase tracking-wider flex items-center justify-between font-traditional">
              <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${style.badge.split(' ')[0]} inline-block"></span> ${sName}</span>
              <span class="text-[8px] text-[#5C0612] font-bold uppercase">${isSelected ? 'Active Filter' : 'Click to Filter →'}</span>
            </p>
            <p class="text-lg sm:text-2xl font-black ${style.text} mt-2 font-numeric">₹${storeTotals[sName].toLocaleString('en-IN')}</p>
          </div>
        `;
      }).join('');
    }
  }

  const accContainer = getEl('account-split-container');
  if (accContainer) {
    const accEntries = Object.entries(accountTotals).filter(([_, amt]) => amt > 0);
    accContainer.innerHTML = accEntries.length === 0 ? `
      <div class="bg-stone-50 p-2 rounded-xl border border-stone-200 col-span-2 sm:col-span-3">
        <span class="block text-[8px] font-bold text-stone-500 uppercase">General Credit</span>
        <strong class="text-stone-800 text-xs font-numeric">₹${totalSales.toLocaleString('en-IN')}</strong>
      </div>` : accEntries.map(([accName, val]) => `
      <div class="bg-[#FAF6EE] p-2 rounded-xl border border-[#E5D5C6]">
        <span class="block text-[8px] font-bold text-stone-600 uppercase font-traditional truncate">${accName}</span>
        <strong class="text-[#5C0612] text-xs font-black font-numeric">₹${Math.round(val).toLocaleString('en-IN')}</strong>
      </div>
    `).join('');
  }

  const asp = totalUnits > 0 ? (totalSales / totalUnits) : 0;
  const digitalAmount = payUpiStore + payUpiOnline + payCard;
  const digitalPct = totalSales > 0 ? ((digitalAmount / totalSales) * 100).toFixed(0) : 0;

  setText('metric-asp', `₹${Math.round(asp).toLocaleString('en-IN')}`);
  setText('metric-digital-pct', `${digitalPct}% Digital`);

  const targetPct = monthlyTarget > 0 ? Math.min(100, (totalSales / monthlyTarget) * 100) : 0;
  setText('target-percent-text', `${targetPct.toFixed(1)}%`);
  const progBar = getEl('target-progress-bar');
  if (progBar) progBar.style.width = `${targetPct}%`;
  setText('target-achieved-text', `₹${totalSales.toLocaleString('en-IN')}`);

  const daysCount = Object.keys(dailyTotalObj).length || 1;
  const avgDailySales = totalSales / daysCount;
  const projectedMonthSales = Math.round(avgDailySales * 30);
  const forecastEl = getEl('target-forecast-text');
  if (forecastEl) {
    forecastEl.innerHTML = monthlyTarget > 0 ? `Pacing: <strong class="text-stone-800">₹${Math.round(avgDailySales).toLocaleString('en-IN')}/day</strong> • Projected: <strong class="text-[#5C0612]">₹${projectedMonthSales.toLocaleString('en-IN')}</strong> (${((projectedMonthSales / monthlyTarget) * 100).toFixed(0)}%)` : `Daily Average: <strong>₹${Math.round(avgDailySales).toLocaleString('en-IN')}/day</strong>`;
  }

  setText('paymode-upi-store', `₹${Math.round(payUpiStore).toLocaleString('en-IN')}`);
  setText('paymode-upi-onl', `₹${Math.round(payUpiOnline).toLocaleString('en-IN')}`);
  setText('paymode-cash', `₹${Math.round(payCash).toLocaleString('en-IN')}`);
  setText('paymode-card', `₹${Math.round(payCard).toLocaleString('en-IN')}`);
  setText('paymode-hand', `₹${Math.round(payHand).toLocaleString('en-IN')}`);

  setText('bucket-small', `${bucketSmall} Bills`);
  setText('bucket-medium', `${bucketMedium} Bills`);
  setText('bucket-high', `${bucketHigh} Bills`);

  setText('peak-sales-date', peakDate);
  setText('peak-sales-amount', `₹${peakVal.toLocaleString('en-IN')}`);

  const totalTransactions = uniqueBills.size;
  setText('metric-upt', (totalTransactions > 0 ? (totalUnits / totalTransactions) : 0).toFixed(2));
  setText('metric-atv', `₹${Math.round(totalTransactions > 0 ? (totalSales / totalTransactions) : 0).toLocaleString('en-IN')}`);
  setText('metric-auv', `₹${Math.round(totalUnits > 0 ? (totalSales / totalUnits) : 0).toLocaleString('en-IN')}`);

  productsList = Object.values(productsObj).map(p => {
    p.share = totalSales > 0 ? (p.revenue / totalSales) * 100 : 0;
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

  if (isAdmin) renderAttendanceSalaryModule(totalSales);
  if (selectedAgentDetail) populateAgentDetailsDOM(selectedAgentDetail);
}

// -------------------------------------------------------------
// TABLE RENDERERS & DRILLDOWN VIEWS
// -------------------------------------------------------------
function filterCategory(cat) {
  selectedCategory = cat;
  ['All', 'Sarees', 'Fabrics', 'Frames'].forEach(c => {
    const btn = getEl(`cat-btn-${c.toLowerCase()}`);
    if (btn) {
      btn.className = c === cat ? "px-3 py-1 rounded-full bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-bold shadow-sm transition-all" : "px-3 py-1 rounded-full bg-[#FFFDF9] text-stone-600 border border-[#E5D5C6] hover:bg-stone-100 font-bold transition-all";
    }
  });
  renderProductsTable();
}

function renderProductsTable() {
  let displayList = productsList.filter(p => selectedCategory === 'All' || p.category === selectedCategory);
  displayList.sort((a, b) => {
    let valA = a.revenue, valB = b.revenue;
    if (prodSortCol === 'item') {
      valA = a.name.toLowerCase(); valB = b.name.toLowerCase();
      return prodSortAsc ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
    } else if (prodSortCol === 'qty') { valA = a.qty; valB = b.qty; }
    return prodSortAsc ? valA - valB : valB - valA;
  });

  const tbody = getEl('products-table-body');
  if (!tbody) return;

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-stone-400 font-traditional">No items found</td></tr>`;
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
      <td class="p-3.5 text-center font-bold text-stone-700 font-sans">${p.qty}</td>
      <td class="p-3.5 text-right font-sans">
        <div class="font-bold text-[#5C0612] text-xs font-numeric">₹${p.revenue.toLocaleString('en-IN')}</div>
        <div class="text-[9px] text-[#DAA520] font-bold mt-1 uppercase font-numeric">${p.share.toFixed(1)}% Share</div>
      </td>
    </tr>
  `).join('');
}

function renderAgentsTable() {
  agentsList.sort((a, b) => {
    let valA = a.revenue, valB = b.revenue;
    if (agentSortCol === 'name') {
      valA = a.name.toLowerCase(); valB = b.name.toLowerCase();
      return agentSortAsc ? (valA < valB ? -1 : 1) : (valA > valB ? -1 : 1);
    }
    return agentSortAsc ? valA - valB : valB - valA;
  });

  const tbody = getEl('agents-table-body');
  if (!tbody) return;

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
      <td class="p-3.5 text-right font-extrabold text-[#5C0612] font-sans font-numeric">₹${a.revenue.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}

function renderDayWiseSales(dayWiseObj) {
  const container = getEl('daywise-sales-container');
  if (!container) return;
  const sortedDates = Object.keys(dayWiseObj).sort((a, b) => b.localeCompare(a));

  if (sortedDates.length === 0) {
    container.innerHTML = `<p class="p-8 text-center text-stone-400 font-semibold font-traditional">No daily sales tracked in this range</p>`;
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
  const selectEl = getEl('bank-filter-select');
  const selectedBank = selectEl ? selectEl.value : 'All';
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';

  const tbody = getEl('bank-ledger-tbody');
  const totalEl = getEl('bank-selected-total');
  const countEl = getEl('bank-bills-count');
  if (!tbody) return;

  const ledgerRecords = [];
  let totalBankAmount = 0;
  const processedBills = new Set();

  rawData.forEach(r => {
    const rawDate = r['Bill Date'] || r['Date'] || r['Invoice Date'] || r['BillDate'];
    if (!rawDate) return;
    const rDate = normalizeToDateString(rawDate);
    if (fromVal && rDate < fromVal) return;
    if (toVal && rDate > toVal) return;

    const storeName = (r['Store'] || r['Shop'] || r['Branch Name'] || r['Branch'] || 'Main Branch').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) return;

    const bNo = getBillNo(r);
    const billKey = `${bNo}-${rDate}`;
    if (processedBills.has(billKey)) return;
    processedBills.add(billKey);

    const fullAmt = getRowAmount(r);
    const agent = r['SM Name'] || r['SMName'] || r['Agent'] || r['Staff Name'] || 'No Agent';
    const splits = getBillSplits(bNo);

    if (splits.length > 0) {
      splits.forEach((s, idx) => {
        const sBank = s.bank || 'Not Defined';
        const sAmt = s.amount > 0 ? s.amount : fullAmt / splits.length;

        if (selectedBank === 'All' || sBank.toLowerCase() === selectedBank.toLowerCase() || sBank.toLowerCase().includes(selectedBank.toLowerCase())) {
          ledgerRecords.push({
            date: rDate,
            billNo: `${bNo} (Split ${idx + 1})`,
            store: storeName,
            agent: agent,
            bank: sBank,
            amount: sAmt
          });
          totalBankAmount += sAmt;
        }
      });
    } else {
      const bAcc = getRowBank(r);
      if (selectedBank === 'All' || bAcc.toLowerCase() === selectedBank.toLowerCase() || bAcc.toLowerCase().includes(selectedBank.toLowerCase())) {
        ledgerRecords.push({
          date: rDate,
          billNo: bNo,
          store: storeName,
          agent: agent,
          bank: bAcc,
          amount: fullAmt
        });
        totalBankAmount += fullAmt;
      }
    }
  });

  ledgerRecords.sort((a, b) => b.date.localeCompare(a.date));

  if (totalEl) totalEl.textContent = `₹${totalBankAmount.toLocaleString('en-IN')}`;
  if (countEl) countEl.textContent = `${ledgerRecords.length} Entries`;

  tbody.innerHTML = ledgerRecords.length === 0 ? `
    <tr><td colspan="6" class="p-6 text-center text-stone-400 font-traditional">No bank credit records found for this selection</td></tr>
  ` : ledgerRecords.map(b => `
    <tr class="hover:bg-amber-50/20 transition-colors">
      <td class="p-3 text-stone-700 font-numeric">${b.date}</td>
      <td class="p-3 font-bold text-stone-800 font-numeric">${b.billNo}</td>
      <td class="p-3 text-stone-600">${b.store}</td>
      <td class="p-3 text-stone-600">${b.agent}</td>
      <td class="p-3"><span class="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-bold px-2 py-0.5 rounded font-numeric">${b.bank}</span></td>
      <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${b.amount.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}

function backupBankStatementExcel() {
  if (!isAdmin || typeof XLSX === 'undefined') return;
  const selectEl = getEl('bank-filter-select');
  const selectedBank = selectEl ? selectEl.value : 'All';
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';

  const statementData = rawData.filter(row => {
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    if (!rawDate) return false;
    const rDate = normalizeToDateString(rawDate);
    if (fromVal && rDate < fromVal) return false;
    if (toVal && rDate > toVal) return false;
    const bAcc = getRowBank(row);
    if (selectedBank !== 'All' && bAcc.toLowerCase() !== selectedBank.toLowerCase()) return false;
    return true;
  }).map(r => ({
    "Bill Date": normalizeToDateString(r['Bill Date'] || r['Date'] || r['Invoice Date']),
    "Bill No": getBillNo(r),
    "Store / Branch": r['Store'] || r['Shop'] || r['Branch Name'] || r['Branch'] || 'Main Branch',
    "Item Name": r['Item Name'] || '',
    "Staff Name": r['SM Name'] || r['SMName'] || r['Agent'] || 'No Agent',
    "Credited Bank Account": getRowBank(r),
    "Payment Mode": r['PayMode'] || r['Pay Mode'] || r['Sale type'] || r['Sale Type'] || '',
    "Bill Amount": getRowAmount(r)
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(statementData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Bank Statement");
  XLSX.writeFile(workbook, `Kailash_BankStatement_${selectedBank.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

// -------------------------------------------------------------
// ATTENDANCE, PAYROLL & COMMISSIONS MODULE
// -------------------------------------------------------------
function filterAttendanceMonth(mSheet) {
  selectedAttendanceMonth = mSheet;
  renderAttendanceSalaryModule(parseFloat((getEl('metric-total')?.textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
}

function renderAttendanceSalaryModule(storeRevenue = 0) {
  if (!isAdmin) return; 
  const container = getEl('staff-salary-list');
  if (!container) return;
  container.innerHTML = '';

  let staffData = Array.isArray(rawAttendanceData) ? rawAttendanceData.filter(emp => {
    const hasName = getEmpProp(emp, ['Employee Name', 'Name', 'Staff Name']);
    if (!hasName) return false;
    if (selectedAttendanceMonth !== 'All') {
      const empMonth = (emp['Month_Sheet'] || emp['Month'] || '').toString().trim().toLowerCase();
      const selMonth = selectedAttendanceMonth.toString().trim().toLowerCase();
      if (empMonth !== selMonth) return false;
    }
    return true;
  }) : [];

  let totalStorePayroll = 0;

  setText('payroll-staff-count', staffData.length);
  setText('profit-store-sales', `₹${storeRevenue.toLocaleString('en-IN')}`);

  staffData.forEach((emp, index) => {
    const empId = getEmpProp(emp, ['Emp ID', 'ID']) || `KS-${101 + index}`;
    const name = getEmpProp(emp, ['Employee Name', 'Name']) || `Staff ${index + 1}`;
    const role = getEmpProp(emp, ['Designation', 'Role']) || 'Sales Staff';
    const phone = getEmpProp(emp, ['Phone Number', 'Phone', 'Mobile']) || '';
    const mSheetName = emp['Month_Sheet'] || 'attendance';
    
    let fullSalary = parseFloat(getEmpProp(emp, ['Monthly Salary', 'Salary'])) || 12000;
    let commPct = parseFloat(getEmpProp(emp, ['Commission Pct', 'Commission %'])) || 0;
    let advance = parseFloat(getEmpProp(emp, ['Advance Taken', 'Advance'])) || 0;

    const totalSold = getStaffSalesAmount(name);
    const calculatedIncentive = (commPct > 0) ? Math.round(totalSold * (commPct / 100)) : 0;

    let countP = 0, countHD = 0, countA = 0, countPL = 0;
    const gridDayBadges = [];
    const leaveReasonsList = [];

    for (let d = 1; d <= 31; d++) {
      const rawVal = getDayValue(emp, d);
      const note = getDayNote(emp, d);
      const upperVal = rawVal.toUpperCase().trim();

      let badgeBg = 'bg-stone-50 text-stone-300 border-stone-200';
      let displayText = '-';
      let statusCode = upperVal;

      if (upperVal === 'P' || upperVal === 'WO' || upperVal === 'PRESENT') {
        countP++;
        badgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
        displayText = upperVal === 'WO' ? 'WO' : 'P';
        statusCode = 'P';
      } else if (upperVal === 'HD' || upperVal === 'HALF DAY' || upperVal === 'HALF') {
        countHD++;
        badgeBg = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
        displayText = 'HD';
        statusCode = 'HD';
      } else if (upperVal === 'A' || upperVal === 'ABSENT' || upperVal.startsWith('A ')) {
        countA++;
        badgeBg = 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
        displayText = 'A';
        statusCode = 'A';
      } else if (upperVal === 'PL' || upperVal === 'SL' || upperVal === 'LEAVE' || upperVal === 'CL') {
        countPL++;
        badgeBg = 'bg-blue-100 text-blue-800 border-blue-300 font-bold';
        displayText = upperVal;
        statusCode = upperVal;
      } else if (upperVal) {
        badgeBg = 'bg-indigo-100 text-indigo-800 border-indigo-300 font-bold';
        displayText = upperVal;
      }

      let displayNote = note;
      if (!displayNote && rawVal.length > 3) displayNote = rawVal;

      gridDayBadges.push(`
        <div class="flex flex-col items-center justify-center border rounded-lg ${badgeBg} text-[8px] py-1 relative transition-all hover:scale-105 cursor-pointer" title="Day ${d}: ${statusCode || 'Unrecorded'}${displayNote ? ` | Reason: ${displayNote}` : ''}">
          <span class="text-[7px] text-stone-400 font-normal">D${d}</span>
          <span class="text-[9px] font-extrabold leading-none mt-0.5">${displayText}</span>
          ${displayNote ? `<span class="absolute -top-1 -right-1 text-[8px]" title="Reason: ${displayNote}">📝</span>` : ''}
        </div>
      `);

      if (displayNote) {
        leaveReasonsList.push(`
          <div class="text-[10px] bg-amber-50 text-amber-900 border border-amber-200 p-1.5 rounded-lg flex justify-between items-center font-numeric">
            <span><strong>Day ${d} (${statusCode || 'Leave'}):</strong> ${displayNote}</span>
          </div>
        `);
      }
    }

    const payableDays = countP + (countHD * 0.5) + countPL;
    const baseEarned = Math.round(payableDays * (fullSalary / 31));
    const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);
    totalStorePayroll += netSalary;

    const card = document.createElement('div');
    card.className = "bg-[#FFFDF9] rounded-2xl border border-[#E5D5C6] warm-shadow p-4 space-y-3";
    card.innerHTML = `
      <div class="flex justify-between items-start border-b border-[#E5D5C6]/60 pb-2">
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-bold text-[#5C0612] bg-[#EFE5C9] px-2 py-0.5 rounded font-numeric">${empId}</span>
            <span class="text-[8px] font-bold text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded uppercase font-traditional">${mSheetName}</span>
          </div>
          <h4 class="font-bold text-stone-800 text-sm font-sans mt-1">${name}</h4>
          <p class="text-[10px] text-stone-500 font-traditional">${role} ${phone ? `• 📞 ${phone}` : ''}</p>
        </div>
        <div class="text-right font-numeric">
          <p class="text-[9px] text-stone-500">Net Salary</p>
          <p class="text-base font-black text-[#5C0612]">₹${netSalary.toLocaleString('en-IN')}</p>
          <div class="flex gap-1.5 mt-1 justify-end export-ignore">
            <button onclick="shareStaffPayslipWhatsApp(${index})" class="text-[8px] bg-[#25D366] hover:bg-[#128C7E] text-white px-2 py-1 rounded-lg font-bold uppercase flex items-center gap-1 shadow-sm active:scale-95 transition-all">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </button>
            <button onclick="exportSingleStaffPayslipPDF(${index})" class="text-[8px] bg-[#5C0612] hover:bg-[#4A030D] text-[#EFE5C9] px-2 py-1 rounded-lg font-bold uppercase flex items-center gap-1 border border-[#DAA520] shadow-sm active:scale-95 transition-all">
              <i class="fa-solid fa-file-pdf text-[#DAA520]"></i> PDF Payslip
            </button>
          </div>
        </div>
      </div>

      <div class="space-y-1">
        <div class="flex justify-between items-center">
          <span class="text-[9px] font-bold uppercase text-stone-500 font-traditional">31-Day Attendance Grid (${payableDays} Days Payable)</span>
          <span class="text-[8px] font-bold text-stone-600 font-numeric">P:${countP} | HD:${countHD} | A:${countA} | PL:${countPL}</span>
        </div>
        <div class="grid grid-cols-7 sm:grid-cols-11 gap-1 pt-1">
          ${gridDayBadges.join('')}
        </div>
      </div>

      ${leaveReasonsList.length > 0 ? `
        <div class="space-y-1 border-t border-[#E5D5C6]/40 pt-2">
          <p class="text-[9px] font-bold text-amber-900 uppercase font-traditional flex items-center gap-1">
            <span>📝 Recorded Leave Reasons</span>
          </p>
          <div class="space-y-1">
            ${leaveReasonsList.join('')}
          </div>
        </div>
      ` : ''}

      <div class="grid grid-cols-3 gap-2 bg-[#FAF6EE] p-2 rounded-xl text-xs font-numeric">
        <div><label class="block text-[8px] text-stone-500 uppercase">Base Salary (₹)</label><input type="number" value="${fullSalary}" oninput="updateStaffPayroll(${index}, 'salary', this.value)" class="w-full text-xs font-bold border rounded p-1"></div>
        <div><label class="block text-[8px] text-stone-500 uppercase">Incentive %</label><input type="number" value="${commPct}" step="0.1" oninput="updateStaffPayroll(${index}, 'commission', this.value)" class="w-full text-xs font-bold border rounded p-1"></div>
        <div><label class="block text-[8px] text-stone-500 uppercase">Advance (₹)</label><input type="number" value="${advance}" oninput="updateStaffPayroll(${index}, 'advance', this.value)" class="w-full text-xs font-bold border rounded p-1"></div>
      </div>
    `;
    container.appendChild(card);
  });

  setText('payroll-total-amount', `₹${totalStorePayroll.toLocaleString('en-IN')}`);

  const grossProfitEl = getEl('profit-gross-amount');
  if (grossProfitEl) {
    const grossVal = storeRevenue - totalStorePayroll;
    grossProfitEl.textContent = `₹${grossVal.toLocaleString('en-IN')}`;
    grossProfitEl.className = grossVal >= 0 ? "text-base font-black text-emerald-700 font-numeric" : "text-base font-black text-rose-700 font-numeric";
  }
}

function updateStaffPayroll(index, field, val) {
  if (!isAdmin) return;
  const emp = rawAttendanceData[index];
  if (field === 'salary') emp['Monthly Salary'] = parseFloat(val) || 0;
  else if (field === 'commission') emp['Commission Pct'] = parseFloat(val) || 0;
  else if (field === 'advance') emp['Advance Taken'] = parseFloat(val) || 0;
  renderAttendanceSalaryModule(parseFloat((getEl('metric-total')?.textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
}

function updateGlobalCommission(val) {
  if (!isAdmin) return;
  defaultCommissionPct = parseFloat(val) || 0;
  rawAttendanceData.forEach(emp => { emp['Commission Pct'] = defaultCommissionPct; });
  renderAttendanceSalaryModule(parseFloat((getEl('metric-total')?.textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
}

function shareStaffPayslipWhatsApp(index) {
  if (!isAdmin) return;
  const emp = rawAttendanceData[index];
  if (!emp) return;

  const name = getEmpProp(emp, ['Employee Name', 'Name']) || 'Staff';
  const empId = getEmpProp(emp, ['Emp ID', 'ID']) || `KS-${101 + index}`;
  const fullSalary = parseFloat(getEmpProp(emp, ['Monthly Salary', 'Salary'])) || 0;
  const commPct = parseFloat(getEmpProp(emp, ['Commission Pct'])) || 0;
  const advance = parseFloat(getEmpProp(emp, ['Advance Taken'])) || 0;

  const totalSold = getStaffSalesAmount(name);
  const calculatedIncentive = commPct > 0 ? Math.round(totalSold * (commPct / 100)) : 0;

  let countP = 0, countHD = 0;
  for (let d = 1; d <= 31; d++) {
    const val = getDayValue(emp, d).toUpperCase();
    if (val === 'P' || val === 'WO' || val === 'PL' || val === 'PRESENT') countP++;
    else if (val === 'HD' || val === 'HALF DAY' || val === 'HALF') countHD++;
  }

  const payableDays = countP + (countHD * 0.5);
  const baseEarned = Math.round(payableDays * (fullSalary / 31));
  const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);

  let msg = `🌸 *KAILASH KALAMKARI - MONTHLY PAYSLIP* 🌸\n\n`;
  msg += `🆔 *Staff ID:* ${empId}\n`;
  msg += `👤 *Staff Name:* ${name}\n`;
  msg += `🗓️ *Payable Days:* ${payableDays} / 31 Days\n`;
  msg += `💵 *Base Monthly Salary:* ₹${fullSalary.toLocaleString('en-IN')}\n`;
  msg += `🛍️ *Total Sales Achieved:* ₹${totalSold.toLocaleString('en-IN')}\n`;
  
  if (calculatedIncentive > 0) {
    msg += `🎁 *SALES INCENTIVE (${commPct}%):* +₹${calculatedIncentive.toLocaleString('en-IN')}\n`;
  }
  
  if (advance > 0) msg += `📉 *Advance Deducted:* -₹${advance.toLocaleString('en-IN')}\n`;
  msg += `\n💰 *FINAL NET PAYABLE SALARY:* ₹${netSalary.toLocaleString('en-IN')}\n\n`;
  msg += `_Thank you for your dedicated service at Kailash Kalamkari!_`;

  const phone = formatPhoneForWhatsApp(getEmpProp(emp, ['Phone Number', 'Phone', 'Mobile']));
  if (phone) window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`, '_blank');
  else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function exportSingleStaffPayslipPDF(index) {
  if (!isAdmin) return;
  const emp = rawAttendanceData[index];
  if (!emp) return;

  const name = getEmpProp(emp, ['Employee Name', 'Name']) || 'Staff Member';
  const empId = getEmpProp(emp, ['Emp ID', 'ID']) || `KS-${101 + index}`;
  const role = getEmpProp(emp, ['Designation', 'Role']) || 'Sales Executive';
  const fullSalary = parseFloat(getEmpProp(emp, ['Monthly Salary', 'Salary'])) || 0;
  const commPct = parseFloat(getEmpProp(emp, ['Commission Pct'])) || 0;
  const advance = parseFloat(getEmpProp(emp, ['Advance Taken'])) || 0;

  const totalSold = getStaffSalesAmount(name);
  const calculatedIncentive = commPct > 0 ? Math.round(totalSold * (commPct / 100)) : 0;

  let countP = 0, countHD = 0;
  for (let d = 1; d <= 31; d++) {
    const val = getDayValue(emp, d).toUpperCase();
    if (val === 'P' || val === 'WO' || val === 'PL' || val === 'PRESENT') countP++;
    else if (val === 'HD' || val === 'HALF DAY' || val === 'HALF') countHD++;
  }

  const payableDays = countP + (countHD * 0.5);
  const baseEarned = Math.round(payableDays * (fullSalary / 31));
  const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);

  const payslipContainer = document.createElement('div');
  payslipContainer.className = "p-8 bg-[#FFFDF9] border-2 border-[#5C0612] max-w-xl mx-auto rounded-3xl font-numeric text-stone-800 space-y-4";
  payslipContainer.id = "temp-payslip-pdf";

  payslipContainer.innerHTML = `
    <div class="text-center border-b-2 border-[#DAA520] pb-4">
      <h2 class="text-2xl font-bold font-traditional text-[#5C0612]">KAILASH KALAMKARI</h2>
      <p class="text-[10px] text-stone-600 uppercase font-semibold">Official Staff Salary Slip & Performance Voucher</p>
    </div>

    <div class="grid grid-cols-2 gap-4 text-xs border-b border-[#E5D5C6] pb-3">
      <div>
        <p class="text-stone-500 text-[10px] uppercase">Employee ID</p>
        <p class="font-black text-[#5C0612]">${empId}</p>
        <p class="text-stone-500 text-[10px] uppercase mt-2">Employee Name</p>
        <p class="font-bold text-stone-800">${name}</p>
      </div>
      <div class="text-right">
        <p class="text-stone-500 text-[10px] uppercase">Designation</p>
        <p class="font-bold text-stone-800">${role}</p>
        <p class="text-stone-500 text-[10px] uppercase mt-2">Payable Days</p>
        <p class="font-bold text-stone-800">${payableDays} / 31 Days</p>
      </div>
    </div>

    <div class="space-y-2 text-xs">
      <div class="flex justify-between py-1 border-b border-stone-200">
        <span class="text-stone-600 font-medium">Base Monthly Salary</span>
        <span class="font-bold text-stone-800">₹${fullSalary.toLocaleString('en-IN')}</span>
      </div>
      <div class="flex justify-between py-1 border-b border-stone-200">
        <span class="text-stone-600 font-medium">Earned Base (Attended Days)</span>
        <span class="font-bold text-stone-800">₹${baseEarned.toLocaleString('en-IN')}</span>
      </div>
      <div class="flex justify-between py-1 border-b border-stone-200">
        <span class="text-stone-600 font-medium">Total Store Sales Generated</span>
        <span class="font-bold text-stone-800">₹${totalSold.toLocaleString('en-IN')}</span>
      </div>
      ${commPct > 0 ? `
      <div class="flex justify-between py-1 border-b border-stone-200 text-emerald-800">
        <span class="font-medium">Sales Incentive (${commPct}%)</span>
        <span class="font-bold">+₹${calculatedIncentive.toLocaleString('en-IN')}</span>
      </div>` : ''}
      ${advance > 0 ? `
      <div class="flex justify-between py-1 border-b border-stone-200 text-rose-800">
        <span class="font-medium">Advance Deducted</span>
        <span class="font-bold">-₹${advance.toLocaleString('en-IN')}</span>
      </div>` : ''}
    </div>

    <div class="bg-[#5C0612] text-[#EFE5C9] p-4 rounded-2xl flex justify-between items-center border border-[#DAA520]">
      <span class="font-traditional uppercase font-bold text-xs">Net Salary Payable</span>
      <span class="text-xl font-black">₹${netSalary.toLocaleString('en-IN')}</span>
    </div>

    <div class="flex justify-between items-end pt-8 text-[9px] text-stone-500 font-traditional">
      <div>
        <p>Employee Signature: __________________</p>
      </div>
      <div class="text-right">
        <p>Authorized Signature: __________________</p>
        <p class="mt-1 font-bold text-[#5C0612]">Kailash Kalamkari Management</p>
      </div>
    </div>
  `;

  document.body.appendChild(payslipContainer);

  const opt = {
    margin: 0.3,
    filename: `Payslip_${name.replace(/[^a-zA-Z0-9]/gi, '_')}_${empId}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(payslipContainer).save().then(() => {
    document.body.removeChild(payslipContainer);
  }).catch(err => {
    console.error(err);
    if (getEl('temp-payslip-pdf')) {
      document.body.removeChild(payslipContainer);
    }
  });
}

function shareAllPayslipsWhatsApp() {
  if (!isAdmin) return;
  const modal = getEl('whatsapp-bulk-modal');
  const container = getEl('whatsapp-bulk-list');
  if (!modal || !container) return;

  let staffData = Array.isArray(rawAttendanceData) ? rawAttendanceData.filter(emp => getEmpProp(emp, ['Employee Name', 'Name', 'Staff Name'])) : [];
  
  if (staffData.length === 0) {
    alert("No employee payroll records found.");
    return;
  }

  container.innerHTML = staffData.map((emp, index) => {
    const name = getEmpProp(emp, ['Employee Name', 'Name']) || `Staff ${index + 1}`;
    const empId = getEmpProp(emp, ['Emp ID', 'ID']) || `KS-${101 + index}`;
    const phone = getEmpProp(emp, ['Phone Number', 'Phone', 'Mobile']) || '';
    
    return `
      <div class="flex justify-between items-center bg-[#FAF6EE] p-3 rounded-2xl border border-[#E5D5C6]">
        <div>
          <span class="text-[9px] font-bold text-[#5C0612] bg-[#EFE5C9] px-2 py-0.5 rounded font-numeric">${empId}</span>
          <p class="font-bold text-xs text-stone-800 font-sans mt-0.5">${name}</p>
          <p class="text-[10px] text-stone-500 font-numeric">${phone ? `📞 ${phone}` : 'No phone listed'}</p>
        </div>
        <button onclick="shareStaffPayslipWhatsApp(${index})" class="bg-[#25D366] hover:bg-[#128C7E] text-white text-xs px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all">
          <i class="fa-brands fa-whatsapp text-sm"></i> Send Payslip
        </button>
      </div>
    `;
  }).join('');

  modal.classList.remove('hidden');
}

function closeWhatsAppBulkModal() {
  hideEl('whatsapp-bulk-modal');
}

function shareOwnerDailySummaryWhatsApp() {
  if (!isAdmin) return;
  const fromVal = getEl('from-date') ? getEl('from-date').value : 'Start';
  const toVal = getEl('to-date') ? getEl('to-date').value : 'End';
  const totalSalesText = getEl('metric-total') ? getEl('metric-total').textContent : '₹0';
  const onlineSalesText = getEl('metric-online') ? getEl('metric-online').textContent : '₹0';
  const offlineSalesText = getEl('metric-offline') ? getEl('metric-offline').textContent : '₹0';
  const wholesaleSalesText = getEl('metric-wholesale') ? getEl('metric-wholesale').textContent : '₹0';

  let msg = `🌸 *KAILASH KALAMKARI - EXECUTIVE SUMMARY* 🌸\n\n`;
  msg += `📍 *Selected Store:* ${selectedStore}\n`;
  msg += `🗓️ *Period:* ${fromVal} to ${toVal}\n`;
  msg += `💰 *TOTAL REVENUE:* ${totalSalesText}\n\n`;
  msg += `📊 *CHANNEL BREAKDOWN:*\n`;
  msg += `• Online: ${onlineSalesText}\n`;
  msg += `• Offline Store: ${offlineSalesText}\n`;
  msg += `• Takebyhand: ${wholesaleSalesText}\n\n`;
  msg += `_Generated live from Kailash Kalamkari Executive Portal_`;

  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function backupFullDatabaseExcel() {
  if (!isAdmin || typeof XLSX === 'undefined') {
    alert("Excel library loading or unavailable.");
    return;
  }
  const workbook = XLSX.utils.book_new();
  const salesSheetData = rawData.map(r => ({
    "Date": normalizeToDateString(r['Bill Date'] || r['Date'] || r['Invoice Date']),
    "Store/Shop": r['Store'] || r['Shop'] || r['Branch Name'] || r['Branch'] || 'Main Branch',
    "Bill No": getBillNo(r),
    "Staff Name": r['SM Name'] || r['SMName'] || r['Agent'] || 'No Agent',
    "Item Name": r['Item Name'] || '',
    "Category": getItemCategory(r['Item Name']),
    "Qty": parseInt(r['Qty'] || 1) || 1,
    "Amount": getRowAmount(r),
    "PayMode": r['PayMode'] || r['Pay Mode'] || r['Sale type'] || r['Sale Type'] || '',
    "Credited Bank Account": getRowBank(r),
    "Channel": getSalesType(r['PayMode'] || r['Pay Mode'] || r['Sale type'] || r['Sale Type'])
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(salesSheetData), "Sales Data");
  if (rawAttendanceData.length > 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rawAttendanceData), "Attendance & Payroll");
  }
  XLSX.writeFile(workbook, `Kailash_Kalamkari_Backup_${new Date().toISOString().split('T')[0]}.xlsx`);
}

async function saveAttendanceData() {
  if (!isAdmin) return;
  const user = localStorage.getItem('kk_user');
  const pass = localStorage.getItem('kk_pass');
  if (!user || !pass) return;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ 
        action: 'save_attendance',
        username: user, 
        password: pass, 
        records: rawAttendanceData, 
        monthSheet: selectedAttendanceMonth 
      })
    });
    const res = await response.json();
    if (res.status === 'success') alert("✅ Attendance and payroll saved cleanly to Google Sheets!");
    else alert("Error saving: " + (res.error || "Unknown error"));
  } catch (err) {
    alert("Saved locally in session!");
  }
}

// -------------------------------------------------------------
// DRILLDOWN & KPI DETAILS POPULATION
// -------------------------------------------------------------
function sortProducts(column) {
  if (prodSortCol === column) prodSortAsc = !prodSortAsc;
  else { prodSortCol = column; prodSortAsc = false; }
  renderProductsTable();
}

function sortAgents(column) {
  if (agentSortCol === column) agentSortAsc = !agentSortAsc;
  else { agentSortCol = column; agentSortAsc = false; }
  renderAgentsTable();
}

function showAgentDetails(agentName) { applyState({ view: 'agent-analysis', name: agentName }); }
function showProductDetails(productName) { applyState({ view: 'home', detail: 'product', name: productName }); }

function populateProductDetailsDOM(productName, isChannel = false) {
  setText('detail-product-name', productName);
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';

  const agentStats = {};
  rawData.forEach(row => {
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    if (!rawDate) return;
    const rDate = normalizeToDateString(rawDate);
    if (fromVal && rDate < fromVal) return;
    if (toVal && rDate > toVal) return;
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Main Branch').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) return;

    if ((row['Item Name'] || row['ItemName']) !== productName) return;

    const agent = row['SM Name'] || row['SMName'] || row['Agent'] || 'No Agent';
    const amount = getRowAmount(row);
    const type = getSalesType(row['PayMode'] || row['Pay Mode'] || row['Sale type'] || row['Sale Type']);

    if (!agentStats[agent]) agentStats[agent] = { online: 0, offline: 0, wholesale: 0, total: 0 };
    if (type === 'Online') agentStats[agent].online += amount;
    else if (type === 'Wholesale') agentStats[agent].wholesale += amount;
    else agentStats[agent].offline += amount;
    agentStats[agent].total += amount;
  });

  const sortedAgents = Object.entries(agentStats).sort((a, b) => b[1].total - a[1].total);
  const tbody = getEl('product-detail-table-body');
  if (tbody) {
    tbody.innerHTML = sortedAgents.length === 0 ? `<tr><td colspan="5" class="p-3 text-center text-stone-400">No sales recorded</td></tr>` : sortedAgents.map(([agentName, stats]) => `
      <tr class="hover:bg-amber-50/20 transition-colors">
        <td class="p-1.5 font-bold text-stone-700 font-sans">${agentName}</td>
        <td class="p-1.5 text-right text-blue-600 font-bold font-numeric">₹${stats.online.toLocaleString('en-IN')}</td>
        <td class="p-1.5 text-right text-orange-600 font-bold font-numeric">₹${stats.offline.toLocaleString('en-IN')}</td>
        <td class="p-1.5 text-right text-purple-600 font-bold font-numeric">₹${stats.wholesale.toLocaleString('en-IN')}</td>
        <td class="p-1.5 text-right text-[#5C0612] font-black font-numeric">₹${stats.total.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

function toggleAgentDetailView(view) {
  const prodView = getEl('agent-detail-product-view');
  const billView = getEl('agent-detail-bill-view');
  if (view === 'product') {
    if (prodView) prodView.classList.remove('hidden');
    if (billView) billView.classList.add('hidden');
  } else {
    if (prodView) prodView.classList.add('hidden');
    if (billView) billView.classList.remove('hidden');
  }
}

function populateAgentDetailsDOM(agentName) {
  const agentObj = agentsList.find(a => a.name === agentName);
  if (!agentObj) return false;

  setText('detail-agent-name', `${agentObj.name} Ledger`);
  const sortedItems = Object.entries(agentObj.items).sort((a, b) => b[1].qty - a[1].qty);
  const tbody = getEl('agent-detail-table-body');
  if (tbody) {
    tbody.innerHTML = sortedItems.map(([itemName, values]) => `
      <tr class="hover:bg-amber-50/20 transition-colors">
        <td class="p-2.5 font-semibold text-stone-700">${itemName}</td>
        <td class="p-2.5 text-center font-bold text-stone-500 font-numeric">${values.qty}</td>
        <td class="p-2.5 text-right font-extrabold text-[#5C0612] font-numeric">₹${values.revenue.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  const sortedBills = Object.values(agentObj.bills).sort((a, b) => b.amount - a.amount);
  const billTbody = getEl('agent-detail-bill-table-body');
  if (billTbody) {
    billTbody.innerHTML = sortedBills.map(b => `
      <tr class="hover:bg-amber-50/20 transition-colors">
        <td class="p-2.5 font-semibold text-stone-700 font-numeric">${b.date || 'N/A'}</td>
        <td class="p-2.5 text-center font-bold text-stone-500 font-numeric">${b.billNo || 'N/A'}</td>
        <td class="p-2.5 text-center"><span class="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-bold px-2 py-0.5 rounded font-numeric">${b.bank || 'Not Defined'}</span></td>
        <td class="p-2.5 text-right font-extrabold text-[#5C0612] font-numeric">₹${b.amount.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  toggleAgentDetailView('product');
  return true;
}

function populateChannelScreenDOM(channel) {
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';
  const filtered = rawData.filter(row => {
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    if (!rawDate) return false;
    const rDate = normalizeToDateString(rawDate);
    let match = true;
    if (fromVal) match = match && (rDate >= fromVal);
    if (toVal) match = match && (rDate <= toVal);
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Main Branch').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) match = false;

    return match && (getSalesType(row['PayMode'] || row['Pay Mode'] || row['Sale type'] || row['Sale Type']) === channel);
  });

  let totalChannelRevenue = 0;
  const agentsObj = {}, productsObj = {};

  filtered.forEach(row => {
    const amount = getRowAmount(row);
    const qty = parseInt(row['Qty'] || row['QTY'] || 1) || 1;
    const item = row['Item Name'] || 'Unknown Item';
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
    agentTable.innerHTML = sortedA.length === 0 ? `<tr><td colspan="2" class="p-4 text-center text-stone-400">No record</td></tr>` : sortedA.map(([aName, amt]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700 font-sans">${aName}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${amt.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  const prodTable = getEl('channel-products-table');
  if (prodTable) {
    const sortedP = Object.entries(productsObj).sort((a, b) => b[1].revenue - a[1].revenue);
    prodTable.innerHTML = sortedP.length === 0 ? `<tr><td colspan="3" class="p-4 text-center text-stone-400">No record</td></tr>` : sortedP.map(([pName, pObj]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700 font-sans">${pName}</td>
        <td class="p-3 text-center font-bold text-stone-600 font-numeric">${pObj.qty}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${pObj.revenue.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

function populateWeeklyScreenDOM() { renderWeeklyDistributionDOM(); }

function renderWeeklyDistributionDOM() {
  const container = getEl('weekly-distribution-bars');
  if (!container) return;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const totalWeeklySales = currentDaySales.reduce((a, b) => a + b, 0);

  container.innerHTML = dayNames.map((day, idx) => {
    const amount = currentDaySales[idx] || 0;
    const pct = totalWeeklySales > 0 ? (amount / totalWeeklySales) * 100 : 0;
    return `
      <div class="space-y-1">
        <div class="flex justify-between items-center text-xs font-semibold text-stone-700">
          <span class="font-traditional">${day}</span>
          <span class="font-numeric text-[#5C0612] font-black">₹${amount.toLocaleString('en-IN')} (${pct.toFixed(1)}%)</span>
        </div>
        <div class="w-full bg-[#E5D5C6]/40 h-2.5 rounded-full overflow-hidden">
          <div class="bg-[#5C0612] h-full rounded-full" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function setAgentBillsViewMode(mode) {
  agentBillsViewMode = mode;
  const sumBtn = getEl('btn-agent-mode-summary');
  const detBtn = getEl('btn-agent-mode-detailed');
  
  if (mode === 'summary') {
    if (sumBtn) sumBtn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition-all bg-[#5C0612] text-[#EFE5C9] shadow-sm font-traditional flex items-center gap-1.5";
    if (detBtn) detBtn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition-all text-stone-600 hover:text-stone-900 font-traditional flex items-center gap-1.5";
  } else {
    if (sumBtn) sumBtn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition-all text-stone-600 hover:text-stone-900 font-traditional flex items-center gap-1.5";
    if (detBtn) detBtn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition-all bg-[#5C0612] text-[#EFE5C9] shadow-sm font-traditional flex items-center gap-1.5";
  }
  
  if (activeAnalysisAgent) {
    populateAgentAnalysisScreenDOM(activeAnalysisAgent);
  }
}

function populateAgentAnalysisScreenDOM(agentName) {
  activeAnalysisAgent = agentName;
  const fromVal = getEl('from-date') ? getEl('from-date').value : '';
  const toVal = getEl('to-date') ? getEl('to-date').value : '';
  
  setText('agent-analysis-title', `${agentName} Ledger`);
  setText('agent-analysis-subtitle', `Period: ${fromVal || 'Start'} to ${toVal || 'End'}`);

  const filtered = rawData.filter(row => {
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    if (!rawDate) return false;
    const rDate = normalizeToDateString(rawDate);
    let match = true;
    if (fromVal) match = match && (rDate >= fromVal);
    if (toVal) match = match && (rDate <= toVal);
    
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Main Branch').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) match = false;
    return match;
  });

  const cleanTargetAgent = agentName.toString().trim().toLowerCase();
  const agentRows = filtered.filter(row => {
    const smName = (row['SM Name'] || row['SMName'] || row['Agent'] || row['Staff'] || 'No Agent').toString().trim().toLowerCase();
    return smName === cleanTargetAgent || smName.includes(cleanTargetAgent) || cleanTargetAgent.includes(smName);
  });

  let totalAgentRevenue = 0, totalAgentUnits = 0;
  let totalOnlineSales = 0, totalOfflineSales = 0, totalTakebyhandSales = 0;
  const dailyGroup = {};
  const productSales = {};

  agentRows.forEach(row => {
    const rawDate = row['Bill Date'] || row['Date'] || row['Invoice Date'] || row['BillDate'];
    const date = normalizeToDateString(rawDate);
    const amount = getRowAmount(row);
    const qty = parseInt(row['Qty'] || row['QTY'] || 1) || 1;
    const item = row['Item Name'] || row['ItemName'] || 'Unknown Item';
    const payMode = row['PayMode'] || row['Pay Mode'] || row['Paymode'] || row['Sale type'] || row['Sale Type'] || '';
    const channel = getSalesType(payMode);
    const billNo = getBillNo(row);
    const splits = getBillSplits(billNo);
    const bankAcc = splits.length > 0 ? splits.map(s => `${s.bank}: ₹${s.amount.toLocaleString('en-IN')}`).join(', ') : getRowBank(row);

    totalAgentRevenue += amount;
    totalAgentUnits += qty;

    if (channel === 'Online') totalOnlineSales += amount;
    else if (channel === 'Wholesale') totalTakebyhandSales += amount;
    else totalOfflineSales += amount;

    if (!dailyGroup[date]) dailyGroup[date] = { total: 0, bills: {} };
    dailyGroup[date].total += amount;

    if (!dailyGroup[date].bills[billNo]) dailyGroup[date].bills[billNo] = { total: 0, bank: bankAcc, items: [], totalQty: 0 };
    dailyGroup[date].bills[billNo].total += amount;
    dailyGroup[date].bills[billNo].totalQty += qty;
    dailyGroup[date].bills[billNo].items.push({ name: item, qty: qty, amount: amount, channel: channel });

    if (!productSales[item]) {
      productSales[item] = { name: item, revenue: 0, qty: 0, onlineQty: 0, offlineQty: 0, takebyhandQty: 0 };
    }
    productSales[item].revenue += amount;
    productSales[item].qty += qty;
    if (channel === 'Online') productSales[item].onlineQty += qty;
    else if (channel === 'Wholesale') productSales[item].takebyhandQty += qty;
    else productSales[item].offlineQty += qty;
  });

  setText('agent-analysis-total-revenue', `₹${totalAgentRevenue.toLocaleString('en-IN')}`);
  setText('agent-analysis-online-sales', `₹${totalOnlineSales.toLocaleString('en-IN')}`);
  setText('agent-analysis-offline-sales', `₹${totalOfflineSales.toLocaleString('en-IN')}`);
  setText('agent-analysis-takebyhand-sales', `₹${totalTakebyhandSales.toLocaleString('en-IN')}`);

  const agentBillCount = Object.keys(dailyGroup).reduce((acc, date) => acc + Object.keys(dailyGroup[date].bills).length, 0);
  const agentATV = agentBillCount > 0 ? (totalAgentRevenue / agentBillCount) : 0;
  const agentAUV = totalAgentUnits > 0 ? (totalAgentRevenue / totalAgentUnits) : 0;
  
  setText('agent-analysis-atv', `₹${Math.round(agentATV).toLocaleString('en-IN')}`);
  setText('agent-analysis-auv', `₹${Math.round(agentAUV).toLocaleString('en-IN')}`);

  const sortedProductSales = Object.values(productSales).map(p => {
    p.percent = totalAgentRevenue > 0 ? (p.revenue / totalAgentRevenue) * 100 : 0;
    return p;
  }).sort((a, b) => b.revenue - a.revenue);

  const productShareContainer = getEl('agent-analysis-product-share');
  if (productShareContainer) {
    productShareContainer.innerHTML = sortedProductSales.length === 0 ? `
      <p class="text-center text-stone-400 text-xs font-traditional py-4">No product sales recorded for this staff member in this date range.</p>
    ` : sortedProductSales.map(p => `
      <div class="space-y-1.5 p-3 rounded-xl bg-[#FAF6EE]/60 border border-[#E5D5C6]/60">
        <div class="flex justify-between items-center text-xs font-semibold text-stone-700">
          <span class="font-traditional font-bold text-stone-800 truncate max-w-[200px]">${p.name}</span>
          <span class="font-numeric text-[#5C0612] font-black">₹${p.revenue.toLocaleString('en-IN')} (${p.percent.toFixed(1)}%)</span>
        </div>
        <div class="w-full bg-[#E5D5C6]/40 h-1.5 rounded-full overflow-hidden">
          <div class="bg-[#DAA520] h-full rounded-full" style="width: ${p.percent}%"></div>
        </div>
      </div>
    `).join('');
  }

  const sortedDates = Object.keys(dailyGroup).sort((a, b) => b.localeCompare(a));
  const dailyListContainer = getEl('agent-analysis-daily-list');
  
  if (dailyListContainer) {
    if (sortedDates.length === 0) {
      dailyListContainer.innerHTML = `<p class="p-6 text-center text-stone-400 font-traditional">No daily bills found for this staff member.</p>`;
      return;
    }

    dailyListContainer.innerHTML = sortedDates.map(dateStr => {
      const dayData = dailyGroup[dateStr];
      const sortedBills = Object.entries(dayData.bills).sort((a, b) => b[1].total - a[1].total);

      let billsContentHTML = '';

      if (agentBillsViewMode === 'summary') {
        billsContentHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs font-numeric">
              <thead>
                <tr class="text-stone-500 text-[9px] uppercase font-bold border-b border-[#E5D5C6]">
                  <th class="p-2 font-traditional">Bill No</th>
                  <th class="p-2 text-center font-traditional">Qty</th>
                  <th class="p-2 font-traditional">Bank / Split Details</th>
                  <th class="p-2 text-right font-traditional">Amount</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#E5D5C6]/20">
                ${sortedBills.map(([billNo, billData]) => `
                  <tr class="hover:bg-amber-50/20">
                    <td class="p-2 font-bold text-stone-800">${billNo}</td>
                    <td class="p-2 text-center text-stone-600">${billData.totalQty} items</td>
                    <td class="p-2"><span class="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-bold px-2 py-0.5 rounded font-numeric">${billData.bank}</span></td>
                    <td class="p-2 text-right font-black text-[#5C0612]">₹${billData.total.toLocaleString('en-IN')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else {
        billsContentHTML = sortedBills.map(([billNo, billData]) => {
          const itemsHTML = billData.items.map(item => `
            <div class="flex justify-between items-center text-[11px] text-stone-600 py-1.5">
              <span class="font-sans font-medium text-stone-700">${item.name} <strong class="text-stone-500">x${item.qty}</strong> <span class="text-[9px] text-stone-400 font-bold">(${item.channel})</span></span>
              <span class="font-numeric font-semibold text-stone-800">₹${item.amount.toLocaleString('en-IN')}</span>
            </div>
          `).join('');

          return `
            <div class="bg-stone-50/60 rounded-xl p-3 border border-[#E5D5C6]/40 space-y-1.5">
              <div class="flex justify-between items-center border-b border-[#E5D5C6]/30 pb-1">
                <span class="text-[10px] font-bold text-stone-500 uppercase tracking-wider font-traditional">
                  Bill No: <strong class="text-stone-800">${billNo}</strong> 
                  <span class="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded ml-1 font-numeric">🏦 ${billData.bank}</span>
                </span>
                <span class="text-xs font-black text-[#5C0612] font-numeric">₹${billData.total.toLocaleString('en-IN')}</span>
              </div>
              <div class="divide-y divide-[#E5D5C6]/15">${itemsHTML}</div>
            </div>
          `;
        }).join('');
      }

      return `
        <div class="border border-[#E5D5C6] rounded-2xl bg-[#FFFDF9] overflow-hidden warm-shadow">
          <div class="bg-[#F3EFE9] px-4 py-3 border-b border-[#E5D5C6] flex justify-between items-center">
            <span class="font-traditional font-bold text-stone-700 text-xs">${dateStr} (${sortedBills.length} Bills)</span>
            <span class="font-numeric font-black text-[#5C0612] text-xs">Day Total: ₹${dayData.total.toLocaleString('en-IN')}</span>
          </div>
          <div class="p-3 space-y-3">${billsContentHTML}</div>
        </div>
      `;
    }).join('');
  }
}

function shareAgentSalesReportWhatsApp() {
  const revEl = getEl('agent-analysis-total-revenue');
  let msg = `🌸 *KAILASH KALAMKARI - STAFF PERFORMANCE* 🌸\n\n👤 *Staff Member:* ${activeAnalysisAgent}\n💰 *Total Sales Revenue:* ${revEl ? revEl.textContent : '₹0'}\n`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

// -------------------------------------------------------------
// TAB SWITCHER
// -------------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  showEl(tabId);

  const btnMap = {
    'products-tab': 'btn-products-tab',
    'agents-tab': 'btn-agents-tab',
    'daywise-tab': 'btn-daywise-tab',
    'payments-tab': 'btn-payments-tab',
    'banks-tab': 'btn-banks-tab',
    'attendance-tab': 'btn-attendance-tab'
  };

  Object.entries(btnMap).forEach(([tId, bId]) => {
    const btn = getEl(bId);
    if (btn) {
      btn.className = (tId === tabId)
        ? "flex-1 min-w-[90px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional flex items-center justify-center gap-1"
        : "flex-1 min-w-[90px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional flex items-center justify-center gap-1";
    }
  });
}

// -------------------------------------------------------------
// PAYMENT SPLIT & MULTI-ACCOUNT RECORDING ENGINE (ADMIN ONLY)
// -------------------------------------------------------------
function populateBillsDatalist() {
  const datalist = getEl('bills-datalist');
  if (!datalist) return;
  
  const billSet = new Set();
  rawData.forEach(row => {
    const bNo = getBillNo(row);
    if (bNo && bNo !== 'N/A') billSet.add(bNo);
  });

  datalist.innerHTML = Array.from(billSet).slice(0, 500).map(b => `<option value="${b}">`).join('');
}

function lookupBillDetails() {
  const inputVal = (getEl('split-bill-search')?.value || '').trim();
  if (!inputVal) {
    alert("Please enter a Bill Number.");
    return;
  }

  const matchingRows = rawData.filter(r => getBillNo(r).toLowerCase() === inputVal.toLowerCase());
  
  if (matchingRows.length === 0) {
    alert(`Bill No "${inputVal}" was not found in the current sales records.`);
    return;
  }

  const firstRow = matchingRows[0];
  const totalBillAmt = matchingRows.reduce((sum, r) => sum + getRowAmount(r), 0);

  currentSelectedBillData = {
    billNo: getBillNo(firstRow),
    date: normalizeToDateString(firstRow['Bill Date'] || firstRow['Date'] || firstRow['Invoice Date']),
    store: firstRow['Store'] || firstRow['Shop'] || 'Main Branch',
    agent: firstRow['SM Name'] || firstRow['SMName'] || firstRow['Agent'] || 'No Agent',
    totalAmount: totalBillAmt
  };

  setText('info-bill-date', currentSelectedBillData.date);
  setText('info-bill-store', currentSelectedBillData.store);
  setText('info-bill-agent', currentSelectedBillData.agent);
  setText('info-bill-total', `₹${totalBillAmt.toLocaleString('en-IN')}`);
  showEl('bill-info-box');

  const container = getEl('split-rows-container');
  if (container) {
    container.innerHTML = '';
    const existingSplits = getBillSplits(currentSelectedBillData.billNo);
    if (existingSplits.length > 0) {
      existingSplits.forEach(s => addSplitRow(s.bank, s.amount));
    } else {
      addSplitRow('Cash', '');
      addSplitRow('42441-TJ', '');
    }
    calculateSplitTotals();
  }
}

function addSplitRow(selectedBank = '', amount = '') {
  const container = getEl('split-rows-container');
  if (!container) return;

  const rowId = `split-row-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
  const accounts = Array.from(new Set(['Cash', '42441-TJ', 'KC', ...bankAccountsList]));

  const rowDiv = document.createElement('div');
  rowDiv.id = rowId;
  rowDiv.className = "flex items-center gap-2 bg-[#FAF6EE] p-2 rounded-xl border border-[#E5D5C6]";
  
  rowDiv.innerHTML = `
    <div class="flex-1">
      <select class="split-account-select w-full text-xs font-bold bg-white border border-[#E5D5C6] rounded-lg p-2 text-stone-800 focus:outline-none">
        <option value="">-- Select Account / Cash --</option>
        ${accounts.map(acc => `<option value="${acc}" ${acc.toLowerCase() === selectedBank.toLowerCase() ? 'selected' : ''}>${acc}</option>`).join('')}
      </select>
    </div>
    <div class="w-32">
      <input type="number" step="any" placeholder="Amount (₹)" value="${amount}" oninput="calculateSplitTotals()" class="split-amount-input w-full text-xs font-bold font-numeric bg-white border border-[#E5D5C6] rounded-lg p-2 text-[#5C0612] focus:outline-none">
    </div>
    <button onclick="removeSplitRow('${rowId}')" class="text-stone-400 hover:text-rose-600 p-2 text-xs" title="Remove Split">
      <i class="fa-solid fa-trash-can"></i>
    </button>
  `;

  container.appendChild(rowDiv);
  calculateSplitTotals();
}

function removeSplitRow(rowId) {
  const rowEl = getEl(rowId);
  if (rowEl) rowEl.remove();
  calculateSplitTotals();
}

function calculateSplitTotals() {
  const amtInputs = document.querySelectorAll('.split-amount-input');
  let allocatedTotal = 0;

  amtInputs.forEach(input => {
    allocatedTotal += parseFloat(input.value) || 0;
  });

  const totalBill = currentSelectedBillData ? currentSelectedBillData.totalAmount : 0;
  const remaining = totalBill - allocatedTotal;

  setText('split-allocated-total', `₹${allocatedTotal.toLocaleString('en-IN')}`);
  setText('split-remaining-balance', `₹${remaining.toLocaleString('en-IN')}`);

  const statusBadge = getEl('split-status-badge');
  if (statusBadge) {
    if (!currentSelectedBillData) {
      statusBadge.className = "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-stone-200 text-stone-600";
      statusBadge.textContent = "Select Bill";
    } else if (remaining === 0 && allocatedTotal > 0) {
      statusBadge.className = "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-300";
      statusBadge.textContent = "Matched ✅";
    } else if (remaining > 0) {
      statusBadge.className = "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-amber-100 text-amber-800 border border-amber-300";
      statusBadge.textContent = `₹${remaining} Remaining`;
    } else {
      statusBadge.className = "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-rose-100 text-rose-800 border border-rose-300";
      statusBadge.textContent = `Exceeded by ₹${Math.abs(remaining)}`;
    }
  }
}

function openNewAccountModal() {
  const inp = getEl('new-account-name-input');
  if (inp) inp.value = '';
  showEl('new-account-modal');
}

function closeNewAccountModal() {
  hideEl('new-account-modal');
}

async function saveNewAccountType() {
  const name = (getEl('new-account-name-input')?.value || '').trim();
  if (!name) {
    alert("Please enter a valid Account Name or Code.");
    return;
  }

  if (!bankAccountsList.includes(name)) {
    bankAccountsList.push(name);
  }

  populateBankDropdown();
  
  document.querySelectorAll('.split-account-select').forEach(sel => {
    const currentVal = sel.value;
    sel.innerHTML = `
      <option value="">-- Select Account / Cash --</option>
      ${Array.from(new Set(['Cash', '42441-TJ', 'KC', ...bankAccountsList])).map(acc => `<option value="${acc}">${acc}</option>`).join('')}
    `;
    sel.value = currentVal;
  });

  closeNewAccountModal();

  const user = localStorage.getItem('kk_user') || 'admin';
  const pass = localStorage.getItem('kk_pass') || '';

  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'save_new_account',
        username: user,
        password: pass,
        accountName: name
      })
    });
    alert(`Account "${name}" registered successfully!`);
  } catch (err) {
    alert(`Account "${name}" stored locally!`);
  }
}

async function submitSplitPayment() {
  if (!currentSelectedBillData) {
    alert("Please load a valid Bill Number first.");
    return;
  }

  const rows = document.querySelectorAll('#split-rows-container > div');
  const splitsPayload = [];

  rows.forEach(r => {
    const account = (r.querySelector('.split-account-select')?.value || '').trim();
    const amount = parseFloat(r.querySelector('.split-amount-input')?.value) || 0;
    if (account && amount > 0) {
      splitsPayload.push({ account: account, amount: amount });
    }
  });

  if (splitsPayload.length === 0) {
    alert("Please enter at least one account and amount.");
    return;
  }

  const btnText = getEl('save-split-text');
  if (btnText) btnText.textContent = "Recording to Google Sheets...";

  const user = localStorage.getItem('kk_user') || 'admin';
  const pass = localStorage.getItem('kk_pass') || '';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'save_payment_splits',
        username: user,
        password: pass,
        billNo: currentSelectedBillData.billNo,
        date: currentSelectedBillData.date,
        agent: currentSelectedBillData.agent,
        store: currentSelectedBillData.store,
        splits: splitsPayload
      })
    });

    const result = await response.json();
    if (result.status === 'success') {
      alert(`✅ Bill ${currentSelectedBillData.billNo} payment settlement saved cleanly!`);
      delete globalBillSplitsMap[currentSelectedBillData.billNo];
      splitsPayload.forEach(s => {
        registerBillSplit(currentSelectedBillData.billNo, s.account, s.amount, s.account);
      });
      processData();
    } else {
      alert("Note: Saved locally. " + (result.error || ""));
    }
  } catch (err) {
    splitsPayload.forEach(s => {
      registerBillSplit(currentSelectedBillData.billNo, s.account, s.amount, s.account);
    });
    processData();
    alert(`✅ Recorded locally for Bill ${currentSelectedBillData.billNo}!`);
  } finally {
    if (btnText) btnText.textContent = "Save Settlement to Google Sheet";
  }
}

// -------------------------------------------------------------
// 1. CASHIER WORKSPACE & TOUCHSCREEN POS ENGINE
// -------------------------------------------------------------
function initCashierWorkspace() {
  setText('cashier-current-date-badge', `Shift Date: ${new Date().toLocaleDateString('en-IN')}`);

  const staffSet = new Set();
  staffDirectory.forEach(s => staffSet.add(`${s.name} (${s.empId})`));
  rawData.forEach(r => {
    const sm = r['SM Name'] || r['Agent'];
    if (sm) staffSet.add(sm.toString().trim());
  });

  const dl = getEl('pos-agents-datalist');
  if (dl) {
    dl.innerHTML = Array.from(staffSet).map(s => `<option value="${s}">`).join('');
  }

  const todayStr = new Date().toISOString().split('T')[0];
  cashierShiftRecords = rawData.filter(r => {
    const rawDate = r['Bill Date'] || r['Date'] || r['Invoice Date'];
    return normalizeToDateString(rawDate) === todayStr;
  });
  renderCashierShiftFeed();
}

function setPosPaymentMode(mode, bank) {
  activePosMode = mode;
  activePosBank = bank;

  document.querySelectorAll('.pos-mode-btn').forEach(btn => {
    btn.className = "pos-mode-btn py-3 px-2 rounded-2xl border border-stone-200 bg-white text-stone-700 font-bold text-xs flex flex-col items-center gap-1 active:scale-95 transition-all shadow-sm";
  });

  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.className = "pos-mode-btn py-3 px-2 rounded-2xl border-2 border-[#5C0612] bg-amber-50 text-[#5C0612] font-black text-xs flex flex-col items-center gap-1 active:scale-95 transition-all shadow-sm ring-1 ring-[#5C0612]";
  }

  const splitBox = getEl('pos-split-subcontainer');
  if (mode === 'Split') {
    showEl('pos-split-subcontainer');
    const splitLines = getEl('pos-split-lines');
    if (splitLines && splitLines.children.length === 0) {
      addPosSplitLine('Cash', '');
      addPosSplitLine('42441-TJ', '');
    }
    calculatePosSplits();
  } else {
    hideEl('pos-split-subcontainer');
  }
}

function addPosSplitLine(acc = 'Cash', amt = '') {
  const container = getEl('pos-split-lines');
  if (!container) return;
  const lineId = `pos-split-${Date.now()}-${Math.random().toString(36).substr(2,3)}`;
  const div = document.createElement('div');
  div.id = lineId;
  div.className = "flex items-center gap-2";
  div.innerHTML = `
    <select class="pos-split-acc text-xs font-bold bg-white border border-[#E5D5C6] rounded-xl p-2 flex-1 font-sans">
      <option value="Cash" ${acc === 'Cash' ? 'selected' : ''}>Cash</option>
      <option value="42441-TJ" ${acc === '42441-TJ' ? 'selected' : ''}>42441-TJ (UPI)</option>
      <option value="KC" ${acc === 'KC' ? 'selected' : ''}>KC (Card)</option>
    </select>
    <input type="number" step="any" placeholder="Amount (₹)" value="${amt}" oninput="calculatePosSplits()" class="pos-split-amt w-28 text-xs font-bold font-numeric bg-white border border-[#E5D5C6] rounded-xl p-2 text-[#5C0612]">
    <button type="button" onclick="document.getElementById('${lineId}').remove(); calculatePosSplits();" class="text-stone-400 hover:text-rose-600 p-1">
      <i class="fa-solid fa-trash-can text-xs"></i>
    </button>
  `;
  container.appendChild(div);
  calculatePosSplits();
}

function calculatePosSplits() {
  const totalBillInput = getEl('pos-total-amount');
  const totalBill = totalBillInput ? (parseFloat(totalBillInput.value) || 0) : 0;
  let splitTotal = 0;
  document.querySelectorAll('.pos-split-amt').forEach(inp => splitTotal += parseFloat(inp.value) || 0);

  const rem = totalBill - splitTotal;
  const badge = getEl('pos-split-calc-balance');
  if (badge) {
    if (rem === 0 && totalBill > 0) {
      badge.className = "text-emerald-700 font-bold font-numeric";
      badge.textContent = "Exact Match ✅";
    } else {
      badge.className = "text-rose-700 font-bold font-numeric";
      badge.textContent = `Rem: ₹${rem.toLocaleString('en-IN')}`;
    }
  }
}

function handlePosAmountChange(val) {
  if (activePosMode === 'Split') calculatePosSplits();
}

async function handleCashierTransactionSubmit(e) {
  if (e) e.preventDefault();
  const billNo = (getEl('pos-bill-no')?.value || '').trim();
  const store = getEl('pos-store-name')?.value || 'Main Branch';
  const agent = (getEl('pos-agent-name')?.value || '').trim();
  const itemName = (getEl('pos-item-name')?.value || '').trim() || 'Kalamkari Product';
  const qty = parseInt(getEl('pos-qty')?.value) || 1;
  const amount = parseFloat(getEl('pos-total-amount')?.value) || 0;
  const channel = getEl('pos-channel-type')?.value || 'Offline';

  if (!billNo || amount <= 0 || !agent) {
    alert("Please fill in valid Bill No, Sales Staff ID, and Total Amount.");
    return;
  }

  const splitsPayload = [];
  if (activePosMode === 'Split') {
    document.querySelectorAll('#pos-split-lines > div').forEach(row => {
      const acc = row.querySelector('.pos-split-acc').value;
      const amt = parseFloat(row.querySelector('.pos-split-amt').value) || 0;
      if (amt > 0) splitsPayload.push({ account: acc, amount: amt });
    });
  }

  const submitBtn = getEl('pos-submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Logging Transaction...`;
  }

  const session = checkSession();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'save_pos_transaction',
        username: session.user,
        password: session.pass,
        billNo: billNo,
        store: store,
        agent: agent,
        itemName: itemName,
        qty: qty,
        amount: amount,
        payMode: activePosMode,
        bankAccount: activePosBank,
        channel: channel,
        splits: splitsPayload
      })
    });

    const res = await response.json();
    if (res.status === 'success') {
      alert(`✅ Transaction ${billNo} saved cleanly!`);

      const newRecord = {
        'Bill No': billNo,
        'Bill Date': new Date().toISOString().split('T')[0],
        'Store': store,
        'SM Name': agent,
        'Item Name': itemName,
        'Qty': qty,
        'Final Amount': amount,
        'PayMode': activePosMode,
        'Acc No': activePosBank
      };

      cashierShiftRecords.unshift(newRecord);
      rawData.unshift(newRecord);
      renderCashierShiftFeed();

      if (getEl('pos-bill-no')) getEl('pos-bill-no').value = '';
      if (getEl('pos-total-amount')) getEl('pos-total-amount').value = '';
      if (getEl('pos-item-name')) getEl('pos-item-name').value = '';
    } else {
      alert("Error logging transaction: " + (res.error || "Unknown error"));
    }
  } catch (err) {
    alert("Logged locally in active shift session!");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-check-circle text-base text-[#DAA520]"></i> <span>Save & Log Transaction</span>`;
    }
  }
}

function renderCashierShiftFeed() {
  const tbody = getEl('pos-today-table-body');
  if (!tbody) return;

  let shiftCash = 0, shiftUpi = 0, shiftTotal = 0;

  cashierShiftRecords.forEach(r => {
    const amt = getRowAmount(r);
    const pm = (r['PayMode'] || '').toLowerCase();
    shiftTotal += amt;
    if (pm.includes('cash')) shiftCash += amt;
    else shiftUpi += amt;
  });

  setText('cashier-today-count', `${cashierShiftRecords.length} Bills`);
  setText('cashier-today-cash', `₹${shiftCash.toLocaleString('en-IN')}`);
  setText('cashier-today-upi', `₹${shiftUpi.toLocaleString('en-IN')}`);
  setText('cashier-today-total', `₹${shiftTotal.toLocaleString('en-IN')}`);
  setText('pos-verified-count', `${cashierShiftRecords.length} Entries`);

  if (cashierShiftRecords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-stone-400 font-traditional">No transactions logged in today's active shift yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = cashierShiftRecords.map(r => `
    <tr class="hover:bg-amber-50/20">
      <td class="p-3 font-bold text-stone-800 font-numeric">${getBillNo(r)}</td>
      <td class="p-3 text-stone-700 font-sans font-medium">${r['SM Name'] || r['SMName'] || r['Agent'] || 'No Staff'}</td>
      <td class="p-3 text-stone-600 font-sans">${r['Item Name'] || 'Product'} (x${r['Qty'] || 1})</td>
      <td class="p-3"><span class="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-bold px-2 py-0.5 rounded font-numeric">${r['PayMode'] || 'Cash'}</span></td>
      <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${getRowAmount(r).toLocaleString('en-IN')}</td>
      <td class="p-3 text-center"><span class="text-[9px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded uppercase">Logged ✅</span></td>
    </tr>
  `).join('');
}

// -------------------------------------------------------------
// 2. SALES STAFF / SALES GIRL ISOLATED WORKSPACE
// -------------------------------------------------------------
function initAgentWorkspace() {
  setText('agent-portal-name', currentDisplayName);
  setText('agent-portal-id', `Employee ID: ${currentEmployeeId}`);

  let myTotalSales = 0;
  let myUnitCount = 0;
  const myProductMap = {};
  const myBillsMap = {};

  rawData.forEach(r => {
    const amt = getRowAmount(r);
    const qty = parseInt(r['Qty'] || 1) || 1;
    const item = r['Item Name'] || 'Kalamkari Saree';
    const bNo = getBillNo(r);
    const date = normalizeToDateString(r['Bill Date'] || r['Date'] || r['Invoice Date']);

    myTotalSales += amt;
    myUnitCount += qty;

    if (!myProductMap[item]) myProductMap[item] = { qty: 0, revenue: 0 };
    myProductMap[item].qty += qty;
    myProductMap[item].revenue += amt;

    if (!myBillsMap[bNo]) myBillsMap[bNo] = { billNo: bNo, date: date, amount: 0, items: [] };
    myBillsMap[bNo].amount += amt;
    myBillsMap[bNo].items.push({ item: item, qty: qty, amount: amt });
  });

  const billCount = Object.keys(myBillsMap).length;
  const myUPT = billCount > 0 ? (myUnitCount / billCount) : 0;
  const myATV = billCount > 0 ? (myTotalSales / billCount) : 0;
  const earnedIncentive = Math.round(myTotalSales * (defaultCommissionPct / 100));

  setText('agent-my-sales', `₹${myTotalSales.toLocaleString('en-IN')}`);
  setText('agent-my-incentive', `₹${earnedIncentive.toLocaleString('en-IN')}`);
  setText('agent-my-upt', myUPT.toFixed(1));
  setText('agent-my-atv', `₹${Math.round(myATV).toLocaleString('en-IN')}`);

  renderAgentPersonalAttendance();

  const prodContainer = getEl('agent-product-breakdown');
  if (prodContainer) {
    const sortedProds = Object.entries(myProductMap).sort((a,b) => b[1].revenue - a[1].revenue);
    prodContainer.innerHTML = sortedProds.length === 0 ? `<p class="text-xs text-stone-400 p-3 text-center">No sales logged under your Employee ID yet.</p>` : sortedProds.map(([name, data]) => `
      <div class="flex justify-between items-center bg-[#FAF6EE] p-2.5 rounded-xl border border-[#E5D5C6]">
        <div>
          <strong class="text-xs text-stone-800 font-sans block">${name}</strong>
          <span class="text-[9px] text-stone-500 font-numeric">Quantity Sold: <strong>${data.qty}</strong></span>
        </div>
        <span class="text-xs font-black text-[#5C0612] font-numeric">₹${data.revenue.toLocaleString('en-IN')}</span>
      </div>
    `).join('');
  }

  const billsContainer = getEl('agent-bills-breakdown');
  if (billsContainer) {
    const sortedBills = Object.values(myBillsMap).sort((a,b) => b.amount - a.amount);
    billsContainer.innerHTML = sortedBills.length === 0 ? `<p class="text-xs text-stone-400 p-3 text-center">No bill records found.</p>` : sortedBills.map(b => `
      <div class="flex justify-between items-center bg-[#FAF6EE] p-2.5 rounded-xl border border-[#E5D5C6]">
        <div>
          <span class="text-xs font-bold text-stone-800 font-numeric">${b.billNo}</span>
          <span class="text-[9px] text-stone-500 block font-numeric">${b.date} • ${b.items.length} items</span>
        </div>
        <span class="text-xs font-black text-[#5C0612] font-numeric">₹${b.amount.toLocaleString('en-IN')}</span>
      </div>
    `).join('');
  }
}

function renderAgentPersonalAttendance() {
  const grid = getEl('agent-personal-attendance-grid');
  if (!grid) return;

  const empRecord = rawAttendanceData[0] || {};
  let countP = 0, countHD = 0, countA = 0, countPL = 0;
  const badges = [];
  const notesList = [];

  for (let d = 1; d <= 31; d++) {
    const rawVal = getDayValue(empRecord, d);
    const note = getDayNote(empRecord, d);
    const upperVal = rawVal.toUpperCase().trim();

    let badgeBg = 'bg-stone-50 text-stone-300 border-stone-200';
    let displayText = '-';
    let statusCode = upperVal;

    if (upperVal === 'P' || upperVal === 'WO' || upperVal === 'PRESENT') {
      countP++;
      badgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold';
      displayText = upperVal === 'WO' ? 'WO' : 'P';
      statusCode = 'P';
    } else if (upperVal === 'HD' || upperVal === 'HALF DAY') {
      countHD++;
      badgeBg = 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
      displayText = 'HD';
      statusCode = 'HD';
    } else if (upperVal === 'A' || upperVal === 'ABSENT') {
      countA++;
      badgeBg = 'bg-rose-100 text-rose-800 border-rose-300 font-bold';
      displayText = 'A';
      statusCode = 'A';
    } else if (upperVal === 'PL' || upperVal === 'SL' || upperVal === 'LEAVE') {
      countPL++;
      badgeBg = 'bg-blue-100 text-blue-800 border-blue-300 font-bold';
      displayText = upperVal;
      statusCode = upperVal;
    }

    badges.push(`
      <div class="flex flex-col items-center justify-center border rounded-xl ${badgeBg} text-[8px] py-1.5 font-numeric">
        <span class="text-[7px] text-stone-400 font-normal">D${d}</span>
        <span class="text-[10px] font-black leading-none mt-0.5">${displayText}</span>
      </div>
    `);

    if (note) {
      notesList.push(`<div class="text-[10px] bg-amber-50 p-1.5 rounded-lg border border-amber-200"><strong>Day ${d} (${statusCode}):</strong> ${note}</div>`);
    }
  }

  const payableDays = countP + (countHD * 0.5) + countPL;
  setText('agent-payable-days-badge', `${payableDays} Days Payable (P:${countP} | HD:${countHD} | A:${countA})`);
  grid.innerHTML = badges.join('');

  const notesBox = getEl('agent-leave-notes-container');
  if (notesBox) {
    if (notesList.length > 0) {
      notesBox.classList.remove('hidden');
      setHTML('agent-leave-notes-list', notesList.join(''));
    } else {
      notesBox.classList.add('hidden');
    }
  }
}

function exportAgentPersonalPDF() {
  exportSectionToPDF('agent-view', `Payslip_${currentDisplayName}_${currentEmployeeId}`);
}

// -------------------------------------------------------------
// MODAL & SCREEN CLOSE HANDLERS
// -------------------------------------------------------------
function closeProductDetail() { hideEl('product-detail-card'); }
function closeAgentDetail() { hideEl('agent-detail-card'); }
function closeChannelScreen() { applyState({ view: 'home' }); }
function closeAgentAnalysisScreen() { applyState({ view: 'home' }); }
function openWeeklyScreen() { applyState({ view: 'weekly' }); }
function closeWeeklyScreen() { applyState({ view: 'home' }); }

// -------------------------------------------------------------
// EVENT LISTENERS & DOM BOOTSTRAP
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // 1. Login Form Submission Handler
  const loginForm = getEl('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const user = (getEl('login-username')?.value || '').trim();
      const pass = (getEl('login-password')?.value || '').trim();
      
      const errEl = getEl('login-error');
      if (errEl) errEl.classList.add('hidden');
      
      hideEl('login-btn-text');
      showEl('login-btn-spinner');
      
      await fetchData(user, pass);
    });
  }

  // 2. Date Filter Listeners
  const fromDateEl = getEl('from-date');
  const toDateEl = getEl('to-date');
  if (fromDateEl) fromDateEl.addEventListener('change', processData);
  if (toDateEl) toDateEl.addEventListener('change', processData);

  // 3. Debounced Product Search
  let searchTimer = null;
  const searchInputEl = getEl('product-search');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(processData, 200);
    });
  }

  // 4. Store Filter Dropdown
  const storeFilterEl = getEl('store-filter');
  if (storeFilterEl) storeFilterEl.addEventListener('change', processData);

  // 5. Refresh Button
  const refreshBtn = getEl('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const session = checkSession();
      if (session.valid) fetchData(session.user, session.pass);
    });
  }

  // 6. Cashier POS Form
  const cashierForm = getEl('cashier-pos-form');
  if (cashierForm) {
    cashierForm.addEventListener('submit', handleCashierTransactionSubmit);
  }

  // 7. Automatic Session Verification & Auto-login
  const session = checkSession();
  if (session.valid) {
    fetchData(session.user, session.pass);
  } else {
    showEl('login-screen');
    hideEl('loader');
  }
});