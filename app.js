const API_URL = "https://script.google.com/macros/s/AKfycbwSdvj2seF5EV9onv1GeirtNHBvh2A6r8RJlu1krcNOhXMY92UXWeZduiqUDpbrcG_q/exec";
const SESSION_TIMEOUT = 6 * 60 * 60 * 1000;

let rawData = [];
let rawAttendanceData = [];
let bankAccountsList = [];
let productsList = [];
let agentsList = [];
let selectedAgentDetail = null;
let selectedChannel = "All";
let selectedStore = "All";
let selectedCategory = "All";
let selectedAttendanceMonth = "All";
let activeAnalysisAgent = "";
let isAdmin = false;
let globalBillBankMap = {};
let agentBillsViewMode = 'summary'; // 'summary' or 'detailed'

let currentDaySales = [0, 0, 0, 0, 0, 0, 0];
let prodSortCol = 'qty', prodSortAsc = false;
let agentSortCol = 'revenue', agentSortAsc = false;

let monthlyTarget = parseFloat(localStorage.getItem('kk_monthly_target')) || 1000000;
let defaultCommissionPct = 0.0;

if (history.state === null) history.replaceState({ view: 'home' }, '');
window.addEventListener('popstate', e => applyState(e.state, true));

function exportSectionToPDF(elementId, titleFilename) {
  const element = document.getElementById(elementId);
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

function normalizeToDateString(dateVal) {
  if (!dateVal) return '';
  let strVal = dateVal.toString().trim();
  if (!strVal) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) return strVal;

  const dMmmYyyyMatch = strVal.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})$/);
  if (dMmmYyyyMatch) {
    const day = String(dMmmYyyyMatch[1]).padStart(2, '0');
    const monthStr = dMmmYyyyMatch[2].toLowerCase();
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
    if (
      cleanKey === 'bilno' || 
      cleanKey === 'billno' || 
      cleanKey === 'billnum' || 
      cleanKey === 'billnumber' || 
      cleanKey === 'invoiceno' || 
      cleanKey === 'invoicenumber' || 
      cleanKey === 'docno' || 
      cleanKey === 'voucherno' || 
      cleanKey === 'refno' || 
      cleanKey === 'billcode'
    ) {
      const val = (row[key] || '').toString().trim();
      if (val && val !== '0' && !val.includes('T') && !val.includes('Z') && val.toLowerCase() !== 'null' && val.toLowerCase() !== 'undefined') {
        return val;
      }
    }
  }

  for (let key in row) {
    const cleanKey = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!cleanKey.includes('date') && (cleanKey.includes('bill') || cleanKey.includes('bil') || cleanKey.includes('invoice') || cleanKey.includes('voucher'))) {
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

  const directKeys = [
    'Acc Name', 'AccName', 'Account Name', 'AccountName', 'Acc Name.', 'Account Name.',
    'Bank', 'Bank Name', 'BankName', 'Bank_Name', 'Bank A/c', 'Bank A/c.', 'Bank Account',
    'Bank Account No', 'Bank Account Number', 'Credited Bank', 'Credited Bank Name',
    'Credited Bank Account', 'Bank Details', 'Account', 'Acc No', 'Acc No.', 'AccNo', 'Acc_No', 
    'A/c No', 'A/c No.', 'A/C No', 'A/C No.', 'Ac No', 'Ac No.', 'Account No', 'Account No.', 
    'AccountNo', 'Account_No', 'Deposit Bank', 'Payment Bank', 'Bank / Cash'
  ];

  for (let k of directKeys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') {
      const val = row[k].toString().trim();
      if (val && val !== '0' && val !== '-' && val !== '--' && val.toLowerCase() !== 'null' && val.toLowerCase() !== 'undefined' && val.toLowerCase() !== 'not found' && val.toLowerCase() !== 'not defined') {
        return val;
      }
    }
  }

  for (let key in row) {
    const cleanKey = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      cleanKey === 'accname' ||
      cleanKey === 'accountname' ||
      cleanKey === 'bank' ||
      cleanKey === 'bankname' ||
      cleanKey.includes('bank') ||
      cleanKey.includes('accname') ||
      cleanKey.includes('accountname') ||
      cleanKey === 'accno' ||
      cleanKey === 'acno' ||
      cleanKey === 'accountno'
    ) {
      const val = (row[key] || '').toString().trim();
      if (val && val !== '0' && val !== '-' && val !== '--' && val.toLowerCase() !== 'null' && val.toLowerCase() !== 'undefined' && val.toLowerCase() !== 'not found' && val.toLowerCase() !== 'not defined') {
        return val;
      }
    }
  }
  return 'Not Defined';
}

function getRowBank(row) {
  if (!row || typeof row !== 'object') return 'Not Defined';
  
  const directVal = getRowBankDirect(row);
  if (directVal !== 'Not Defined') return directVal;

  const bNo = getBillNo(row);
  if (bNo && bNo !== 'N/A') {
    if (globalBillBankMap[bNo]) return globalBillBankMap[bNo];
    if (globalBillBankMap[bNo.toLowerCase()]) return globalBillBankMap[bNo.toLowerCase()];
    const cleanKey = bNo.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (globalBillBankMap[cleanKey]) return globalBillBankMap[cleanKey];
  }

  return 'Not Defined';
}

function registerBillBank(billNo, bankName) {
  if (!billNo || billNo === 'N/A' || !bankName || bankName === 'Not Defined') return;
  const strBNo = billNo.toString().trim();
  const strBank = bankName.toString().trim();
  globalBillBankMap[strBNo] = strBank;
  globalBillBankMap[strBNo.toLowerCase()] = strBank;
  globalBillBankMap[strBNo.toLowerCase().replace(/[^a-z0-9]/g, '')] = strBank;
}

