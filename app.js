const API_URL = "https://script.google.com/macros/s/AKfycbz2o4Oex6mVE3gep-7-iVK6xlmvzMjAaFy_mYheIufrZeC1exERMuQ5GP5riF5Wn-Q/exec"; 
const SESSION_TIMEOUT = 6 * 60 * 60 * 1000;

let rawData = [];
let rawAttendanceData = [];
let productsList = [];
let agentsList = [];
let selectedAgentDetail = null;
let selectedChannel = "All";
let selectedCategory = "All";
let activeAnalysisAgent = "";
let isAdmin = false;

let currentChannelAgents = {}; 
let currentDaySales = [0, 0, 0, 0, 0, 0, 0];

let prodSortCol = 'qty';
let prodSortAsc = false;
let agentSortCol = 'revenue';
let agentSortAsc = false;

let monthlyTarget = parseFloat(localStorage.getItem('kk_monthly_target')) || 1000000;
let defaultCommissionPct = 0.0; 

if (history.state === null) {
  history.replaceState({ view: 'home' }, '');
}

window.addEventListener('popstate', function(e) {
  applyState(e.state, true);
});

// UNIVERSAL PDF EXPORT ENGINE FOR ALL SECTIONS
function exportSectionToPDF(elementId, titleFilename) {
  const element = document.getElementById(elementId);
  if (!element || typeof html2pdf === 'undefined') {
    alert("PDF Engine is loading or view element was not found.");
    return;
  }

  // Temporarily hide interactive buttons during PDF generation
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
  const strVal = dateVal.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(strVal)) return strVal;
  const parsed = new Date(strVal);
  if (!isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (strVal.includes('T')) return strVal.split('T')[0];
  return strVal;
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

  if (name.includes('frame') || name.includes('painting') || name.includes('art') || name.includes('photo') || name.includes('wall') || name.includes('canvas') || name.includes('wood') || name.includes('chitra') || name.includes('picchwai') || name.includes('glass')) {
    return 'Frames';
  }

  if (name.includes('saree') || name.includes('sari') || name.includes('silk') || name.includes('pattu') || name.includes('kanchi') || name.includes('tussar') || name.includes('soft') || name.includes('organza') || name.includes('georgette') || name.includes('kota') || name.includes('linen') || name.includes('handloom') || name.includes('chanderi')) {
    return 'Sarees';
  }

  if (name.includes('fabric') || name.includes('meter') || name.includes('running') || name.includes('print') || name.includes('blouse') || name.includes('material') || name.includes('cotton') || name.includes('dupatta') || name.includes('stole') || name.includes('dress') || name.includes('suit') || name.includes('kurti')) {
    return 'Fabrics';
  }

  return 'General';
}

function checkSession() {
  const savedUser = localStorage.getItem('kk_user');
  const savedPass = localStorage.getItem('kk_pass');
  const loginTime = localStorage.getItem('kk_login_time');
  
  if (!savedUser || !savedPass || !loginTime) return { valid: false, reason: 'none' };
  
  const now = Date.now();
  if (now - parseInt(loginTime, 10) > SESSION_TIMEOUT) {
    localStorage.removeItem('kk_user');
    localStorage.removeItem('kk_pass');
    localStorage.removeItem('kk_login_time');
    return { valid: false, reason: 'expired' };
  }
  
  const cleanUser = savedUser.trim().toLowerCase();
  const cleanPass = savedPass.trim().toLowerCase();
  isAdmin = cleanUser === 'admin';
  return { valid: true, user: cleanUser, pass: cleanPass };
}

document.getElementById('login-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const user = document.getElementById('login-username').value.trim().toLowerCase();
  const pass = document.getElementById('login-password').value.trim().toLowerCase();
  
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('login-btn-text').classList.add('hidden');
  document.getElementById('login-btn-spinner').classList.remove('hidden');
  
  await fetchData(user, pass);
});

function handleLogout() {
  localStorage.removeItem('kk_user');
  localStorage.removeItem('kk_pass');
  localStorage.removeItem('kk_login_time');
  location.reload();
}

async function fetchData(user, pass) {
  const cleanUser = (user || '').trim().toLowerCase();
  const cleanPass = (pass || '').trim().toLowerCase();

  document.getElementById('loader').classList.remove('hidden');
  document.getElementById('standard-main').classList.add('hidden');
  document.getElementById('channel-view').classList.add('hidden');
  document.getElementById('weekly-view').classList.add('hidden');
  document.getElementById('agent-analysis-view').classList.add('hidden');
  document.getElementById('login-screen').classList.add('hidden');
  
  try {
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
    
    if (Array.isArray(data)) {
      rawData = data;
      rawAttendanceData = [];
    } else {
      rawData = data.sales || [];
      rawAttendanceData = Array.isArray(data.attendance) ? data.attendance : [];
    }

    const targetEl = document.getElementById('target-input-field');
    if (targetEl) targetEl.value = monthlyTarget;

    updateRoleVisibility();
    detectDateRanges();
    processData();

    document.getElementById('loader').classList.add('hidden');
    applyState(history.state || { view: 'home' }, true);
  } catch (error) {
    console.error(error);
    showLoginError("Connection failed. Please check username/password or permissions.");
  }
}

