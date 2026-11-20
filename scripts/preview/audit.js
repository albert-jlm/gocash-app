// Loads every screen at a range of widths and reports anything that does not
// fit: horizontal overflow of the page, or elements sticking out of the viewport.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const src = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
// Reuse the mock data and route handler from preview.js.
const pre = src.slice(src.indexOf('const b64'), src.indexOf('(async () => {'));
const ROOT = process.argv[2], OUT = process.argv[3];
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1140/chrome-linux/chrome';
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]), f = path.join(ROOT, p);
  const hit = [f, f + '.html', path.join(f, 'index.html'), path.join(ROOT, 'index.html')].find(t => fs.existsSync(t) && fs.statSync(t).isFile());
  res.writeHead(200, { 'Content-Type': types[path.extname(hit)] || 'application/octet-stream' });
  fs.createReadStream(hit).pipe(res);
}).listen(8767);
eval(pre.replace(/^const /gm, 'var '));
const SCREENS = ['/', '/transactions', '/entry', '/capture', '/confirm?id=t2', '/confirm?id=t1', '/transactions?id=t3', '/transactions?id=t5', '/settings', '/settings/wallets', '/settings/rules', '/settings/platforms', '/settings/notifications'];
const WIDTHS = [[320, 568], [360, 740], [390, 844], [430, 932], [600, 960], [768, 1024], [820, 1180], [1024, 768], [1280, 800], [1440, 900], [1920, 1080]];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  let problems = 0, checked = 0;
  for (const [w, h] of WIDTHS) {
    for (const mode of ['app', 'login', 'onboarding']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      if (mode !== 'login') await ctx.addInitScript(s => localStorage.setItem('sb-gocash-api-auth-token', JSON.stringify(s)), session);
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', e => errs.push(e.message));
      await mock(page);
      if (mode === 'onboarding') await page.route('**/rest/v1/operators*', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: (r.request().headers()['accept'] || '').includes('vnd.pgrst.object') ? 'null' : '[]' }));
      const list = mode === 'app' ? SCREENS : mode === 'login' ? ['/login'] : ['/onboarding'];
      for (const s of list) {
        await page.goto('http://localhost:8767' + s, { waitUntil: 'networkidle' });
        await page.waitForTimeout(400);
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth, out = [];
          const pageOverflow = document.scrollingElement.scrollWidth - vw;
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) continue;
            // inside a horizontal scroller is fine
            let p = el.parentElement, scroller = false;
            while (p) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { scroller = true; break; } p = p.parentElement; }
            if (scroller) continue;
            if (b.right > vw + 1 || b.left < -1) out.push(`${el.tagName.toLowerCase()}.${(el.className + '').split(' ').slice(0, 3).join('.')} [${Math.round(b.left)}..${Math.round(b.right)}]`);
          }
          const sidebar = document.querySelector('aside'); const tab = [...document.querySelectorAll('nav')].find(n => n.closest('.lg\\:hidden'));
          return { pageOverflow, out: out.slice(0, 3), sidebar: !!sidebar && getComputedStyle(sidebar).display !== 'none', tabBar: !!tab && getComputedStyle(tab.closest('.lg\\:hidden')).display !== 'none', path: location.pathname };
        });
        checked++;
        const bad = r.pageOverflow > 1 || r.out.length || errs.length;
        if (bad) { problems++; console.log(`PROBLEM ${w}px ${s}: overflow=${r.pageOverflow} ${r.out.join(' ; ')} ${errs.splice(0).join(' | ')}`); }
        if (s === '/' || mode !== 'app') console.log(`${String(w).padStart(4)}px ${s.padEnd(12)} -> ${r.path.padEnd(12)} sidebar=${r.sidebar ? 'yes' : 'no '} tabBar=${r.tabBar ? 'yes' : 'no '}`);
        if ((mode !== 'app' && [390, 1440].includes(w)) || (s === '/' && [320, 1024, 1920].includes(w))) await page.screenshot({ path: path.join(OUT, `audit-${w}-${s === '/' ? 'home' : s.replace(/\W+/g, '-')}.png`) });
      }
      await ctx.close();
    }
  }
  console.log(`checked ${checked} screen/width combinations, ${problems} with problems`);
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