function buildGlobalBillBankMap() {
  rawData.forEach(row => {
    const bNo = getBillNo(row);
    const bnk = getRowBankDirect(row);
    if (bNo !== 'N/A' && bnk !== 'Not Defined') {
      registerBillBank(bNo, bnk);
    }
  });
}

function getSalesType(payMode) {
  if (!payMode) return 'Offline';
  const pm = payMode.toString().toLowerCase().trim();
  if (pm.includes('onl') || pm.includes('online') || pm.includes('web')) return 'Online';
  if (pm.includes('by hand') || pm.includes('hand') || pm.includes('wholesale') || pm.includes('take by hand') || pm.includes('takebyhand')) return 'Wholesale';
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

function checkSession() {
  const savedUser = localStorage.getItem('kk_user');
  const savedPass = localStorage.getItem('kk_pass');
  const loginTime = localStorage.getItem('kk_login_time');
  if (!savedUser || !savedPass || !loginTime) return { valid: false };
  if (Date.now() - parseInt(loginTime, 10) > SESSION_TIMEOUT) {
    localStorage.clear();
    return { valid: false };
  }
  const cleanUser = savedUser.trim().toLowerCase();
  isAdmin = cleanUser === 'admin';
  return { valid: true, user: cleanUser, pass: savedPass.trim().toLowerCase() };
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const user = document.getElementById('login-username').value.trim().toLowerCase();
    const pass = document.getElementById('login-password').value.trim().toLowerCase();
    document.getElementById('login-error').classList.add('hidden');
    document.getElementById('login-btn-text').classList.add('hidden');
    document.getElementById('login-btn-spinner').classList.remove('hidden');
    await fetchData(user, pass);
  });
}

function handleLogout() {
  localStorage.clear();
  location.reload();
}

async function fetchData(user, pass) {
  const cleanUser = (user || '').trim().toLowerCase();
  const cleanPass = (pass || '').trim().toLowerCase();

  document.getElementById('loader').classList.remove('hidden');
  document.getElementById('standard-main').classList.add('hidden');
  document.getElementById('login-screen').classList.add('hidden');
  
  try {
    globalBillBankMap = {};

    const url = `${API_URL}?username=${encodeURIComponent(cleanUser)}&password=${encodeURIComponent(cleanPass)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Server status ${response.status}`);
    
    const data = await response.json();
    if (data && data.error) {
      showLoginError(data.error);
      return;
    }

    localStorage.setItem('kk_user', cleanUser);
    localStorage.setItem('kk_pass', cleanPass);
    localStorage.setItem('kk_login_time', Date.now().toString());
    
    isAdmin = cleanUser === 'admin';
    rawData = [];
    rawAttendanceData = [];
    bankAccountsList = Array.isArray(data.banks) ? data.banks : [];

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

    const receivablesSource = data.receivables || data.recievables || data.bank_ledger || [];
    if (Array.isArray(receivablesSource)) {
      receivablesSource.forEach(r => {
        const bNo = getBillNo(r);
        const bnk = getRowBankDirect(r);
        if (bNo && bNo !== 'N/A' && bnk && bnk !== 'Not Defined') {
          registerBillBank(bNo, bnk);
        }
      });
    }

    const targetEl = document.getElementById('target-input-field');
    if (targetEl) targetEl.value = monthlyTarget;

    buildGlobalBillBankMap();
    updateRoleVisibility();
    detectDateRanges();
    detectAndPopulateStores();
    populateBankDropdown();
    populateAttendanceMonthDropdown();
    processData();

    document.getElementById('loader').classList.add('hidden');
    applyState(history.state || { view: 'home' }, true);
  } catch (error) {
    console.error(error);
    showLoginError("Connection failed. Please check credentials.");
  } finally {
    document.getElementById('loader').classList.add('hidden');
  }
}

function detectAndPopulateStores() {
  const storeSelect = document.getElementById('store-filter');
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
  const storeSelect = document.getElementById('store-filter');
  if (storeSelect) {
    storeSelect.value = storeName;
    processData();
  }
}

function populateBankDropdown() {
  const bSelect = document.getElementById('bank-filter-select');
  if (!bSelect) return;

  const bankSet = new Set();
  
  bankAccountsList.forEach(bk => {
    const bStr = (bk || '').toString().trim();
    if (bStr && bStr !== 'Not Defined') bankSet.add(bStr);
  });

  rawData.forEach(row => {
    const bName = getRowBank(row);
    if (bName && bName !== 'Not Defined') {
      bankSet.add(bName);
    }
  });

  Object.values(globalBillBankMap).forEach(bName => {
    if (bName && bName !== 'Not Defined') bankSet.add(bName);
  });

  const currentSelection = bSelect.value || 'All';
  bSelect.innerHTML = `<option value="All">All Bank Accounts</option>`;
  bankSet.forEach(bk => {
    bSelect.innerHTML += `<option value="${bk}">${bk}</option>`;
  });

  if (Array.from(bankSet).includes(currentSelection)) {
    bSelect.value = currentSelection;
  } else {
    bSelect.value = 'All';
  }
}

