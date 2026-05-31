// One-time: drive the real Apple Photos build in a headless Chrome and cache the
// resulting trips JSON to /tmp/tt-trips.json so the capture script can reuse it.
import puppeteer from 'puppeteer';
import { existsSync, writeFileSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WINDOW_LABEL = process.env.TT_WINDOW || 'All'; // 1 yr / 3 yr / 5 yr / 10 yr / All

const browser = await puppeteer.launch({
  headless: true,
  executablePath: existsSync(CHROME) ? CHROME : puppeteer.executablePath(),
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1440,900',
  ],
});
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/error|fail/i.test(t)) console.log('[page]', t);
});
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 });

// Wait for the builder modal to be ready, then pick the window + build.
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].some((b) => /Build My Story/i.test(b.textContent || '')),
  { timeout: 30000 }
);

await page.evaluate((label) => {
  const byText = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
  const win = byText(new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'));
  if (win) win.click();
}, WINDOW_LABEL);

await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /Build My Story/i.test(x.textContent || ''));
  if (b) b.click();
});
console.log('Build started (window =', WINDOW_LABEL, ')… this can take a few minutes.');

// Poll localStorage until the story is persisted (or time out).
const DEADLINE = Date.now() + 12 * 60 * 1000;
let trips = null;
while (Date.now() < DEADLINE) {
  await new Promise((r) => setTimeout(r, 4000));
  const raw = await page.evaluate(() => localStorage.getItem('travel-timeline-trips'));
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        trips = parsed;
        break;
      }
    } catch {}
  }
  const prog = await page.evaluate(() => {
    const el = [...document.querySelectorAll('p')].find((p) => /scanning|geocod|found|done|building/i.test(p.textContent || ''));
    return el ? el.textContent : '';
  });
  if (prog) console.log('  …', prog.trim().slice(0, 80));
}

if (!trips) {
  console.error('Timed out without a story.');
  await browser.close();
  process.exit(1);
}

const dests = trips.reduce((n, t) => n + (t.destinations?.length || 0), 0);
const countries = new Set();
trips.forEach((t) => t.destinations?.forEach((d) => d.country && countries.add(d.country)));
writeFileSync('/tmp/tt-trips.json', JSON.stringify(trips));
console.log(`Saved /tmp/tt-trips.json — ${trips.length} trips, ${dests} places, ${countries.size} countries.`);
console.log('Countries:', [...countries].sort().join(', '));
await browser.close();
