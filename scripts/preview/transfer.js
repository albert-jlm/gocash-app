// Drives the entry form through a wallet transfer and screenshots it.
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright-core');
const src = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
const pre = src.slice(src.indexOf('const b64'), src.indexOf('(async () => {'));
const ROOT = process.argv[2], OUT = process.argv[3];
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1140/chrome-linux/chrome';
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]), f = path.join(ROOT, p);
  const hit = [f, f + '.html', path.join(f, 'index.html'), path.join(ROOT, 'index.html')].find(t => fs.existsSync(t) && fs.statSync(t).isFile());
  res.writeHead(200, { 'Content-Type': types[path.extname(hit)] || 'application/octet-stream' }); fs.createReadStream(hit).pipe(res);
}).listen(8768);
eval(pre.replace(/^const /gm, 'var '));
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  for (const [label, w, h] of [['phone', 390, 844], ['desktop', 1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(s => localStorage.setItem('sb-gocash-api-auth-token', JSON.stringify(s)), session);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await mock(page);
    await page.goto('http://localhost:8768/entry', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Move my own money', exact: true }).click();
    await page.selectOption('#platform', 'Maya');
    await page.selectOption('#transfer-to', 'GCash');
    await page.fill('#amount', '2,000');
    await page.fill('#platform-fee', '15');
    await page.waitForTimeout(400);
    const toOptions = await page.$$eval('#transfer-to option', o => o.map(x => x.textContent));
    const saveText = await page.locator('button:has-text("Record")').last().textContent();
    const disabled = await page.locator('button:has-text("Record")').last().isDisabled();
    console.log(label, '| To options:', toOptions.join(', '), '| button:', saveText.trim(), disabled ? '(disabled)' : '(enabled)', errs.length ? 'ERRORS ' + errs.join('|') : '');
    await page.screenshot({ path: path.join(OUT, `${label}-entry-transfer.png`), fullPage: true });
    await page.goto('http://localhost:8768/transactions?id=t7', { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${label}-detail-transfer.png`), fullPage: label === 'phone' });
    await ctx.close();
  }
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
