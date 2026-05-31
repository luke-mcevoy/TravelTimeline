// Capture README demo screenshots from the running dev app using the cached
// real-photo story (/tmp/tt-trips.json). View the PNGs in docs/screenshots/.
import puppeteer from 'puppeteer';
import { existsSync, readFileSync, mkdirSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const trips = JSON.parse(readFileSync('/tmp/tt-trips.json', 'utf8'));

const W = 1280;
const H = 800;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: existsSync(CHROME) ? CHROME : puppeteer.executablePath(),
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    `--window-size=${W},${H}`,
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((t) => {
  localStorage.setItem('travel-timeline-trips', JSON.stringify(t));
}, trips);
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 });

// Wait for the globe instance to exist.
await page.waitForFunction(() => !!(window.__TT__ && window.__TT__.globe.getState().globeInstance), {
  timeout: 30000,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

async function pose({ lat, lng, alt, idx = null, card = false }) {
  await page.evaluate(
    ({ lat, lng, alt, idx, card }) => {
      const tt = window.__TT__;
      const trip = tt.trip.getState();
      if (idx === null) trip.setAnimation({ isPlaying: false });
      else trip.setAnimation({ isPlaying: false, currentDestinationIndex: idx });
      tt.ui.getState().setShowPhotoCard(!!card);
      const g = tt.globe.getState().globeInstance;
      if (g) {
        g.pointOfView({ lat, lng, altitude: alt }, 0);
        try {
          g.controls().dispatchEvent({ type: 'change' });
        } catch {}
      }
    },
    { lat, lng, alt, idx, card }
  );
}

async function clickByTitle(title) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '') === t);
    if (b) {
      b.click();
      return true;
    }
    return false;
  }, title);
}
async function clickByText(re) {
  return page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const b = [...document.querySelectorAll('button')].find((x) => rx.test(x.textContent || ''));
    if (b) {
      b.click();
      return true;
    }
    return false;
  }, re.source);
}
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const closePanel = () =>
  page.evaluate(() => {
    const b = document.querySelector('button[class*="closeButton"]');
    if (b) b.click();
  });

// 1) Hero — full route + active city + photo card (Santorini).
await closePanel();
await pose({ lat: 40, lng: 18, alt: 1.6, idx: 8, card: true });
await sleep(5000);
await shot('01-hero');

// 2) Satellite close-up (Dubrovnik) + active label, card + panel hidden.
await closePanel();
await pose({ lat: 42.64, lng: 18.11, alt: 0.18, idx: 10, card: false });
await sleep(7000);
await shot('02-satellite');

// 3) Around the World overlay.
await pose({ lat: 30, lng: 12, alt: 2.2, idx: 8, card: false });
await sleep(400);
await clickByTitle('How many times around the Earth');
await sleep(4000);
await shot('03-around-the-world');

// 4) To the Moon (wait for the orbit to finish + button to appear).
let moonBtn = false;
for (let i = 0; i < 16 && !moonBtn; i++) {
  await sleep(700);
  moonBtn = await clickByText(/To the Moon/);
}
await sleep(3200);
await shot('04-to-the-moon');
// close overlay
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Close');
  if (b) b.click();
});
await sleep(400);

// 5) Passport report.
await clickByTitle('Travel passport');
await sleep(2200);
await shot('05-passport');
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Close');
  if (b) b.click();
});
await sleep(400);

// 6) Space view + Moon beam — Earth, the progress beam + node, and the Moon.
await closePanel();
await pose({ lat: 2, lng: 38, alt: 7.6, idx: 8, card: false });
await sleep(3200);
await shot('06-space');

await browser.close();
console.log('done');