// STRICT ROLE VISIBILITY ENFORCER (ADMIN VS NON-ADMIN)
function updateRoleVisibility() {
  const adminOnlyElements = document.querySelectorAll('.admin-only');
  adminOnlyElements.forEach(el => {
    if (isAdmin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  if (!isAdmin) {
    const isAttendanceActive = !document.getElementById('attendance-tab').classList.contains('hidden');
    if (isAttendanceActive) switchTab('products-tab');
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
        document.getElementById('agent-detail-card').scrollIntoView({ behavior: 'smooth' });
      }
    } else if (state.detail === 'product') {
      populateProductDetailsDOM(state.name, false);
      document.getElementById('product-detail-card').classList.remove('hidden');
      document.getElementById('product-detail-card').scrollIntoView({ behavior: 'smooth' });
    } else {
      selectedAgentDetail = null;
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
  localStorage.removeItem('kk_user');
  localStorage.removeItem('kk_pass');
  localStorage.removeItem('kk_login_time');
}

function detectDateRanges() {
  if (rawData.length === 0) return;
  const dates = rawData.map(row => normalizeToDateString(row['Bill Date'])).filter(Boolean).sort();
  if (dates.length > 0) {
    document.getElementById('from-date').value = dates[0];
    document.getElementById('to-date').value = dates[dates.length - 1];
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

  let fromDate = todayStr;
  let toDate = todayStr;

  if (preset === 'today') {
    fromDate = todayStr;
    toDate = todayStr;
  } else if (preset === 'yesterday') {
    const yest = new Date(refDate);
    yest.setDate(refDate.getDate() - 1);
    const yYyyy = yest.getFullYear();
    const yMm = String(yest.getMonth() + 1).padStart(2, '0');
    const yDd = String(yest.getDate()).padStart(2, '0');
    fromDate = `${yYyyy}-${yMm}-${yDd}`;
    toDate = fromDate;
  } else if (preset === 'week') {
    const day = refDate.getDay();
    const diff = refDate.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(refDate);
    startOfWeek.setDate(diff);
    const sYyyy = startOfWeek.getFullYear();
    const sMm = String(startOfWeek.getMonth() + 1).padStart(2, '0');
    const sDd = String(startOfWeek.getDate()).padStart(2, '0');
    fromDate = `${sYyyy}-${sMm}-${sDd}`;
    toDate = todayStr;
  } else if (preset === 'month') {
    fromDate = `${yyyy}-${mm}-01`;
    toDate = todayStr;
  } else if (preset === 'lastmonth') {
    const prevMonth = new Date(refDate.getFullYear(), refDate.getMonth() - 1, 1);
    const lastDayPrevMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 0);
    const pYyyy = prevMonth.getFullYear();
    const pMm = String(prevMonth.getMonth() + 1).padStart(2, '0');
    const pEndDd = String(lastDayPrevMonth.getDate()).padStart(2, '0');
    fromDate = `${pYyyy}-${pMm}-01`;
    toDate = `${pYyyy}-${pMm}-${pEndDd}`;
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

  let match = agentsList.find(a => {
    const agentName = (a && a.name !== undefined && a.name !== null) ? a.name.toString() : '';
    return agentName.toLowerCase().replace(/\s+/g, '').trim() === cleanEmp;
  });
  if (match) return match.revenue;

  match = agentsList.find(a => {
    const agentName = (a && a.name !== undefined && a.name !== null) ? a.name.toString() : '';
    const cleanAgent = agentName.toLowerCase().replace(/\s+/g, '').trim();
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

function processData() {
  const fromDate = document.getElementById('from-date').value;
  const toDate = document.getElementById('to-date').value;
  const searchVal = document.getElementById('product-search').value.toLowerCase();

  const filtered = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    let match = true;
    if (fromDate) match = match && (rDate >= fromDate);
    if (toDate) match = match && (rDate <= toDate);
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
    const amount = parseFloat(row['BillAmount']) || parseFloat(row['Bill Amount']) || parseFloat(row['Amount']) || 0;
    const qty = parseInt(row['Qty']) || parseInt(row['QTY']) || 0;
    const item = (row['Item Name'] || row['ItemName'] || 'Unknown Item').toString().trim();
    const agent = (row['SM Name'] || row['SMName'] || row['Agent'] || 'No Agent').toString().trim();
    const payMode = row['PayMode'] || row['Pay Mode'] || row['Paymode'] || '';
    const type = getSalesType(payMode);
    
    const rawPm = payMode.toString().toLowerCase();
    const cleanPm = rawPm.replace(/[^a-z0-9]/g, ' ').trim();
    
    const billNo = row['Bill No'] || row['Bill No.'] || row['BillNo'] || row['Invoice No'] || 'N/A';
    const billDate = normalizeToDateString(row['Bill Date']);

    totalSales += amount;
    totalUnits += qty;

    if (type === 'Online') totalOnline += amount;
    else if (type === 'Wholesale') totalWholesale += amount;
    else totalOffline += amount;

    if (cleanPm.includes('cash')) {
      payCash += amount;
    } else if (cleanPm.includes('card')) {
      payCard += amount;
    } else if (cleanPm.includes('hand') || cleanPm.includes('wholesale') || cleanPm.includes('takebyhand') || cleanPm.includes('credit')) {
      payHand += amount;
    } else if (cleanPm.includes('onl') || cleanPm.includes('online') || cleanPm.includes('web') || cleanPm.includes('site')) {
      payUpiOnline += amount;
    } else if (cleanPm.includes('store') || cleanPm.includes('qr') || cleanPm.includes('counter') || cleanPm.includes('shop') || cleanPm.includes('pos')) {
      payUpiStore += amount;
    } else if (cleanPm.includes('upi') || cleanPm.includes('gpay') || cleanPm.includes('phonepe') || cleanPm.includes('paytm') || cleanPm.includes('bhim') || cleanPm.includes('scan')) {
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

    if (!agentsObj[agent].bills[billKey]) agentsObj[agent].bills[billKey] = { billNo: billNo, date: billDate, amount: 0 };
    agentsObj[agent].bills[billKey].amount += amount;
  });

  // UPDATED TICKET BUCKETS (< ₹10K, ₹10K - ₹1 Lakh, > ₹1 Lakh)
  Object.values(billTotalObj).forEach(val => {
    if (val < 10000) bucketSmall++;           // Under ₹10,000 (Small)
    else if (val <= 100000) bucketMedium++;   // ₹10,000 to ₹1 Lakh (Medium)
    else bucketHigh++;                        // Above ₹1 Lakh (High)
  });

  let peakDate = "N/A", peakVal = 0;
  Object.entries(dailyTotalObj).forEach(([d, val]) => {
    if (val > peakVal) { peakVal = val; peakDate = d; }
  });

  document.getElementById('metric-total').textContent = `₹${totalSales.toLocaleString('en-IN')}`;
  document.getElementById('metric-online').textContent = `₹${totalOnline.toLocaleString('en-IN')}`;
  document.getElementById('metric-offline').textContent = `₹${totalOffline.toLocaleString('en-IN')}`;
  document.getElementById('metric-wholesale').textContent = `₹${totalWholesale.toLocaleString('en-IN')}`;

  // Retail Apparel KPIs (ASP & Digital adoption)
  const asp = totalUnits > 0 ? (totalSales / totalUnits) : 0;
  const digitalAmount = payUpiStore + payUpiOnline + payCard;
  const digitalPct = totalSales > 0 ? ((digitalAmount / totalSales) * 100).toFixed(0) : 0;

  const aspEl = document.getElementById('metric-asp');
  const digEl = document.getElementById('metric-digital-pct');
  if (aspEl) aspEl.textContent = `₹${Math.round(asp).toLocaleString('en-IN')}`;
  if (digEl) digEl.textContent = `${digitalPct}% Digital`;

  const targetPct = monthlyTarget > 0 ? Math.min(100, (totalSales / monthlyTarget) * 100) : 0;
  const targetPctText = document.getElementById('target-percent-text');
  const targetBar = document.getElementById('target-progress-bar');
  const targetAchieved = document.getElementById('target-achieved-text');
  const forecastEl = document.getElementById('target-forecast-text');
  
  if (targetPctText) targetPctText.textContent = `${targetPct.toFixed(1)}%`;
  if (targetBar) targetBar.style.width = `${targetPct}%`;
  if (targetAchieved) targetAchieved.textContent = `₹${totalSales.toLocaleString('en-IN')}`;

  const daysCount = Object.keys(dailyTotalObj).length || 1;
  const avgDailySales = totalSales / daysCount;
  const projectedMonthSales = Math.round(avgDailySales * 30);
  if (forecastEl) {
    if (monthlyTarget > 0) {
      const projPct = ((projectedMonthSales / monthlyTarget) * 100).toFixed(0);
      forecastEl.innerHTML = `Pacing: <strong class="text-stone-800">₹${Math.round(avgDailySales).toLocaleString('en-IN')}/day</strong> • Projected: <strong class="text-[#5C0612]">₹${projectedMonthSales.toLocaleString('en-IN')}</strong> (${projPct}%)`;
    } else {
      forecastEl.innerHTML = `Daily Average: <strong>₹${Math.round(avgDailySales).toLocaleString('en-IN')}/day</strong>`;
    }
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
  const overallUPT = totalTransactions > 0 ? (totalUnits / totalTransactions) : 0;
  const overallATV = totalTransactions > 0 ? (totalSales / totalTransactions) : 0;
  const overallAUV = totalUnits > 0 ? (totalSales / totalUnits) : 0;

  document.getElementById('metric-upt').textContent = overallUPT.toFixed(2);
  document.getElementById('metric-atv').textContent = `₹${Math.round(overallATV).toLocaleString('en-IN')}`;
  document.getElementById('metric-auv').textContent = `₹${Math.round(overallAUV).toLocaleString('en-IN')}`;

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

  if (isAdmin) renderAttendanceSalaryModule();

  if (selectedAgentDetail) populateAgentDetailsDOM(selectedAgentDetail);
  if (!document.getElementById('weekly-view').classList.contains('hidden')) renderWeeklyDistributionDOM();

  const isAnalysisActive = !document.getElementById('agent-analysis-view').classList.contains('hidden');
  if (isAnalysisActive && history.state && history.state.name) {
    populateAgentAnalysisScreenDOM(history.state.name);
  }
}

function filterCategory(cat) {
  selectedCategory = cat;
  const categories = ['All', 'Sarees', 'Fabrics', 'Frames'];
  categories.forEach(c => {
    const btnId = `cat-btn-${c.toLowerCase().replace(/\s+/g, '')}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      if (c === cat) {
        btn.className = "px-3 py-1 rounded-full bg-[#5C0612] text-[#EFE5C9] border border-[#DAA520] font-bold shadow-sm transition-all";
      } else {
        btn.className = "px-3 py-1 rounded-full bg-[#FFFDF9] text-stone-600 border border-[#E5D5C6] hover:bg-stone-100 font-bold transition-all";
      }
    }
  });
  renderProductsTable();
}

function renderProductsTable() {
  let displayList = productsList.filter(p => {
    if (selectedCategory === 'All') return true;
    return p.category === selectedCategory;
  });

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
    tbody.innerHTML = `<tr><td colspan="3" class="p-6 text-center text-stone-400 font-traditional">No items found for this category</td></tr>`;
    return;
  }

  tbody.innerHTML = displayList.map(p => {
    const escapedName = p.name.replace(/'/g, "\\'");
    const isSlowMoving = p.qty <= 2;
    const slowBadge = isSlowMoving 
      ? `<span class="bg-rose-100 text-rose-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded border border-rose-200 ml-1.5 uppercase">Slow Velocity</span>` 
      : (p.qty >= 10 ? `<span class="bg-emerald-100 text-emerald-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded border border-emerald-200 ml-1.5 uppercase">Bestseller</span>` : '');

    return `
      <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showProductDetails('${escapedName}')">
        <td class="p-3.5">
          <div class="font-bold text-stone-800 flex justify-between items-center font-sans text-xs">
            <span class="flex items-center flex-wrap">${p.name} ${slowBadge}</span>
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
          <div class="text-[9px] text-[#DAA520] font-bold mt-1 uppercase tracking-tight">${p.share.toFixed(1)}% Share</div>
        </td>
      </tr>
    `;
  }).join('');
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

  let maxUptAgent = null, maxUptVal = 0;
  let maxAtvAgent = null, maxAtvVal = 0;

  agentsList.forEach(a => {
    const atv = a.billCount > 0 ? (a.revenue / a.billCount) : 0;
    if (a.upt > maxUptVal && a.upt >= 1.5) { maxUptVal = a.upt; maxUptAgent = a.name; }
    if (atv > maxAtvVal && atv >= 2000) { maxAtvVal = atv; maxAtvAgent = a.name; }
  });

  document.getElementById('agents-table-body').innerHTML = agentsList.map((a, idx) => {
    let badgesHTML = '';
    if (idx === 0 && !agentSortAsc && agentSortCol === 'revenue' && a.revenue > 0) {
      badgesHTML += `<span class="bg-amber-100 text-amber-900 border border-amber-300 text-[8px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ml-1.5">🥇 Top Champ</span>`;
    }
    if (a.name === maxUptAgent) {
      badgesHTML += `<span class="bg-blue-100 text-blue-900 border border-blue-300 text-[8px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ml-1">📦 Cross-Sell Pro</span>`;
    }
    if (a.name === maxAtvAgent) {
      badgesHTML += `<span class="bg-purple-100 text-purple-900 border border-purple-300 text-[8px] font-bold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ml-1">💎 High Ticket</span>`;
    }

    const atv = a.billCount > 0 ? (a.revenue / a.billCount) : 0;
    const kpiHTML = `
      <div class="text-[9px] text-stone-500 font-bold mt-1 font-sans flex items-center gap-1.5">
        <span>Cross-Sell Basket (UPT): <strong class="text-stone-800">${a.upt.toFixed(1)}</strong></span>
        <span>•</span>
        <span>Avg Ticket (ATV): <strong class="text-[#5C0612]">₹${Math.round(atv).toLocaleString('en-IN')}</strong></span>
      </div>
    `;

    return `
      <tr class="hover:bg-amber-50/20 transition-colors cursor-pointer" onclick="showAgentDetails('${a.name}')">
        <td class="p-3.5 font-bold text-stone-700 font-sans">
          <div class="flex justify-between items-center">
            <span class="flex items-center flex-wrap">${a.name} ${badgesHTML}</span>
            <span class="text-[9px] text-[#DAA520] font-bold flex items-center gap-1 font-traditional">Ledger <i class="fa-solid fa-chevron-right text-[8px]"></i></span>
          </div>
          ${kpiHTML}
        </td>
        <td class="p-3.5 text-right font-extrabold text-[#5C0612] font-sans">₹${a.revenue.toLocaleString('en-IN')}</td>
      </tr>
    `;
  }).join('');
}

// ATTENDANCE & PAYROLL MODULE (STRICT ADMIN ONLY)
function renderAttendanceSalaryModule() {
  if (!isAdmin) return; 

  const container = document.getElementById('staff-salary-list');
  if (!container) return;
  container.innerHTML = '';

  let staffData = [];
  if (Array.isArray(rawAttendanceData)) {
    staffData = rawAttendanceData.filter(emp => {
      const name = getEmpProp(emp, ['Employee Name', 'Name', 'Staff Name', 'Emp Name']);
      return name && name.toString().trim().length > 0;
    });
  }

  if (staffData.length === 0) {
    staffData = [
      { "Emp ID": "KS-101", "Employee Name": "Chenna Kesava", "Designation": "Store Manager", "Monthly Salary": "18000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-102", "Employee Name": "keerthi", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-103", "Employee Name": "mouni", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-104", "Employee Name": "latha", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-105", "Employee Name": "vara lakshmi", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-106", "Employee Name": "sanjana", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-107", "Employee Name": "sandhya", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-108", "Employee Name": "geethika", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" },
      { "Emp ID": "KS-109", "Employee Name": "pushpa", "Designation": "Sales (Fabrics)", "Monthly Salary": "12000", "Commission Pct": "0", "Advance Taken": "0" }
    ];
    rawAttendanceData = staffData;
  }

  const staffCountEl = document.getElementById('payroll-staff-count');
  if (staffCountEl) staffCountEl.textContent = staffData.length;
  
  let totalStorePayroll = 0;

  staffData.forEach((emp, index) => {
    const empId = getEmpProp(emp, ['Emp ID', 'ID', 'Employee ID']) || `KS-${101 + index}`;
    const name = getEmpProp(emp, ['Employee Name', 'Name', 'Staff Name', 'Emp Name']) || `Staff ${index + 1}`;
    const role = getEmpProp(emp, ['Designation', 'Role']) || 'Sales Staff';
    
    let fullSalary = parseFloat(getEmpProp(emp, ['Monthly Salary', 'Full Salary', 'Basic Salary', 'Salary']));
    if (isNaN(fullSalary) || fullSalary <= 0) {
      fullSalary = role.toLowerCase().includes('manager') ? 18000 : 12000;
    }

    let commPct = parseFloat(getEmpProp(emp, ['Commission Pct', 'Commission %', 'Comm %', 'Commission']));
    if (isNaN(commPct)) commPct = 0;
    
    let advance = parseFloat(getEmpProp(emp, ['Advance Taken', 'Advance', 'Adv'])) || 0;

    const totalSold = getStaffSalesAmount(name);
    const calculatedIncentive = (commPct > 0) ? Math.round(totalSold * (commPct / 100)) : 0;

    let countP = 0, countHD = 0, countWO = 0, countPL = 0, countA = 0;
    for (let d = 1; d <= 31; d++) {
      const val = (emp[d.toString()] || '').toString().toUpperCase().trim();
      if (val === 'P') countP++;
      else if (val === 'HD') countHD++;
      else if (val === 'WO') countWO++;
      else if (val === 'PL') countPL++;
      else if (val === 'A') countA++;
    }

    const payableDays = (countP > 0 || countHD > 0 || countWO > 0 || countPL > 0 || countA > 0)
      ? (countP + (countHD * 0.5) + countWO + countPL)
      : 31;

    const totalDaysInMonth = 31;
    const perDayRate = fullSalary > 0 ? (fullSalary / totalDaysInMonth) : 0;
    const baseEarned = Math.round(payableDays * perDayRate);
    const lopDeduction = Math.round(fullSalary - baseEarned);
    const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);
    const attendancePct = ((payableDays / totalDaysInMonth) * 100).toFixed(0);

    totalStorePayroll += netSalary;

    const commissionStatusHTML = commPct > 0 
      ? `<span class="text-emerald-700 font-bold">+ Incentive (${commPct}%): +₹${calculatedIncentive.toLocaleString('en-IN')}</span>`
      : `<span class="text-stone-400 font-medium">No Commission (0%)</span>`;

    let dayGridHTML = '';
    for (let d = 1; d <= 31; d++) {
      const currentSt = (emp[d.toString()] || '').toString().toUpperCase().trim() || 'P';
      const bgCol = currentSt === 'P' ? 'bg-emerald-100 text-emerald-900 border-emerald-300' :
                    currentSt === 'HD' ? 'bg-amber-100 text-amber-900 border-amber-300' :
                    currentSt === 'WO' ? 'bg-blue-100 text-blue-900 border-blue-300' :
                    currentSt === 'PL' ? 'bg-purple-100 text-purple-900 border-purple-300' :
                    'bg-rose-100 text-rose-900 border-rose-300';

      dayGridHTML += `
        <div class="text-center font-numeric">
          <span class="block text-[7px] text-stone-400 font-bold">${d}</span>
          <select onchange="updateDayAttendance(${index}, ${d}, this.value)" class="text-[8px] font-black p-0.5 rounded border ${bgCol} focus:outline-none cursor-pointer">
            <option value="P" ${currentSt === 'P' ? 'selected' : ''}>P</option>
            <option value="HD" ${currentSt === 'HD' ? 'selected' : ''}>HD</option>
            <option value="WO" ${currentSt === 'WO' ? 'selected' : ''}>WO</option>
            <option value="PL" ${currentSt === 'PL' ? 'selected' : ''}>PL</option>
            <option value="A" ${currentSt === 'A' ? 'selected' : ''}>A</option>
          </select>
        </div>
      `;
    }

    const card = document.createElement('div');
    card.className = "bg-[#FFFDF9] rounded-2xl border border-[#E5D5C6] warm-shadow p-4 space-y-3 relative overflow-hidden";
    card.innerHTML = `
      <div class="flex justify-between items-start border-b border-[#E5D5C6]/60 pb-2">
        <div>
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-bold text-[#5C0612] bg-[#EFE5C9] px-2 py-0.5 rounded font-numeric">${empId}</span>
            <span class="text-[8px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded font-bold font-numeric">${attendancePct}% Attendance</span>
          </div>
          <h4 class="font-bold text-stone-800 text-sm font-sans mt-1">${name}</h4>
          <p class="text-[10px] text-stone-500 font-traditional">${role}</p>
        </div>
        <div class="text-right font-numeric">
          <p class="text-[9px] text-stone-500 font-traditional">Final Net Salary</p>
          <p class="text-base font-black text-[#5C0612]" id="net-sal-${index}">₹${netSalary.toLocaleString('en-IN')}</p>
          <button onclick="shareStaffPayslipWhatsApp(${index})" class="mt-1 text-[8px] bg-[#25D366] text-white px-2 py-0.5 rounded font-bold uppercase flex items-center gap-1 ml-auto export-ignore">
            <i class="fa-brands fa-whatsapp"></i> Payslip
          </button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 bg-[#FAF6EE] p-2.5 rounded-xl border border-[#E5D5C6]/60 font-numeric text-xs">
        <div>
          <label class="block text-[8px] font-bold uppercase text-stone-500 font-traditional">Full Salary (₹)</label>
          <input type="number" value="${fullSalary || ''}" placeholder="Base Sal" 
            oninput="updateStaffPayroll(${index}, 'salary', this.value)" 
            class="w-full text-xs font-bold text-stone-800 bg-white border border-[#E5D5C6] rounded-lg p-1 focus:outline-none">
        </div>
        <div>
          <label class="block text-[8px] font-bold uppercase text-stone-500 font-traditional">Comm % (Sold ₹${totalSold.toLocaleString('en-IN')})</label>
          <input type="number" value="${commPct}" step="0.1" placeholder="0%" 
            oninput="updateStaffPayroll(${index}, 'commission', this.value)" 
            class="w-full text-xs font-bold ${commPct > 0 ? 'text-emerald-800 border-emerald-300' : 'text-stone-400'} bg-white border rounded-lg p-1 focus:outline-none">
        </div>
        <div>
          <label class="block text-[8px] font-bold uppercase text-stone-500 font-traditional">Advance Taken (₹)</label>
          <input type="number" value="${advance || ''}" placeholder="Advance" 
            oninput="updateStaffPayroll(${index}, 'advance', this.value)" 
            class="w-full text-xs font-bold text-rose-800 bg-white border border-[#E5D5C6] rounded-lg p-1 focus:outline-none">
        </div>
      </div>

      <div class="flex justify-between items-center text-[9px] font-numeric bg-[#F3EFE9] px-2.5 py-1.5 rounded-lg border border-[#E5D5C6]/40">
        <span>Base Earned: <strong class="text-stone-800">₹${baseEarned.toLocaleString('en-IN')}</strong> (LOP: <span class="text-rose-600">-₹${lopDeduction}</span>)</span>
        <span>${commissionStatusHTML}</span>
      </div>

      <details class="group">
        <summary class="text-[9px] font-bold uppercase tracking-wider text-[#5C0612] cursor-pointer font-traditional flex justify-between items-center py-1">
          <span>Edit 31-Day Attendance Grid</span>
          <i class="fa-solid fa-chevron-down text-[8px] transition-transform group-open:rotate-180"></i>
        </summary>
        <div class="grid grid-cols-7 gap-1 pt-2 border-t border-[#E5D5C6]/40">
          ${dayGridHTML}
        </div>
      </details>
    `;

    container.appendChild(card);
  });

  let overallStoreRevenue = 0;
  rawData.forEach(r => {
    const amt = parseFloat(r['BillAmount']) || parseFloat(r['Bill Amount']) || parseFloat(r['Amount']) || 0;
    overallStoreRevenue += amt;
  });

  const grossProfit = Math.max(0, overallStoreRevenue - totalStorePayroll);

  const payTotalEl = document.getElementById('payroll-total-amount');
  const storeSalesEl = document.getElementById('profit-store-sales');
  const grossAmtEl = document.getElementById('profit-gross-amount');

  if (payTotalEl) payTotalEl.textContent = `₹${totalStorePayroll.toLocaleString('en-IN')}`;
  if (storeSalesEl) storeSalesEl.textContent = `₹${overallStoreRevenue.toLocaleString('en-IN')}`;
  if (grossAmtEl) grossAmtEl.textContent = `₹${grossProfit.toLocaleString('en-IN')}`;
}

function updateDayAttendance(empIndex, day, newStatus) {
  if (!isAdmin) return;
  rawAttendanceData[empIndex][day.toString()] = newStatus;
  renderAttendanceSalaryModule();
}

function updateGlobalCommission(val) {
  if (!isAdmin) return;
  defaultCommissionPct = parseFloat(val) || 0;
  rawAttendanceData.forEach(emp => { emp['Commission Pct'] = defaultCommissionPct; });
  renderAttendanceSalaryModule();
}

function updateStaffPayroll(index, field, val) {
  if (!isAdmin) return;
  const emp = rawAttendanceData[index];
  if (field === 'salary') emp['Monthly Salary'] = parseFloat(val) || 0;
  else if (field === 'commission') emp['Commission Pct'] = parseFloat(val) || 0;
  else if (field === 'advance') emp['Advance Taken'] = parseFloat(val) || 0;

  renderAttendanceSalaryModule();
}

function shareStaffPayslipWhatsApp(index) {
  if (!isAdmin) return;
  const emp = rawAttendanceData[index];
  const name = getEmpProp(emp, ['Employee Name', 'Name']) || 'Staff';
  const fullSalary = parseFloat(getEmpProp(emp, ['Monthly Salary', 'Full Salary', 'Salary'])) || 0;
  const commPct = parseFloat(getEmpProp(emp, ['Commission Pct', 'Commission %', 'Comm %'])) || 0;
  const advance = parseFloat(getEmpProp(emp, ['Advance Taken', 'Advance', 'Adv'])) || 0;

  const totalSold = getStaffSalesAmount(name);
  const calculatedIncentive = commPct > 0 ? Math.round(totalSold * (commPct / 100)) : 0;

  let countP = 0, countHD = 0;
  for (let d = 1; d <= 31; d++) {
    const val = (emp[d.toString()] || '').toString().toUpperCase().trim();
    if (val === 'P' || val === 'WO' || val === 'PL') countP++;
    else if (val === 'HD') countHD++;
  }

  const payableDays = countP + (countHD * 0.5);
  const baseEarned = Math.round(payableDays * (fullSalary / 31));
  const lopDeduction = Math.round(fullSalary - baseEarned);
  const netSalary = Math.max(0, (baseEarned + calculatedIncentive) - advance);

  let msg = `🌸 *KAILASH KALAMKARI - MONTHLY PAYSLIP* 🌸\n\n`;
  msg += `👤 *Staff Name:* ${name}\n`;
  msg += `🗓️ *Payable Days:* ${payableDays} / 31 Days\n`;
  msg += `💵 *Base Monthly Salary:* ₹${fullSalary.toLocaleString('en-IN')}\n`;
  if (lopDeduction > 0) msg += `🔻 *LOP Deduction:* -₹${lopDeduction.toLocaleString('en-IN')}\n`;
  msg += `🛍️ *Total Sales Done:* ₹${totalSold.toLocaleString('en-IN')}\n`;
  
  if (calculatedIncentive > 0) {
    msg += `🎁 *Sales Commission (${commPct}%):* +₹${calculatedIncentive.toLocaleString('en-IN')}\n`;
  }
  
  if (advance > 0) msg += `📉 *Advance Deducted:* -₹${advance.toLocaleString('en-IN')}\n`;
  msg += `\n💰 *FINAL NET SALARY:* ₹${netSalary.toLocaleString('en-IN')}\n\n`;
  msg += `_Thank you for your dedicated service at Kailash Kalamkari!_`;

  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function shareOwnerDailySummaryWhatsApp() {
  if (!isAdmin) return;
  const fromVal = document.getElementById('from-date').value || 'Start';
  const toVal = document.getElementById('to-date').value || 'End';
  const totalSalesText = document.getElementById('metric-total').textContent || '₹0';
  const onlineSalesText = document.getElementById('metric-online').textContent || '₹0';
  const offlineSalesText = document.getElementById('metric-offline').textContent || '₹0';
  const wholesaleSalesText = document.getElementById('metric-wholesale').textContent || '₹0';

  const upiStore = document.getElementById('paymode-upi-store').textContent || '₹0';
  const upiOnl = document.getElementById('paymode-upi-onl').textContent || '₹0';
  const cash = document.getElementById('paymode-cash').textContent || '₹0';
  const card = document.getElementById('paymode-card').textContent || '₹0';
  const hand = document.getElementById('paymode-hand').textContent || '₹0';

  const bSmall = document.getElementById('bucket-small').textContent || '0 Bills';
  const bMedium = document.getElementById('bucket-medium').textContent || '0 Bills';
  const bHigh = document.getElementById('bucket-high').textContent || '0 Bills';

  let topAgent = "N/A", topAgentRev = 0;
  agentsList.forEach(a => {
    if (a.revenue > topAgentRev) {
      topAgentRev = a.revenue;
      topAgent = a.name;
    }
  });

  let topProduct = "N/A", topProdQty = 0;
  productsList.forEach(p => {
    if (p.qty > topProdQty) {
      topProdQty = p.qty;
      topProduct = p.name;
    }
  });

  let msg = `🌸 *KAILASH KALAMKARI - EXECUTIVE DAILY SUMMARY* 🌸\n\n`;
  msg += `🗓️ *Period:* ${fromVal} to ${toVal}\n`;
  msg += `💰 *TOTAL STORE REVENUE:* ${totalSalesText}\n\n`;
  msg += `📊 *CHANNEL SPLIT:*\n`;
  msg += `• Online: ${onlineSalesText}\n`;
  msg += `• Offline: ${offlineSalesText}\n`;
  msg += `• Takebyhand: ${wholesaleSalesText}\n\n`;
  msg += `🎫 *TICKET BUCKET SPLIT:*\n`;
  msg += `• Small (< ₹10K): ${bSmall}\n`;
  msg += `• Medium (₹10K – ₹1 Lakh): ${bMedium}\n`;
  msg += `• High (> ₹1 Lakh): ${bHigh}\n\n`;
  msg += `💳 *PAYMENT MODE BREAKDOWN:*\n`;
  msg += `• UPI Store: ${upiStore}\n`;
  msg += `• UPI Online: ${upiOnl}\n`;
  msg += `• Cash: ${cash}\n`;
  msg += `• Card: ${card}\n`;
  msg += `• Takebyhand Credit: ${hand}\n\n`;
  msg += `🏆 *TOP STAFF:* ${topAgent} (₹${topAgentRev.toLocaleString('en-IN')})\n`;
  msg += `🛍️ *TOP PRODUCT:* ${topProduct} (${topProdQty} units)\n\n`;
  msg += `_Generated live from Kailash Kalamkari Store Dashboard_`;

  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function backupFullDatabaseExcel() {
  if (!isAdmin) return;
  if (typeof XLSX === 'undefined') {
    alert("Excel library loading or unavailable.");
    return;
  }

  const workbook = XLSX.utils.book_new();

  const salesSheetData = rawData.map(r => {
    const amt = parseFloat(r['BillAmount']) || parseFloat(r['Bill Amount']) || 0;
    let ticketCategory = 'Small (< ₹10K)';
    if (amt > 100000) ticketCategory = 'High (> ₹1 Lakh)';
    else if (amt >= 10000) ticketCategory = 'Medium (₹10K-₹1Lakh)';

    return {
      "Date": normalizeToDateString(r['Bill Date']),
      "Bill No": r['Bill No'] || r['Bill No.'] || 'N/A',
      "Staff Name": r['SM Name'] || r['SMName'] || 'No Agent',
      "Item Name": r['Item Name'] || r['ItemName'] || '',
      "Category": getItemCategory(r['Item Name'] || r['ItemName']),
      "Qty": parseInt(r['Qty']) || parseInt(r['QTY']) || 0,
      "Amount": amt,
      "Ticket Category": ticketCategory,
      "PayMode": r['PayMode'] || r['Pay Mode'] || '',
      "Channel": getSalesType(r['PayMode'] || r['Pay Mode'])
    };
  });

  const salesWorksheet = XLSX.utils.json_to_sheet(salesSheetData);
  XLSX.utils.book_append_sheet(workbook, salesWorksheet, "Sales Data");

  if (rawAttendanceData && rawAttendanceData.length > 0) {
    const attendanceWorksheet = XLSX.utils.json_to_sheet(rawAttendanceData);
    XLSX.utils.book_append_sheet(workbook, attendanceWorksheet, "Attendance & Payroll");
  }

  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `Kailash_Kalamkari_Full_Backup_${dateStr}.xlsx`);
}

async function saveAttendanceData() {
  if (!isAdmin) return;
  const user = localStorage.getItem('kk_user');
  const pass = localStorage.getItem('kk_pass');

  if (!user || !pass) {
    alert("Session expired. Please re-login.");
    return;
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        username: user,
        password: pass,
        records: rawAttendanceData
      })
    });

    const res = await response.json();
    if (res.status === 'success') {
      alert("✅ Monthly Salaries & Attendance saved to Google Sheets!");
    } else {
      alert("Error saving: " + (res.error || "Unknown error"));
    }
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

function showAgentDetails(agentName) {
  applyState({ view: 'agent-analysis', name: agentName });
}

function showProductDetails(productName) {
  applyState({ view: 'home', detail: 'product', name: productName });
}

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

    const item = row['Item Name'] || row['ItemName'] || 'Unknown Item';
    if (item !== productName) return;

    const agent = row['SM Name'] || row['SMName'] || 'No Agent';
    const amount = parseFloat(row['BillAmount']) || parseFloat(row['Bill Amount']) || 0;
    const payMode = row['PayMode'] || row['Pay Mode'] || '';
    const type = getSalesType(payMode);

    if (!agentStats[agent]) {
      agentStats[agent] = { online: 0, offline: 0, wholesale: 0, total: 0 };
    }

    if (type === 'Online') agentStats[agent].online += amount;
    else if (type === 'Wholesale') agentStats[agent].wholesale += amount;
    else agentStats[agent].offline += amount;

    agentStats[agent].total += amount;
  });

  const sortedAgents = Object.entries(agentStats).sort((a, b) => b[1].total - a[1].total);
  const tbody = document.getElementById('product-detail-table-body');
  if (tbody) {
    tbody.innerHTML = sortedAgents.length === 0 ? `
      <tr><td colspan="5" class="p-3 text-center text-stone-400">No staff sales recorded for this product</td></tr>
    ` : sortedAgents.map(([agentName, stats]) => `
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
  const btnProd = document.getElementById('btn-agent-detail-product');
  const btnBill = document.getElementById('btn-agent-detail-bill');

  if (view === 'product') {
    if (prodView) prodView.classList.remove('hidden');
    if (billView) billView.classList.add('hidden');
    if (btnProd) btnProd.className = "flex-1 text-center py-2 text-[10px] font-extrabold rounded-lg bg-white text-[#5C0612] shadow-sm font-traditional";
    if (btnBill) btnBill.className = "flex-1 text-center py-2 text-[10px] font-extrabold rounded-lg text-stone-500 hover:text-stone-700 font-traditional";
  } else {
    if (prodView) prodView.classList.add('hidden');
    if (billView) billView.classList.remove('hidden');
    if (btnProd) btnProd.className = "flex-1 text-center py-2 text-[10px] font-extrabold rounded-lg text-stone-500 hover:text-stone-700 font-traditional";
    if (btnBill) btnBill.className = "flex-1 text-center py-2 text-[10px] font-extrabold rounded-lg bg-white text-[#5C0612] shadow-sm font-traditional";
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
  document.getElementById('agent-detail-bill-table-body').innerHTML = sortedBills.length === 0 ? `
    <tr><td colspan="3" class="p-4 text-center text-stone-400 font-sans">No bill records</td></tr>
  ` : sortedBills.map(b => `
    <tr class="hover:bg-amber-50/20 transition-colors">
      <td class="p-2.5 font-semibold text-stone-700">${b.date || 'N/A'}</td>
      <td class="p-2.5 text-center font-bold text-stone-500">${b.billNo || 'N/A'}</td>
      <td class="p-2.5 text-right font-extrabold text-[#5C0612]">₹${b.amount.toLocaleString('en-IN')}</td>
    </tr>
  `).join('');

  toggleAgentDetailView('product');
  return true;
}

function populateChannelScreenDOM(channel) {
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;
  
  const headerEl = document.getElementById('channel-header');
  if (headerEl) {
    if (channel === 'Online') headerEl.className = "bg-blue-900 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md";
    else if (channel === 'Offline') headerEl.className = "bg-orange-800 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md";
    else if (channel === 'Wholesale') headerEl.className = "bg-purple-900 text-white px-5 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md";
    else headerEl.className = "bg-[#5C0612] text-white px-5 py-4 flex items-center justify-between sticky top-0 z-50 shadow-md";
  }

  const titleEl = document.getElementById('channel-view-title');
  const subEl = document.getElementById('channel-view-subtitle');
  const labelEl = document.getElementById('channel-revenue-label');
  if (titleEl) titleEl.textContent = `${channel} Sales Performance`;
  if (subEl) subEl.textContent = `Date Range: ${fromVal || 'Start'} to ${toVal || 'End'}`;
  if (labelEl) labelEl.textContent = `${channel} Total Revenue`;

  const filtered = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    let match = true;
    if (fromVal) match = match && (rDate >= fromVal);
    if (toVal) match = match && (rDate <= toVal);
    const payMode = row['PayMode'] || row['Pay Mode'] || '';
    const type = getSalesType(payMode);
    return match && (type === channel);
  });

  let totalChannelRevenue = 0;
  const agentsObj = {};
  const productsObj = {};

  filtered.forEach(row => {
    const amount = parseFloat(row['BillAmount']) || parseFloat(row['Bill Amount']) || 0;
    const qty = parseInt(row['Qty']) || parseInt(row['QTY']) || 0;
    const item = row['Item Name'] || row['ItemName'] || 'Unknown Item';
    const agent = row['SM Name'] || row['SMName'] || 'No Agent';

    totalChannelRevenue += amount;
    agentsObj[agent] = (agentsObj[agent] || 0) + amount;

    if (!productsObj[item]) productsObj[item] = { qty: 0, revenue: 0 };
    productsObj[item].qty += qty;
    productsObj[item].revenue += amount;
  });

  const totalEl = document.getElementById('channel-view-total');
  if (totalEl) totalEl.textContent = `₹${totalChannelRevenue.toLocaleString('en-IN')}`;

  const agentsList = Object.entries(agentsObj).sort((a, b) => b[1] - a[1]);
  const agentTableBody = document.getElementById('channel-agents-table');
  if (agentTableBody) {
    agentTableBody.innerHTML = agentsList.length === 0 ? `
      <tr><td colspan="2" class="p-4 text-center text-stone-400 font-sans">No channel sales found</td></tr>
    ` : agentsList.map(([name, rev]) => `
      <tr class="hover:bg-amber-50/20 transition-colors">
        <td class="p-3.5 font-bold text-stone-700 font-sans">${name}</td>
        <td class="p-3.5 text-right font-extrabold text-[#5C0612] font-sans">₹${rev.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  const productsList = Object.entries(productsObj).map(([name, val]) => ({ name, ...val })).sort((a, b) => b.revenue - a.revenue);
  const prodTableBody = document.getElementById('channel-products-table');
  if (prodTableBody) {
    prodTableBody.innerHTML = productsList.length === 0 ? `
      <tr><td colspan="3" class="p-4 text-center text-stone-400 font-sans">No products found</td></tr>
    ` : productsList.map(p => `
      <tr class="hover:bg-amber-50/20 transition-colors">
        <td class="p-3.5 font-bold text-stone-800 font-sans text-xs">${p.name}</td>
        <td class="p-3.5 text-center font-bold text-stone-700 font-sans">${p.qty}</td>
        <td class="p-3.5 text-right font-extrabold text-[#5C0612] font-sans">₹${p.revenue.toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }
}

function populateWeeklyScreenDOM() {
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;
  const subEl = document.getElementById('weekly-view-subtitle');
  if (subEl) subEl.textContent = `Date Range: ${fromVal || 'Start'} to ${toVal || 'End'}`;
  renderWeeklyDistributionDOM();
}

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
          <span class="font-traditional font-bold">${day}</span>
          <span class="font-numeric text-[#5C0612] font-black">₹${amount.toLocaleString('en-IN')} (${pct.toFixed(1)}%)</span>
        </div>
        <div class="w-full bg-[#E5D5C6]/40 h-2.5 rounded-full overflow-hidden">
          <div class="bg-[#5C0612] h-full rounded-full transition-all duration-300" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function populateAgentAnalysisScreenDOM(agentName) {
  activeAnalysisAgent = agentName;
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;
  
  const titleEl = document.getElementById('agent-analysis-title');
  const subEl = document.getElementById('agent-analysis-subtitle');
  if (titleEl) titleEl.textContent = `${agentName} Ledger`;
  if (subEl) subEl.textContent = `Date limits: ${fromVal || 'Start'} to ${toVal || 'End'}`;

  const filtered = rawData.filter(row => {
    if (!row['Bill Date']) return false;
    const rDate = normalizeToDateString(row['Bill Date']);
    let match = true;
    if (fromVal) match = match && (rDate >= fromVal);
    if (toVal) match = match && (rDate <= toVal);
    return match;
  });

  const agentRows = filtered.filter(row => {
    const smName = row['SM Name'] || row['SMName'] || row['Agent'] || row['Staff'] || 'No Agent';
    return smName.toString().trim().toLowerCase() === agentName.toString().trim().toLowerCase();
  });

  let totalAgentRevenue = 0, totalAgentUnits = 0;
  let totalOnlineSales = 0, totalOfflineSales = 0, totalTakebyhandSales = 0;
  const dailyGroup = {};
  const productSales = {};

  agentRows.forEach(row => {
    const date = normalizeToDateString(row['Bill Date']);
    const amount = parseFloat(row['BillAmount']) || parseFloat(row['Bill Amount']) || parseFloat(row['Amount']) || 0;
    const qty = parseInt(row['Qty']) || parseInt(row['QTY']) || 0;
    const item = row['Item Name'] || row['ItemName'] || 'Unknown Item';
    const payMode = row['PayMode'] || row['Pay Mode'] || row['Paymode'] || '';
    const channel = getSalesType(payMode);
    const billNo = row['Bill No'] || row['Bill No.'] || row['BillNo'] || row['Invoice No'] || 'N/A';

    totalAgentRevenue += amount;
    totalAgentUnits += qty;

    if (channel === 'Online') totalOnlineSales += amount;
    else if (channel === 'Wholesale') totalTakebyhandSales += amount;
    else totalOfflineSales += amount;

    if (!dailyGroup[date]) dailyGroup[date] = { total: 0, bills: {} };
    dailyGroup[date].total += amount;

    if (!dailyGroup[date].bills[billNo]) dailyGroup[date].bills[billNo] = { total: 0, items: [] };
    dailyGroup[date].bills[billNo].total += amount;
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
      <p class="text-center text-stone-400 text-xs font-traditional py-4">No product sales recorded for this agent in this date range.</p>
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
    dailyListContainer.innerHTML = sortedDates.map(dateStr => {
      const dayData = dailyGroup[dateStr];
      const sortedBills = Object.entries(dayData.bills).sort((a, b) => b[1].total - a[1].total);

      const billsHTML = sortedBills.map(([billNo, billData]) => {
        const itemsHTML = billData.items.map(item => `
          <div class="flex justify-between items-center text-[11px] text-stone-600 py-1.5">
            <span class="font-sans font-medium text-stone-700">${item.name} x${item.qty}</span>
            <span class="font-numeric font-semibold text-stone-800">₹${item.amount.toLocaleString('en-IN')}</span>
          </div>
        `).join('');

        return `
          <div class="bg-stone-50/60 rounded-xl p-3 border border-[#E5D5C6]/40 space-y-1.5">
            <div class="flex justify-between items-center border-b border-[#E5D5C6]/30 pb-1">
              <span class="text-[10px] font-bold text-stone-500 uppercase tracking-wider font-traditional">Bill No: ${billNo}</span>
              <span class="text-xs font-black text-[#5C0612] font-numeric">₹${billData.total.toLocaleString('en-IN')}</span>
            </div>
            <div class="divide-y divide-[#E5D5C6]/15">${itemsHTML}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="border border-[#E5D5C6] rounded-2xl bg-[#FFFDF9] overflow-hidden warm-shadow">
          <div class="bg-[#F3EFE9] px-4 py-3 border-b border-[#E5D5C6] flex justify-between items-center">
            <span class="font-traditional font-bold text-stone-700 text-xs">${dateStr}</span>
            <span class="font-numeric font-black text-[#5C0612] text-xs">Day Total: ₹${dayData.total.toLocaleString('en-IN')}</span>
          </div>
          <div class="p-3 space-y-3">${billsHTML}</div>
        </div>
      `;
    }).join('');
  }
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

function shareAgentSalesReportWhatsApp() {
  const revEl = document.getElementById('agent-analysis-total-revenue');
  const revText = revEl ? revEl.textContent : '₹0';
  const fromVal = document.getElementById('from-date').value;
  const toVal = document.getElementById('to-date').value;

  let msg = `🌸 *KAILASH KALAMKARI - STAFF PERFORMANCE* 🌸\n\n`;
  msg += `👤 *Staff Member:* ${activeAnalysisAgent}\n`;
  msg += `📅 *Date Period:* ${fromVal || 'Start'} to ${toVal || 'End'}\n`;
  msg += `💰 *Total Sales Revenue:* ${revText}\n\n`;
  msg += `_Generated from Kailash Kalamkari Executive Portal_`;

  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
}

function switchTab(tabId) {
  if (tabId === 'attendance-tab' && !isAdmin) {
    switchTab('products-tab');
    return;
  }

  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(tabId).classList.remove('hidden');

  document.getElementById('btn-products-tab').className = tabId === 'products-tab' 
    ? "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional"
    : "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional";
    
  document.getElementById('btn-agents-tab').className = tabId === 'agents-tab' 
    ? "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional"
    : "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional";

  document.getElementById('btn-daywise-tab').className = tabId === 'daywise-tab' 
    ? "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all bg-white text-[#5C0612] shadow-sm font-traditional"
    : "flex-1 min-w-[80px] text-center py-2 text-xs font-bold rounded-xl transition-all text-stone-500 hover:text-stone-700 font-traditional";

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
document.getElementById('refresh-btn').addEventListener('click', () => {
  const session = checkSession();
  if (session.valid) fetchData(session.user, session.pass);
});
document.getElementById('clear-dates-btn').addEventListener('click', () => {
  selectedChannel = "All";
  filterCategory('All');
  closeProductDetail();
  closeAgentDetail();
  closeAgentAnalysisScreen();
  detectDateRanges();
  processData();
});

const session = checkSession();
if (session.valid) {
  fetchData(session.user, session.pass);
} else {
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}