function populateAttendanceMonthDropdown() {
  const mSelect = document.getElementById('attendance-month-select');
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

function updateRoleVisibility() {
  document.querySelectorAll('.admin-only').forEach(el => {
    if (isAdmin) el.classList.remove('hidden');
    else el.classList.add('hidden');
  });
  if (!isAdmin && document.getElementById('attendance-tab') && !document.getElementById('attendance-tab').classList.contains('hidden')) {
    switchTab('products-tab');
  }
}

function applyState(state, isPopState = false) {
  if (!state) state = { view: 'home' };
  const session = checkSession();
  if (!session.valid) {
    document.getElementById('standard-header').classList.add('hidden');
    document.getElementById('standard-main').classList.add('hidden');
    document.getElementById('channel-view').classList.add('hidden');
    document.getElementById('weekly-view').classList.add('hidden');
    document.getElementById('agent-analysis-view').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('loader').classList.add('hidden');
    return;
  }

  if (state.view === 'weekly' && !isAdmin) {
    applyState({ view: 'home' }, true);
    return;
  }

  document.getElementById('agent-detail-card').classList.add('hidden');
  document.getElementById('product-detail-card').classList.add('hidden');

  document.getElementById('standard-header').classList.remove('hidden');
  document.getElementById('standard-main').classList.add('hidden');
  document.getElementById('channel-view').classList.add('hidden');
  document.getElementById('weekly-view').classList.add('hidden');
  document.getElementById('agent-analysis-view').classList.add('hidden');

  if (state.view === 'home') {
    selectedChannel = 'All';
    document.getElementById('standard-main').classList.remove('hidden');
    if (state.detail === 'agent') {
      selectedAgentDetail = state.name;
      if (populateAgentDetailsDOM(state.name)) {
        document.getElementById('agent-detail-card').classList.remove('hidden');
      }
    } else if (state.detail === 'product') {
      populateProductDetailsDOM(state.name, false);
      document.getElementById('product-detail-card').classList.remove('hidden');
    }
  } else if (state.view === 'channel') {
    selectedChannel = state.channel;
    document.getElementById('channel-view').classList.remove('hidden');
    populateChannelScreenDOM(state.channel);
  } else if (state.view === 'weekly') {
    document.getElementById('weekly-view').classList.remove('hidden');
    populateWeeklyScreenDOM();
  } else if (state.view === 'agent-analysis') {
    document.getElementById('agent-analysis-view').classList.remove('hidden');
    populateAgentAnalysisScreenDOM(state.name);
  }

  if (!isPopState) history.pushState(state, '');
}

function showLoginError(message) {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('loader').classList.add('hidden');
  const errEl = document.getElementById('login-error');
  errEl.textContent = message;
  errEl.classList.remove('hidden');
  document.getElementById('login-btn-text').classList.remove('hidden');
  document.getElementById('login-btn-spinner').classList.add('hidden');
}

function detectDateRanges() {
  if (rawData.length === 0) return;
  const allDates = rawData.map(row => normalizeToDateString(row['Bill Date'])).filter(Boolean).sort();
  if (allDates.length > 0) {
    const maxDateStr = allDates[allDates.length - 1];
    const [yyyy, mm] = maxDateStr.split('-');
    const firstDayOfMonth = `${yyyy}-${mm}-01`;
    
    document.getElementById('from-date').value = firstDayOfMonth;
    document.getElementById('to-date').value = maxDateStr;
  }
}

function setQuickDateRange(preset) {
  if (rawData.length === 0) return;
  const allDates = rawData.map(row => normalizeToDateString(row['Bill Date'])).filter(Boolean).sort();
  const maxDateStr = allDates[allDates.length - 1] || new Date().toISOString().split('T')[0];
  const refDate = new Date(maxDateStr);

  const yyyy = refDate.getFullYear();
  const mm = String(refDate.getMonth() + 1).padStart(2, '0');
  const dd = String(refDate.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  let fromDate = todayStr, toDate = todayStr;

  if (preset === 'yesterday') {
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

  document.getElementById('from-date').value = fromDate;
  document.getElementById('to-date').value = toDate;
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

function processData() {
  const fromDate = document.getElementById('from-date').value;
  const toDate = document.getElementById('to-date').value;
  const searchVal = document.getElementById('product-search').value.toLowerCase();
  
  const storeSelectEl = document.getElementById('store-filter');
  selectedStore = storeSelectEl ? storeSelectEl.value : 'All';

  let storeTotals = {};
  let accountTotals = {}; 

  rawData.forEach(row => {
    if (!row['Bill Date']) return;
    const rDate = normalizeToDateString(row['Bill Date']);
    let dateMatch = true;
    if (fromDate) dateMatch = dateMatch && (rDate >= fromDate);
    if (toDate) dateMatch = dateMatch && (rDate <= toDate);

    if (dateMatch) {
      const amount = parseFloat((row['Final Amount'] || row['FinalAmount'] || row['Total Value'] || row['TotalValue'] || row['BillAmount'] || row['Bill Amount'] || row['Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0;
      const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Kailash Kalamkari').toString().trim();
      storeTotals[storeName] = (storeTotals[storeName] || 0) + amount;
    }
  });

  const filtered = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    let match = true;
    if (fromDate) match = match && (rDate >= fromDate);
    if (toDate) match = match && (rDate <= toDate);
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Kailash Kalamkari').toString().trim();
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
    const amount = parseFloat((row['Final Amount'] || row['FinalAmount'] || row['Total Value'] || row['TotalValue'] || row['BillAmount'] || row['Bill Amount'] || row['Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0;
    const qty = parseInt(row['Qty']) || parseInt(row['QTY']) || 0;
    const item = (row['Item Name'] || row['ItemName'] || 'Unknown Item').toString().trim();
    const agent = (row['SM Name'] || row['SMName'] || row['Agent'] || 'No Agent').toString().trim();
    const payMode = row['PayMode'] || row['Pay Mode'] || row['Paymode'] || row['Sale type'] || row['Sale Type'] || row['Saletype'] || '';
    
    const bankAcc = getRowBank(row);
    const type = getSalesType(payMode);
    
    const rawPm = payMode.toString().toLowerCase();
    const cleanPm = rawPm.replace(/[^a-z0-9]/g, ' ').trim();
    
    const billNo = getBillNo(row);
    const billDate = normalizeToDateString(row['Bill Date']);

    totalSales += amount;
    totalUnits += qty;

    if (bankAcc && bankAcc !== 'Not Defined') {
      accountTotals[bankAcc] = (accountTotals[bankAcc] || 0) + amount;
    }

    if (type === 'Online') totalOnline += amount;
    else if (type === 'Wholesale') totalWholesale += amount;
    else totalOffline += amount;

    if (cleanPm.includes('cash')) payCash += amount;
    else if (cleanPm.includes('card')) payCard += amount;
    else if (cleanPm.includes('hand') || cleanPm.includes('wholesale') || cleanPm.includes('takebyhand')) payHand += amount;
    else if (cleanPm.includes('onl') || cleanPm.includes('online')) payUpiOnline += amount;
    else if (cleanPm.includes('store') || cleanPm.includes('counter') || cleanPm.includes('shop')) payUpiStore += amount;
    else if (cleanPm.includes('upi') || cleanPm.includes('gpay') || cleanPm.includes('phonepe')) {
      if (type === 'Online') payUpiOnline += amount;
      else payUpiStore += amount;
    } else {
      if (type === 'Online') payUpiOnline += amount;
      else payCash += amount;
    }

    const billKey = billNo !== 'N/A' ? billNo : `${billDate}-${amount}`;
    uniqueBills.add(billKey);
    billTotalObj[billKey] = (billTotalObj[billKey] || 0) + amount;

    if (billDate) {
      dailyTotalObj[billDate] = (dailyTotalObj[billDate] || 0) + amount;
      const [yyyy, mm, dd] = billDate.split('-').map(Number);
      const dayOfWeek = new Date(yyyy, mm - 1, dd).getDay();
      currentDaySales[dayOfWeek] += amount;

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

    if (!agentsObj[agent].bills[billKey]) agentsObj[agent].bills[billKey] = { billNo: billNo, date: billDate, amount: 0, bank: bankAcc };
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

  document.getElementById('metric-total').textContent = `₹${totalSales.toLocaleString('en-IN')}`;
  document.getElementById('metric-online').textContent = `₹${totalOnline.toLocaleString('en-IN')}`;
  document.getElementById('metric-offline').textContent = `₹${totalOffline.toLocaleString('en-IN')}`;
  
  const wsEl = document.getElementById('metric-wholesale');
  if (wsEl) wsEl.textContent = `₹${totalWholesale.toLocaleString('en-IN')}`;

  const storeBreakdownContainer = document.getElementById('store-breakdown-container');
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

  const accContainer = document.getElementById('account-split-container');
  if (accContainer) {
    const accEntries = Object.entries(accountTotals).filter(([name, amt]) => amt > 0);
    accContainer.innerHTML = accEntries.length === 0 ? `
      <div class="bg-stone-50 p-2 rounded-xl border border-stone-200 col-span-2 sm:col-span-3">
        <span class="block text-[8px] font-bold text-stone-500 uppercase">General Credit</span>
        <strong class="text-stone-800 text-xs font-numeric">₹${totalSales.toLocaleString('en-IN')}</strong>
      </div>` : accEntries.map(([accName, val]) => `
      <div class="bg-[#FAF6EE] p-2 rounded-xl border border-[#E5D5C6]">
        <span class="block text-[8px] font-bold text-stone-600 uppercase font-traditional truncate">${accName}</span>
        <strong class="text-[#5C0612] text-xs font-black font-numeric">₹${val.toLocaleString('en-IN')}</strong>
      </div>
    `).join('');
  }

  const asp = totalUnits > 0 ? (totalSales / totalUnits) : 0;
  const digitalAmount = payUpiStore + payUpiOnline + payCard;
  const digitalPct = totalSales > 0 ? ((digitalAmount / totalSales) * 100).toFixed(0) : 0;

  document.getElementById('metric-asp').textContent = `₹${Math.round(asp).toLocaleString('en-IN')}`;
  document.getElementById('metric-digital-pct').textContent = `${digitalPct}% Digital`;

  const targetPct = monthlyTarget > 0 ? Math.min(100, (totalSales / monthlyTarget) * 100) : 0;
  document.getElementById('target-percent-text').textContent = `${targetPct.toFixed(1)}%`;
  document.getElementById('target-progress-bar').style.width = `${targetPct}%`;
  document.getElementById('target-achieved-text').textContent = `₹${totalSales.toLocaleString('en-IN')}`;

  const daysCount = Object.keys(dailyTotalObj).length || 1;
  const avgDailySales = totalSales / daysCount;
  const projectedMonthSales = Math.round(avgDailySales * 30);
  const forecastEl = document.getElementById('target-forecast-text');
  if (forecastEl) {
    forecastEl.innerHTML = monthlyTarget > 0 ? `Pacing: <strong class="text-stone-800">₹${Math.round(avgDailySales).toLocaleString('en-IN')}/day</strong> • Projected: <strong class="text-[#5C0612]">₹${projectedMonthSales.toLocaleString('en-IN')}</strong> (${((projectedMonthSales / monthlyTarget) * 100).toFixed(0)}%)` : `Daily Average: <strong>₹${Math.round(avgDailySales).toLocaleString('en-IN')}/day</strong>`;
  }

  document.getElementById('paymode-upi-store').textContent = `₹${payUpiStore.toLocaleString('en-IN')}`;
  document.getElementById('paymode-upi-onl').textContent = `₹${payUpiOnline.toLocaleString('en-IN')}`;
  document.getElementById('paymode-cash').textContent = `₹${payCash.toLocaleString('en-IN')}`;
  document.getElementById('paymode-card').textContent = `₹${payCard.toLocaleString('en-IN')}`;
  document.getElementById('paymode-hand').textContent = `₹${payHand.toLocaleString('en-IN')}`;

  document.getElementById('bucket-small').textContent = `${bucketSmall} Bills`;
  document.getElementById('bucket-medium').textContent = `${bucketMedium} Bills`;
  document.getElementById('bucket-high').textContent = `${bucketHigh} Bills`;

  document.getElementById('peak-sales-date').textContent = peakDate;
  document.getElementById('peak-sales-amount').textContent = `₹${peakVal.toLocaleString('en-IN')}`;

  const totalTransactions = uniqueBills.size;
  document.getElementById('metric-upt').textContent = (totalTransactions > 0 ? (totalUnits / totalTransactions) : 0).toFixed(2);
  document.getElementById('metric-atv').textContent = `₹${Math.round(totalTransactions > 0 ? (totalSales / totalTransactions) : 0).toLocaleString('en-IN')}`;
  document.getElementById('metric-auv').textContent = `₹${Math.round(totalUnits > 0 ? (totalSales / totalUnits) : 0).toLocaleString('en-IN')}`;

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

function filterCategory(cat) {
  selectedCategory = cat;
  ['All', 'Sarees', 'Fabrics', 'Frames'].forEach(c => {
    const btn = document.getElementById(`cat-btn-${c.toLowerCase()}`);
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

  const tbody = document.getElementById('products-table-body');
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
        <div class="font-bold text-[#5C0612] text-xs">₹${p.revenue.toLocaleString('en-IN')}</div>
        <div class="text-[9px] text-[#DAA520] font-bold mt-1 uppercase">${p.share.toFixed(1)}% Share</div>
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

  const tbody = document.getElementById('agents-table-body');
  if (!tbody) return;

  tbody.innerHTML = agentsList.map(a => `
    <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showAgentDetails('${a.name.replace(/'/g, "\\'")}')">
      <td class="p-3.5 font-bold text-stone-700 font-sans">
        <div class="flex justify-between items-center">
          <span>${a.name}</span>
          <span class="text-[9px] text-[#DAA520] font-bold flex items-center gap-1 font-traditional">Ledger <i class="fa-solid fa-chevron-right text-[8px]"></i></span>
        </div>
        <div class="text-[9px] text-stone-500 font-bold mt-1 font-sans">
          Basket (UPT): <strong>${a.upt.toFixed(1)}</strong> • Avg Ticket (ATV): <strong class="text-[#5C0612]">₹${Math.round(a.billCount > 0 ? (a.revenue / a.billCount) : 0).toLocaleString('en-IN')}</strong>
        </div>
      </td>
      <td class="p-3.5 text-right font-extrabold text-[#5C0612] font-sans">₹${a.revenue.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');
}

function renderDayWiseSales(dayWiseObj) {
  const container = document.getElementById('daywise-sales-container');
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
  const selectEl = document.getElementById('bank-filter-select');
  const selectedBank = selectEl ? selectEl.value : 'All';
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;

  const tbody = document.getElementById('bank-ledger-tbody');
  const totalEl = document.getElementById('bank-selected-total');
  const countEl = document.getElementById('bank-bills-count');
  if (!tbody) return;

  const filteredBills = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    if (fromVal && rDate < fromVal) return false;
    if (toVal && rDate > toVal) return false;
    
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Kailash Kalamkari').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) return false;

    const bAcc = getRowBank(row).trim();
    if (selectedBank !== 'All') {
      const sBank = selectedBank.trim().toLowerCase();
      const rowB = bAcc.toLowerCase();
      if (rowB !== sBank && !rowB.includes(sBank) && !sBank.includes(rowB)) return false;
    }
    return true;
  });

  let totalBankAmount = 0;
  const uniqueBillMap = {};

  filteredBills.forEach(r => {
    const amt = parseFloat((r['Final Amount'] || r['FinalAmount'] || r['Total Value'] || r['TotalValue'] || r['BillAmount'] || r['Bill Amount'] || r['Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0;
    const bNo = getBillNo(r);
    const bDate = normalizeToDateString(r['Bill Date']);
    const store = r['Store'] || r['Shop'] || r['Branch Name'] || r['Branch'] || 'Shop 1';
    const agent = r['SM Name'] || r['Agent'] || 'No Agent';
    const bankName = getRowBank(r);

    const key = `${bNo}-${bDate}-${amt}`;
    if (!uniqueBillMap[key]) {
      uniqueBillMap[key] = { date: bDate, billNo: bNo, store: store, agent: agent, bank: bankName, amount: amt };
      totalBankAmount += amt;
    }
  });

  const billList = Object.values(uniqueBillMap).sort((a, b) => b.date.localeCompare(a.date));

  if (totalEl) totalEl.textContent = `₹${totalBankAmount.toLocaleString('en-IN')}`;
  if (countEl) countEl.textContent = `${billList.length} Bills`;

  tbody.innerHTML = billList.length === 0 ? `
    <tr><td colspan="6" class="p-6 text-center text-stone-400 font-traditional">No bank credit records found for this selection</td></tr>
  ` : billList.map(b => `
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
  const selectEl = document.getElementById('bank-filter-select');
  const selectedBank = selectEl ? selectEl.value : 'All';
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;

  const statementData = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    if (fromVal && rDate < fromVal) return false;
    if (toVal && rDate > toVal) return false;
    const bAcc = getRowBank(row);
    if (selectedBank !== 'All' && bAcc.toLowerCase() !== selectedBank.toLowerCase()) return false;
    return true;
  }).map(r => ({
    "Bill Date": normalizeToDateString(r['Bill Date']),
    "Bill No": getBillNo(r),
    "Store / Branch": r['Store'] || r['Shop'] || r['Branch Name'] || r['Branch'] || 'Main Branch',
    "Item Name": r['Item Name'] || '',
    "Staff Name": r['SM Name'] || 'No Agent',
    "Credited Bank Account": getRowBank(r),
    "Payment Mode": r['PayMode'] || r['Pay Mode'] || r['Sale type'] || r['Sale Type'] || '',
    "Bill Amount": parseFloat((r['Final Amount'] || r['FinalAmount'] || r['Total Value'] || r['TotalValue'] || r['BillAmount'] || r['Bill Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(statementData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Bank Statement");
  XLSX.writeFile(workbook, `Kailash_BankStatement_${selectedBank.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

function filterAttendanceMonth(mSheet) {
  selectedAttendanceMonth = mSheet;
  renderAttendanceSalaryModule(parseFloat((document.getElementById('metric-total').textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
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

  const possibleKeys = [dStr, dPad, 'D' + dStr, 'D' + dPad, 'Day ' + dStr, 'Day ' + dPad];

  for (let key of possibleKeys) {
    if (notesMap[key]) return notesMap[key].toString().trim();
  }
  return '';
}

function renderAttendanceSalaryModule(storeRevenue = 0) {
  if (!isAdmin) return; 
  const container = document.getElementById('staff-salary-list');
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

  document.getElementById('payroll-staff-count').textContent = staffData.length;
  document.getElementById('profit-store-sales').textContent = `₹${storeRevenue.toLocaleString('en-IN')}`;

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
      if (!displayNote && rawVal.length > 3) {
        displayNote = rawVal;
      }

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

      <!-- 31-Day Complete Visual Attendance Grid -->
      <div class="space-y-1">
        <div class="flex justify-between items-center">
          <span class="text-[9px] font-bold uppercase text-stone-500 font-traditional">31-Day Attendance Grid (${payableDays} Days Payable)</span>
          <span class="text-[8px] font-bold text-stone-600 font-numeric">P:${countP} | HD:${countHD} | A:${countA} | PL:${countPL}</span>
        </div>
        <div class="grid grid-cols-7 sm:grid-cols-11 gap-1 pt-1">
          ${gridDayBadges.join('')}
        </div>
      </div>

      <!-- Recorded Leave Reasons Section -->
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

  const payTotalEl = document.getElementById('payroll-total-amount');
  if (payTotalEl) payTotalEl.textContent = `₹${totalStorePayroll.toLocaleString('en-IN')}`;

  const grossProfitEl = document.getElementById('profit-gross-amount');
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
  renderAttendanceSalaryModule(parseFloat((document.getElementById('metric-total').textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
}

function updateGlobalCommission(val) {
  if (!isAdmin) return;
  defaultCommissionPct = parseFloat(val) || 0;
  rawAttendanceData.forEach(emp => { emp['Commission Pct'] = defaultCommissionPct; });
  renderAttendanceSalaryModule(parseFloat((document.getElementById('metric-total').textContent || '0').replace(/[^0-9.-]+/g,"")) || 0);
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
    if (document.getElementById('temp-payslip-pdf')) {
      document.body.removeChild(payslipContainer);
    }
  });
}

function shareAllPayslipsWhatsApp() {
  if (!isAdmin) return;
  const modal = document.getElementById('whatsapp-bulk-modal');
  const container = document.getElementById('whatsapp-bulk-list');
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
  const modal = document.getElementById('whatsapp-bulk-modal');
  if (modal) modal.classList.add('hidden');
}

function shareOwnerDailySummaryWhatsApp() {
  if (!isAdmin) return;
  const fromVal = document.getElementById('from-date').value || 'Start';
  const toVal = document.getElementById('to-date').value || 'End';
  const totalSalesText = document.getElementById('metric-total').textContent || '₹0';
  const onlineSalesText = document.getElementById('metric-online').textContent || '₹0';
  const offlineSalesText = document.getElementById('metric-offline').textContent || '₹0';
  const wholesaleSalesText = document.getElementById('metric-wholesale').textContent || '₹0';

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
  if (!isAdmin) return;
  if (typeof XLSX === 'undefined') {
    alert("Excel library loading or unavailable.");
    return;
  }
  const workbook = XLSX.utils.book_new();
  const salesSheetData = rawData.map(r => ({
    "Date": normalizeToDateString(r['Bill Date']),
    "Store/Shop": r['Store'] || r['Shop'] || r['Branch Name'] || r['Branch'] || 'Shop 1',
    "Bill No": getBillNo(r),
    "Staff Name": r['SM Name'] || 'No Agent',
    "Item Name": r['Item Name'] || '',
    "Category": getItemCategory(r['Item Name']),
    "Qty": parseInt(r['Qty']) || 0,
    "Amount": parseFloat((r['Final Amount'] || r['FinalAmount'] || r['Total Value'] || r['TotalValue'] || r['BillAmount'] || r['Bill Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0,
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
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ 
        username: user, 
        password: pass, 
        records: rawAttendanceData, 
        monthSheet: selectedAttendanceMonth 
      })
    });
    const res = await response.json();
    if (res.status === 'success') alert("✅ Saved to Google Sheets!");
    else alert("Error saving: " + (res.error || "Unknown error"));
  } catch (err) {
    alert("Saved locally in session!");
  }
}

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
  const titleEl = document.getElementById('detail-product-name');
  if (titleEl) titleEl.textContent = productName;
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;

  const agentStats = {};
  rawData.forEach(row => {
    if (!row['Bill Date']) return;
    const rDate = normalizeToDateString(row['Bill Date']);
    if (fromVal && rDate < fromVal) return;
    if (toVal && rDate > toVal) return;
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Kailash Kalamkari').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) return;

    if ((row['Item Name'] || row['ItemName']) !== productName) return;

    const agent = row['SM Name'] || row['SMName'] || 'No Agent';
    const amount = parseFloat((row['Final Amount'] || row['FinalAmount'] || row['Total Value'] || row['TotalValue'] || row['BillAmount'] || row['Bill Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0;
    const type = getSalesType(row['PayMode'] || row['Pay Mode'] || row['Sale type'] || row['Sale Type']);

    if (!agentStats[agent]) agentStats[agent] = { online: 0, offline: 0, wholesale: 0, total: 0 };
    if (type === 'Online') agentStats[agent].online += amount;
    else if (type === 'Wholesale') agentStats[agent].wholesale += amount;
    else agentStats[agent].offline += amount;
    agentStats[agent].total += amount;
  });

  const sortedAgents = Object.entries(agentStats).sort((a, b) => b[1].total - a[1].total);
  const tbody = document.getElementById('product-detail-table-body');
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
  const prodView = document.getElementById('agent-detail-product-view');
  const billView = document.getElementById('agent-detail-bill-view');
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

  document.getElementById('detail-agent-name').textContent = `${agentObj.name} Ledger`;
  const sortedItems = Object.entries(agentObj.items).sort((a, b) => b[1].qty - a[1].qty);
  document.getElementById('agent-detail-table-body').innerHTML = sortedItems.map(([itemName, values]) => `
    <tr class="hover:bg-amber-50/20 transition-colors">
      <td class="p-2.5 font-semibold text-stone-700">${itemName}</td>
      <td class="p-2.5 text-center font-bold text-stone-500">${values.qty}</td>
      <td class="p-2.5 text-right font-extrabold text-[#5C0612]">₹${values.revenue.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');

  const sortedBills = Object.values(agentObj.bills).sort((a, b) => b.amount - a.amount);
  document.getElementById('agent-detail-bill-table-body').innerHTML = sortedBills.map(b => `
    <tr class="hover:bg-amber-50/20 transition-colors">
      <td class="p-2.5 font-semibold text-stone-700">${b.date || 'N/A'}</td>
      <td class="p-2.5 text-center font-bold text-stone-500">${b.billNo || 'N/A'}</td>
      <td class="p-2.5 text-center"><span class="bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-bold px-2 py-0.5 rounded font-numeric">${b.bank || 'Not Defined'}</span></td>
      <td class="p-2.5 text-right font-extrabold text-[#5C0612]">₹${b.amount.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');

  toggleAgentDetailView('product');
  return true;
}

function populateChannelScreenDOM(channel) {
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;
  const filtered = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    let match = true;
    if (fromVal) match = match && (rDate >= fromVal);
    if (toVal) match = match && (rDate <= toVal);
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Kailash Kalamkari').toString().trim();
    if (selectedStore !== 'All' && storeName.toLowerCase() !== selectedStore.toLowerCase()) match = false;

    return match && (getSalesType(row['PayMode'] || row['Pay Mode'] || row['Sale type'] || row['Sale Type']) === channel);
  });

  let totalChannelRevenue = 0;
  const agentsObj = {}, productsObj = {};

  filtered.forEach(row => {
    const amount = parseFloat((row['Final Amount'] || row['FinalAmount'] || row['Total Value'] || row['TotalValue'] || row['BillAmount'] || row['Bill Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0;
    const qty = parseInt(row['Qty']) || parseInt(row['QTY']) || 0;
    const item = row['Item Name'] || 'Unknown Item';
    const agent = row['SM Name'] || 'No Agent';

    totalChannelRevenue += amount;
    agentsObj[agent] = (agentsObj[agent] || 0) + amount;
    if (!productsObj[item]) productsObj[item] = { qty: 0, revenue: 0 };
    productsObj[item].qty += qty;
    productsObj[item].revenue += amount;
  });

  document.getElementById('channel-view-total').textContent = `₹${totalChannelRevenue.toLocaleString('en-IN')}`;

  const agentTable = document.getElementById('channel-agents-table');
  if (agentTable) {
    const sortedA = Object.entries(agentsObj).sort((a, b) => b[1] - a[1]);
    agentTable.innerHTML = sortedA.length === 0 ? `<tr><td colspan="2" class="p-4 text-center text-stone-400">No record</td></tr>` : sortedA.map(([aName, amt]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700">${aName}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${amt.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  const prodTable = document.getElementById('channel-products-table');
  if (prodTable) {
    const sortedP = Object.entries(productsObj).sort((a, b) => b[1].revenue - a[1].revenue);
    prodTable.innerHTML = sortedP.length === 0 ? `<tr><td colspan="3" class="p-4 text-center text-stone-400">No record</td></tr>` : sortedP.map(([pName, pObj]) => `
      <tr class="hover:bg-amber-50/20">
        <td class="p-3 font-bold text-stone-700">${pName}</td>
        <td class="p-3 text-center font-bold text-stone-600 font-numeric">${pObj.qty}</td>
        <td class="p-3 text-right font-black text-[#5C0612] font-numeric">₹${pObj.revenue.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

function populateWeeklyScreenDOM() { renderWeeklyDistributionDOM(); }

function renderWeeklyDistributionDOM() {
  const container = document.getElementById('weekly-distribution-bars');
  if (!container) return;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const totalWeeklySales = currentDaySales.reduce((a, b) => a + b, 0);

  container.innerHTML = dayNames.map((day, idx) => {
    const amount = currentDaySales[idx] || 0;
    const pct = totalWeeklySales > 0 ? (amount / totalWeeklySales) * 100 : 0;
    return `
      <div class="space-y-1">
        <div class="flex justify-between items-center text-xs font-semibold text-stone-700">
          <span>${day}</span>
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
  
  const sumBtn = document.getElementById('btn-agent-mode-summary');
  const detBtn = document.getElementById('btn-agent-mode-detailed');
  
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
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;
  
  const titleEl = document.getElementById('agent-analysis-title');
  const subEl = document.getElementById('agent-analysis-subtitle');
  if (titleEl) titleEl.textContent = `${agentName} Ledger`;
  if (subEl) subEl.textContent = `Period: ${fromVal || 'Start'} to ${toVal || 'End'}`;

  const filtered = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    let match = true;
    if (fromVal) match = match && (rDate >= fromVal);
    if (toVal) match = match && (rDate <= toVal);
    
    const storeName = (row['Store'] || row['Shop'] || row['Branch Name'] || row['Branch'] || row['Location'] || row['Store Name'] || 'Kailash Kalamkari').toString().trim();
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
    const date = normalizeToDateString(row['Bill Date']);
    const amount = parseFloat((row['Final Amount'] || row['FinalAmount'] || row['Total Value'] || row['TotalValue'] || row['BillAmount'] || row['Bill Amount'] || row['Amount'] || '0').toString().replace(/[^0-9.-]+/g,"")) || 0;
    const qty = parseInt(row['Qty']) || parseInt(row['QTY']) || 0;
    const item = row['Item Name'] || row['ItemName'] || 'Unknown Item';
    const payMode = row['PayMode'] || row['Pay Mode'] || row['Paymode'] || row['Sale type'] || row['Sale Type'] || '';
    const bankAcc = getRowBank(row);
    const channel = getSalesType(payMode);
    const billNo = getBillNo(row);

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

  const revEl = document.getElementById('agent-analysis-total-revenue');
  const onlEl = document.getElementById('agent-analysis-online-sales');
  const offEl = document.getElementById('agent-analysis-offline-sales');
  const handEl = document.getElementById('agent-analysis-takebyhand-sales');

  if (revEl) revEl.textContent = `₹${totalAgentRevenue.toLocaleString('en-IN')}`;
  if (onlEl) onlEl.textContent = `₹${totalOnlineSales.toLocaleString('en-IN')}`;
  if (offEl) offEl.textContent = `₹${totalOfflineSales.toLocaleString('en-IN')}`;
  if (handEl) handEl.textContent = `₹${totalTakebyhandSales.toLocaleString('en-IN')}`;

  const agentBillCount = Object.keys(dailyGroup).reduce((acc, date) => acc + Object.keys(dailyGroup[date].bills).length, 0);
  const agentATV = agentBillCount > 0 ? (totalAgentRevenue / agentBillCount) : 0;
  const agentAUV = totalAgentUnits > 0 ? (totalAgentRevenue / totalAgentUnits) : 0;
  
  const atvEl = document.getElementById('agent-analysis-atv');
  const auvEl = document.getElementById('agent-analysis-auv');
  if (atvEl) atvEl.textContent = `₹${Math.round(agentATV).toLocaleString('en-IN')}`;
  if (auvEl) auvEl.textContent = `₹${Math.round(agentAUV).toLocaleString('en-IN')}`;

  const sortedProductSales = Object.values(productSales).map(p => {
    p.percent = totalAgentRevenue > 0 ? (p.revenue / totalAgentRevenue) * 100 : 0;
    return p;
  }).sort((a, b) => b.revenue - a.revenue);

  const productShareContainer = document.getElementById('agent-analysis-product-share');
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
  const dailyListContainer = document.getElementById('agent-analysis-daily-list');
  
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
                  <th class="p-2 font-traditional">Bank A/C</th>
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
  const revEl = document.getElementById('agent-analysis-total-revenue');
  let msg = `🌸 *KAILASH KALAMKARI - STAFF PERFORMANCE* 🌸\n\n👤 *Staff Member:* ${activeAnalysisAgent}\n💰 *Total Sales Revenue:* ${revEl ? revEl.textContent : '₹0'}\n`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.remove('hidden');

  document.getElementById('btn-products-tab').className = tabId === 'products-tab' 
    ? "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional"
    : "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional";

  document.getElementById('btn-agents-tab').className = tabId === 'agents-tab' 
    ? "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-[#5C0612] text-[#EFE5C9] shadow-sm font-traditional"
    : "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional";

  document.getElementById('btn-daywise-tab').className = tabId === 'daywise-tab' 
    ? "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional"
    : "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional";

  const bankBtn = document.getElementById('btn-banks-tab');
  if (bankBtn) {
    bankBtn.className = tabId === 'banks-tab' 
      ? "flex-1 min-w-[110px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional flex items-center justify-center gap-1"
      : "flex-1 min-w-[110px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional flex items-center justify-center gap-1";
  }

  const attBtn = document.getElementById('btn-attendance-tab');
  if (attBtn) {
    attBtn.className = tabId === 'attendance-tab' 
      ? "flex-1 min-w-[110px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional flex items-center justify-center gap-1"
      : "flex-1 min-w-[110px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional flex items-center justify-center gap-1";
  }
}

function closeProductDetail() { document.getElementById('product-detail-card').classList.add('hidden'); }
function closeAgentDetail() { document.getElementById('agent-detail-card').classList.add('hidden'); }
function closeChannelScreen() { applyState({ view: 'home' }); }
function closeAgentAnalysisScreen() { applyState({ view: 'home' }); }
function openWeeklyScreen() { applyState({ view: 'weekly' }); }
function closeWeeklyScreen() { applyState({ view: 'home' }); }

document.getElementById('from-date').addEventListener('change', processData);
document.getElementById('to-date').addEventListener('change', processData);
document.getElementById('product-search').addEventListener('input', processData);

const storeFilter = document.getElementById('store-filter');
if (storeFilter) storeFilter.addEventListener('change', processData);

document.getElementById('refresh-btn').addEventListener('click', () => {
  const session = checkSession();
  if (session.valid) fetchData(session.user, session.pass);
});

const session = checkSession();
if (session.valid) fetchData(session.user, session.pass);
else document.getElementById('login-screen').classList.remove('hidden');