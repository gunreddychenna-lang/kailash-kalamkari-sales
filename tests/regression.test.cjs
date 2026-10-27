const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function context() {
  const storage = new Map();
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const c = vm.createContext({ window: {}, Date, localStorage, location: { replace() {} } });
  vm.runInContext(fs.readFileSync(path.join(root, 'common.js'), 'utf8'), c);
  return c.window.KK;
}
test('all application JavaScript compiles', () => {
  for (const file of fs.readdirSync(root).filter(f => /\.(html|js)$/.test(f))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const scripts = file.endsWith('.js') ? [text] : [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    scripts.forEach(source => new vm.Script(source, { filename: file }));
  }
});
test('zero commission/salary and fractional/zero quantities survive', () => {
  const k = context();
  assert.equal(k.number(0, 10000), 0);
  assert.equal(k.number('0', 1), 0);
  assert.equal(k.quantity({ qty: 2.5 }), 2.5);
  assert.equal(k.quantity({ qty: 0 }), 0);
  assert.equal(k.quantity({}), 1);
});
test('invoice allocation preserves exact totals, zero bills and negative returns', () => {
  const k = context();
  assert.deepEqual(Array.from(k.amounts([{ rate: 100, qty: 2.5 }, { rate: 100, qty: 1 }], 300)), [214.29, 85.71]);
  assert.deepEqual(Array.from(k.amounts([{ amount: 100 }], 0)), [0]);
  assert.deepEqual(Array.from(k.amounts([{ rate: 100, qty: -1 }], -100)), [-100]);
  assert.equal(k.amounts([{ amount: 1 }, { amount: 1 }, { amount: 1 }], 10).reduce((a, b) => a + b), 10);
  assert.throws(() => k.amounts([{ qty: 1 }, { qty: 1 }], 100), /cannot allocate/);
});
test('settlements accept partial/split payments and reject invalid/overpaid amounts', () => {
  const k = context();
  assert.equal(k.validateSplits([{ account: 'Bank', amount: 6000 }, { account: 'Cash', amount: 4000 }], 10000).length, 2);
  assert.equal(k.validateSplits([{ account: 'Bank', amount: 6000 }], 10000)[0].amount, 6000);
  assert.throws(() => k.validateSplits([{ account: 'Bank', amount: 10001 }], 10000), /exceeds/);
  assert.throws(() => k.validateSplits([{ account: 'Bank', amount: -1 }], 10000), /positive/);
});
test('safe HTML/handler output preserves quoted names and blocks markup', () => {
  const k = context();
  const value = `O'Brien "Silk" <img src=x onerror=alert(1)>`;
  assert.ok(!k.escape(value).includes('<img'));
  const encoded = k.eventArg(value);
  assert.ok(!encoded.includes('"'));
  const decoded = encoded.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(JSON.parse(decoded), value);
  assert.equal(k.phone('9876543210'), k.phone('+91 98765 43210'));
});
test('pagination continues through server caps smaller than requested page', async () => {
  const k = context();
  const source = Array.from({ length: 7 }, (_, id) => ({ id }));
  const client = { from() { return this; }, select() { return this; }, order() { return this; }, async range(from) { return { data: source.slice(from, from + 2) }; } };
  assert.equal((await k.rows(client, 'sales')).length, 7);
});
test('legacy admin password cannot bypass secure authentication', async () => {
  const k = context();
  assert.equal(await k.session({}), null);

  await assert.rejects(
    k.login({}, 'admin', 'admin'),
    /Secure authentication module unavailable/
  );

  assert.equal(k.identity(), null);
});

test('legacy database passwords cannot authenticate without Supabase Auth', async () => {
  const k = context();

  const client = {
    from() {
      throw new Error('Legacy users table must not be queried');
    }
  };

  await assert.rejects(
    k.login(client, 'staff', 'existing-password'),
    /Secure authentication module unavailable/
  );

  assert.equal(k.identity(), null);
});
test('missing transaction function fails safely without direct data writes', async () => {
  const k = context();
  let calls = 0;
  const client = { async rpc(name) { calls++; assert.equal(name, 'replace_settlements'); return { error: { code: 'PGRST202' } }; } };
  await assert.rejects(k.saveSettlements(client, [{ bill_no: 'A', splits: [] }]), /database-settlements.sql/);
  assert.equal(calls, 1);
});
test('simple-login SQL preserves existing database permission boundaries', () => {
  const sql = fs.readFileSync(path.join(root, 'database-settlements.sql'), 'utf8');
  assert.match(sql, /SECURITY INVOKER/);
  assert.doesNotMatch(sql, /SECURITY DEFINER|DISABLE ROW LEVEL SECURITY|kk_admin\(/);
  assert.match(sql, /TO anon, authenticated/);
  const entry = fs.readFileSync(path.join(root, 'entry.html'), 'utf8');
  assert.equal((entry.match(/KK\.saveSettlements\(/g) || []).length, 4);
  assert.doesNotMatch(entry, /\.delete\(/);
});

function page(file) {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(id);
  } };
  const sandbox = vm.createContext({ document, window: { addEventListener() {}, KK_STAFF_CONFIG: { url: 'https://dev.example.invalid', anonKey: 'test-public-key' } }, tailwind: {}, KK: context(), supabase: { createClient: () => ({}) }, console });
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) vm.runInContext(script[1], sandbox);
  return { sandbox, document };
}
test('stock views show quantities consistently and escape imported names', () => {
  const { sandbox, document } = page('stock.html');
  for (const id of ['dept','fab','design','theme','colour']) document.getElementById('filter-' + id).value = 'All';
  // Use the actual filter IDs from the page.
  for (const id of ['filter-dept','filter-fabric','filter-design','filter-theme','filter-colour']) document.getElementById(id).value = 'All';
  vm.runInContext(`rawData = [
    {fabric_name: "O'Brien <img>", theme: '<img>', colour: 'Green', design_name: 'Story', qty: 2.5},
    {fabric_name: "O'Brien <img>", theme: '<img>', colour: 'Green', design_name: 'Story', qty: 0}
  ]; applyFilters();`, sandbox);
  assert.equal(document.getElementById('stat-filtered-qty').textContent, '2.5 Units');
  assert.ok(document.getElementById('matrix-tbody').innerHTML.includes('2.5 Sarees'));
  assert.ok(!document.getElementById('stock-tbody').innerHTML.includes('<img>'));
  assert.ok(document.getElementById('theme-cards-grid').innerHTML.includes('&lt;img&gt;'));
});
test('CRM merges Indian phone variants and retains decimal units', () => {
  const { sandbox, document } = page('crm.html');
  document.getElementById('crm-agent-select').value = 'all';
  vm.runInContext(`processCRMData([
    {bill_no:'A',customer_name:"O'Brien <img>",customer_phone:'9876543210',qty:2.5,amount:250},
    {bill_no:'B',customer_name:"O'Brien <img>",customer_phone:'+91 98765 43210',qty:1,amount:100}
  ]);`, sandbox);
  assert.equal(vm.runInContext('customersList.length', sandbox), 1);
  assert.equal(vm.runInContext('customersList[0].totalUnits', sandbox), 3.5);
  assert.equal(vm.runInContext('customersList[0].totalSpend', sandbox), 350);
  assert.ok(!document.getElementById('crm-table-body').innerHTML.includes('<img>'));
});
