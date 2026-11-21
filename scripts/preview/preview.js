// Serves a static build, fakes a signed-in session and the backend, and takes
// screenshots at phone and desktop sizes. Nothing here touches the real stack.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const ROOT = process.argv[2], OUT = process.argv[3];
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1140/chrome-linux/chrome';
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, p);
  const tries = [f, f + '.html', path.join(f, 'index.html'), path.join(ROOT, 'index.html')];
  const hit = tries.find(t => fs.existsSync(t) && fs.statSync(t).isFile());
  res.writeHead(200, { 'Content-Type': types[path.extname(hit)] || 'application/octet-stream' });
  fs.createReadStream(hit).pipe(res);
}).listen(8766);

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const user = { id: '00000000-0000-0000-0000-0000000000aa', email: 'operator@example.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: `${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:user.id,role:'authenticated',exp})}.x`, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user };
const now = Date.now(), iso = m => new Date(now - m * 60000).toISOString();
const balances = [
  { account_id: 'a1', name: 'Cash', kind: 'cash', balance_minor: 1845000, natural_balance: 18450 },
  { account_id: 'a2', name: 'GCash', kind: 'platform', balance_minor: 1250050, natural_balance: 12500.5 },
  { account_id: 'a3', name: 'MariBank', kind: 'platform', balance_minor: 300000, natural_balance: 3000 },
  { account_id: 'a4', name: 'Maya', kind: 'platform', balance_minor: 760000, natural_balance: 7600 },
];
const txs = [
  { id: 't1', transaction_type: 'Unknown', platform: 'Unknown', account_number: null, reference_number: null, amount: 0, net_profit: 0, created_at: iso(4), transaction_date: null, status: 'awaiting_confirm', confirmed_at: null, was_edited: false, transfer_to: null, platform_fee: 0 },
  { id: 't2', transaction_type: 'Cash Out', platform: 'GCash', account_number: '09171234567', reference_number: '1029384756123', amount: 1020, net_profit: 0, created_at: iso(12), transaction_date: iso(13), status: 'awaiting_confirm', confirmed_at: null, was_edited: false, transfer_to: null, platform_fee: 0 },
  { id: 't3', transaction_type: 'Cash In', platform: 'GCash', account_number: '09181234567', reference_number: '2029384756123', amount: 500, net_profit: 10, created_at: iso(40), transaction_date: iso(41), status: 'confirmed', confirmed_at: iso(39), was_edited: false },
  { id: 't4', transaction_type: 'Bills Payment', platform: 'Maya', account_number: null, reference_number: '9900112233446', amount: 1850, net_profit: 37, created_at: iso(95), transaction_date: iso(96), status: 'confirmed', confirmed_at: iso(94), was_edited: true },
  { id: 't5', transaction_type: 'Cash Out', platform: 'Maya', account_number: '09221234567', reference_number: '5512348899010', amount: 5000, net_profit: 100, created_at: iso(180), transaction_date: iso(181), status: 'voided', confirmed_at: iso(179), was_edited: false },
  { id: 't7', transaction_type: 'Wallet Transfer', platform: 'Maya', transfer_to: 'GCash', platform_fee: 15, account_number: null, reference_number: 'A1B2C3D4E5F6', amount: 2000, net_profit: 0, created_at: iso(60), transaction_date: iso(61), status: 'confirmed', confirmed_at: iso(59), was_edited: false },
  { id: 't6', transaction_type: 'Telco Load', platform: 'GCash', account_number: '09351234567', reference_number: null, amount: 100, net_profit: 5, created_at: iso(1500), transaction_date: iso(1501), status: 'confirmed', confirmed_at: iso(1499), was_edited: false },
];
const rules = ['Cash In','Cash Out','Telco Load','Bills Payment','Bank Transfer','Profit Remittance'].map((t,i) => ({ id:'r'+i, transaction_type: t, platform: 'all', rate_bps: 200, minimum_minor: 500, rounding: 'ceil_unit', effective_from: iso(99999), effective_to: null }));

async function mock(page) {
  await page.route('**/gocash-api.zether.net/**', async route => {
    const req = route.request(), u = new URL(req.url()), single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const json = (body, headers = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const p = u.pathname;
    if (p.startsWith('/auth/v1/user')) return json(user);
    if (p.startsWith('/auth/v1/')) return json(session);
    if (p.endsWith('/rpc/my_membership')) return json([{ operator_id: 'op1', role: process.env.PREVIEW_ROLE || 'owner' }]);
    if (p.endsWith('/functions/v1/own-accounts')) return json({ wallets: [{ id: 'a2', name: 'GCash' }, { id: 'a3', name: 'MariBank' }, { id: 'a4', name: 'Maya' }], identifiers: [{ id: 'i1', account_id: 'a2', kind: 'mobile', value: '09170000001', label: null }, { id: 'i2', account_id: 'a3', kind: 'account', value: '13240000917', label: null }] });
    if (p.endsWith('/functions/v1/manage-staff')) return json({ owner_email: 'owner@example.test', staff: [{ id: 'm1', email: 'tess@example.test', role: 'staff' }] });
    if (p.endsWith('/functions/v1/upload-keys')) return json({ keys: [{ id: 'k1', label: 'Shop iPhone', key_prefix: 'gck_Ab3xYz', created_at: iso(3000), last_used_at: iso(30) }] });
    if (p.endsWith('/operators')) return json(single ? { id: 'op1', telegram_chat_id: null, settings: {} } : [{ id: 'op1' }]);
    if (p.endsWith('/account_balances')) {
      let rows = balances; const kind = u.searchParams.get('kind');
      if (kind && kind.startsWith('eq.')) rows = rows.filter(r => r.kind === kind.slice(3));
      return json(rows);
    }
    if (p.endsWith('/accounts')) return json(balances.map(b => ({ id: b.account_id, name: b.name, kind: b.kind, is_active: true })));
    if (p.endsWith('/fee_rules')) return json(rules);
    if (p.endsWith('/transactions')) {
      let rows = txs; const st = u.searchParams.get('status'), id = u.searchParams.get('id');
      if (id) rows = rows.filter(r => 'eq.' + r.id === id);
      if (st && st.startsWith('eq.')) rows = rows.filter(r => r.status === st.slice(3));
      if (st && st.startsWith('in.')) rows = rows.filter(r => st.includes(r.status));
      if (single) return json(rows[0] || null);
      return json(rows, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    }
    return json([]);
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const shots = (process.argv[4] || '/,/transactions,/entry,/settings,/settings/wallets,/confirm?id=t2,/confirm?id=t1,/transactions?id=t3,/capture,/settings/platforms,/settings/rules').split(',');
  for (const [label, vw, vh] of [['phone', 390, 844], ['desktop', 1440, 900], ['tablet', 820, 1100]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1, colorScheme: process.env.PREVIEW_SCHEME === 'dark' ? 'dark' : 'light' });
    await ctx.addInitScript(s => { localStorage.setItem('sb-gocash-api-auth-token', JSON.stringify(s)); }, session);
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    await mock(page);
    for (const s of shots) {
      if (label === 'tablet' && !['/', '/entry'].includes(s)) continue;
      await page.goto('http://localhost:8766' + s, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const name = (s === '/' ? 'home' : s.replace(/^\//, '').replace(/[/?=]/g, '-'));
      await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`), fullPage: label !== 'desktop' ? true : false });
      console.log(label, s, '->', new URL(page.url()).pathname + new URL(page.url()).search, errs.length ? 'ERRORS: ' + errs.splice(0).join(' | ') : '');
    }
    await ctx.close();
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
