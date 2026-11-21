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
}).listen(8769);
eval(pre.replace(/^const /gm, 'var '));
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(s => localStorage.setItem('sb-gocash-api-auth-token', JSON.stringify(s)), session);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await mock(page);
  await page.goto('http://localhost:8769/entry', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Cash Out', exact: true }).click();
  await page.selectOption('#platform', 'GCash');
  for (const amt of ['1000', '1020']) {
    await page.fill('#amount', amt); await page.waitForTimeout(300);
    const choice = await page.getByRole('radiogroup').count();
    const text = (await page.locator('body').innerText()).split('\n').filter(l => /You earn|hand over|wallet|drawer|Record/.test(l)).join(' | ');
    console.log(`amount ${amt}: chooser shown=${choice > 0} :: ${text}`);
    if (choice) {
      await page.screenshot({ path: path.join(OUT, 'phone-entry-cashout-choice.png'), fullPage: true });
      await page.getByRole('radio').first().click(); await page.waitForTimeout(300);
      const after = (await page.locator('body').innerText()).split('\n').filter(l => /Cash drawer|^₱|Record/.test(l) || /You earn$/.test(l)).join(' | ');
      console.log('  after choosing "yes, fee is inside":', after);
    }
  }
  console.log('errors:', errs.length);
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
