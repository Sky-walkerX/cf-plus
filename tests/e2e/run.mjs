/**
 * End-to-end smoke test with the built extension loaded into Chromium.
 *
 * Live Codeforces pages sit behind a Cloudflare human check that automated browsers can't
 * pass, so page HTML is served from captured fixtures AT THE REAL codeforces.com URLs (content
 * scripts match normally). Static assets and the public API go to the network as usual.
 *
 *   npm run build
 *   CFX_FIXTURES=/dir/with/{profile,problem,problemset}.html node tests/e2e/run.mjs [outDir]
 *
 * Optional: CFX_CHROMIUM=/path/to/chromium to reuse an installed build.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ext = resolve(import.meta.dirname, '../../.output/chrome-mv3');
const fx = process.env.CFX_FIXTURES;
if (!fx) throw new Error('Set CFX_FIXTURES');
const out = resolve(process.argv[2] ?? `${tmpdir()}/cfx-e2e`);
mkdirSync(out, { recursive: true });

const pages = {
  standings: { url: 'https://codeforces.com/contest/2272/standings', file: 'standings.html' },
  profile: { url: 'https://codeforces.com/profile/SkywalkerX', file: 'profile.html' },
  problemset: { url: 'https://codeforces.com/problemset', file: 'problemset.html' },
  problem: { url: 'https://codeforces.com/problemset/problem/2133/C', file: 'problem.html' },
};

const ctx = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  executablePath: process.env.CFX_CHROMIUM,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

for (const p of Object.values(pages)) {
  const html = readFileSync(resolve(fx, p.file), 'utf8')
    // Fixture captured after scripts ran; drop CF's auto-reload/analytics noise.
    .replace(/<script async="" src="https:\/\/www\.googletagmanager[^<]*<\/script>/g, '');
  await ctx.route(p.url, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const setSettings = (s) => sw.evaluate((s) => chrome.storage.sync.set(s), s);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const page = await ctx.newPage();
// Fixtures were captured after MathJax rendered; drop its output so it re-typesets cleanly.
await page.addInitScript(() =>
  document.addEventListener('DOMContentLoaded', () =>
    document.querySelectorAll('.MathJax_Preview, .MathJax, .MathJax_Display, .MathJax_SVG, #MathJax_Message').forEach((e) => e.remove()),
  ),
);
const errors = [];
// Only errors thrown from extension code count (CF's own scripts fail on fixture pages).
page.on('pageerror', (e) => /chrome-extension:\/\//.test(e.stack ?? '') && errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && /chrome-extension:\/\/|CF\+/.test(`${m.text()} ${m.location().url}`) && errors.push(m.text()));

const BG = { light: 'rgb(255, 255, 255)', slate: 'rgb(16, 21, 28)', dark: 'rgb(10, 11, 13)' };

for (const theme of ['light', 'slate', 'dark']) {
  await setSettings({ theme, handle: 'SkywalkerX', spoilerFree: false, imageMode: 'card' });
  await page.waitForTimeout(400); // background re-registers the theme CSS

  // ---- profile
  await page.goto(pages.profile.url, { waitUntil: 'domcontentloaded' });
  const hm = await page.waitForFunction(() => document.documentElement.dataset.cfxHeatmap === 'on', null, { timeout: 60_000 }).then(
    () => true,
    () => false,
  );
  check(`[${theme}] heatmap mounted`, hm);
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => {
    const canvas = document.querySelector('#usersRatingGraphPlaceholder canvas.flot-base');
    return {
      nativeShown: getComputedStyle(document.querySelector('#userActivityGraph')).display !== 'none',
      below: !!(document.querySelector('#userActivityGraph').compareDocumentPosition(document.querySelector('#cfx-heatmap')) & Node.DOCUMENT_POSITION_FOLLOWING),
      counters: !!document.querySelector('._UserActivityFrame_footer') && getComputedStyle(document.querySelector('._UserActivityFrame_footer')).display !== 'none',
      cells: document.querySelector('#cfx-heatmap')?.shadowRoot?.querySelectorAll('rect').length ?? 0,
      tabs: [...(document.querySelector('#cfx-analytics')?.shadowRoot?.querySelectorAll('.tabs button') ?? [])].map((b) => b.textContent),
      graph: !!canvas && getComputedStyle(document.querySelector('#usersRatingGraphPlaceholder')).display !== 'none',
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });
  check(`[${theme}] CF grid and counters kept, CF+ heatmap below`, state.nativeShown && state.counters && state.below);
  check(`[${theme}] heatmap has a year of cells`, state.cells >= 365, `${state.cells} cells`);
  check(`[${theme}] analytics tabs`, state.tabs.length >= 5, state.tabs.join(' | '));
  check(`[${theme}] CF rating graph kept`, state.graph);
  check(`[${theme}] page background`, state.bg === BG[theme], state.bg);

  // Hover a solved day → tooltip lists problems.
  const tip = await page.evaluate(async () => {
    const root = document.querySelector('#cfx-heatmap').shadowRoot;
    const cell = [...root.querySelectorAll('rect')].reverse().find((r) => !r.style.fill.includes('cell-empty') && r.style.fill !== 'transparent');
    cell?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    return root.querySelectorAll('.tip .t-row').length;
  });
  check(`[${theme}] heatmap tooltip lists problems`, tip > 0, `${tip} rows`);

  // Screenshot each analytics tab.
  for (const [i, name] of ['ratings', 'tags', 'unsolved', 'contests', 'verdicts'].entries()) {
    await page.evaluate((i) => document.querySelector('#cfx-analytics').shadowRoot.querySelectorAll('.tabs button')[i].click(), i);
    await page.waitForTimeout(120);
    await page.locator('#cfx-analytics').screenshot({ path: `${out}/tab-${name}-${theme}.png` });
  }
  await page.evaluate(() => document.querySelector('#cfx-analytics').shadowRoot.querySelectorAll('.tabs button')[0].click());
  await page.screenshot({ path: `${out}/profile-${theme}.png`, fullPage: true });

  // ---- problemset
  await page.goto(pages.problemset.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/problemset-${theme}.png` });

  // ---- problem
  await page.goto(pages.problem.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cfx-friends-box', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  check(`[${theme}] no toolbar above the statement`, await page.evaluate(() => !document.querySelector('#cfx-problem-tools')));
  check(`[${theme}] stopwatch at the top of the statement`, await page.evaluate(() => document.querySelector('.problem-statement')?.firstElementChild?.id === 'cfx-stopwatch'));
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: `${out}/problem-${theme}.png`, fullPage: tall < 20000 });
}

// ---- rating graph recolouring (CF's real jQuery + flot, CF's band markings)
const GRAPH_URL = 'https://codeforces.com/profile/CfxGraphTest';
await ctx.route(GRAPH_URL, (route) =>
  route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(resolve(import.meta.dirname, 'rating-graph.html'), 'utf8') }),
);
const sampleBand = () =>
  page.evaluate(() => {
    const c = document.querySelector('#usersRatingGraphPlaceholder canvas.flot-base');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(Math.round(c.width * 0.3), Math.round(c.height * 0.12), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
const EXPECT = { light: [170, 170, 255], slate: [49, 55, 78], dark: [62, 64, 91] };
for (const theme of ['light', 'slate', 'dark']) {
  await setSettings({ theme });
  await page.waitForTimeout(300);
  await page.goto(GRAPH_URL, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const band = await sampleBand();
  const ok = !!band && band.every((v, i) => Math.abs(v - EXPECT[theme][i]) <= 3);
  check(`[${theme}] rating graph band colour`, ok, band ? `rgb(${band.join(', ')})` : 'no canvas');
}
await setSettings({ theme: 'light' });
await page.waitForTimeout(800);
const live = await sampleBand();
check('rating graph re-plots on live theme switch', !!live && live[2] === 255, live ? `rgb(${live.join(', ')})` : 'no canvas');

// ---- standings: rating changes (official for this finished contest) + performance
await setSettings({ theme: 'dark', predictor: true, predictorPerf: true, friends: true, extraFriends: ['RainRecall'] });
await page.goto(pages.standings.url, { waitUntil: 'domcontentloaded' });
const filled = await page
  .waitForFunction(() => [...document.querySelectorAll('table.standings tr[participantid] td.cfx-col')].filter((td) => td.textContent && td.textContent !== '…').length > 50, null, { timeout: 120_000 })
  .then(() => true, () => false);
const st = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('table.standings tr[participantid]')];
  const first = rows[0];
  const cols = first ? [...first.querySelectorAll('td.cfx-col')] : [];
  return {
    header: [...document.querySelectorAll('table.standings tr:first-child th.cfx-col')].map((th) => th.textContent),
    firstDelta: cols[0]?.textContent, firstTitle: cols[0]?.getAttribute('title'), firstPerf: cols[1]?.textContent,
    note: document.getElementById('cfx-standings-note')?.textContent ?? '',
    friendRows: document.querySelectorAll('tr.cfx-friend-row').length,
    lastHasRight: first?.lastElementChild?.classList.contains('right'),
  };
});
check('standings: Δ and Perf columns filled', filled && st.header.join(',') === 'Δ,Perf', JSON.stringify(st.header));
check('standings: official change for rank 1', /^[+−]\d+$/.test(st.firstDelta ?? '') && /→/.test(st.firstTitle ?? ''), `${st.firstDelta} (${st.firstTitle}), perf ${st.firstPerf}`);
check('standings: explains the numbers', /official rating change/.test(st.note), st.note.slice(0, 80));
check('standings: friend row highlighted', st.friendRows === 1, `${st.friendRows} rows`);
check('standings: CF table edge kept', st.lastHasRight === true);
await page.locator('table.standings').screenshot({ path: `${out}/standings-dark.png` });

// ---- problemset: estimated ratings for the newest (unrated) problems
await page.goto(pages.problemset.url, { waitUntil: 'domcontentloaded' });
const est = await page.waitForSelector('.cfx-estimated', { timeout: 240_000 }).then(() => true, () => false);
const estText = await page.evaluate(() => [...document.querySelectorAll('.cfx-estimated')].slice(0, 6).map((e) => e.closest('tr')?.querySelector('td a')?.textContent?.trim() + ' ' + e.textContent));
check('problemset: estimates for unrated problems', est, estText.join(' | '));
await page.screenshot({ path: `${out}/problemset-estimates.png` });

// ---- problem page: friends box
await page.goto(pages.problem.url, { waitUntil: 'domcontentloaded' });
const box = await page.waitForSelector('#cfx-friends-box', { timeout: 30_000 }).then(() => true, () => false);
await page.waitForTimeout(1500);
const boxText = await page.evaluate(() => document.getElementById('cfx-friends-box')?.textContent?.replace(/\s+/g, ' ').trim() ?? '');
check('problem page: friends box', box && /Friends/.test(boxText), boxText.slice(0, 120));
await page.locator('#sidebar').screenshot({ path: `${out}/problem-sidebar.png` });
await setSettings({ extraFriends: [] });

// ---- spoiler-free mode
await setSettings({ theme: 'dark', spoilerFree: true });
await page.goto(pages.problemset.url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const blurred = await page.evaluate(() => {
  const tag = document.querySelector('table.problems tr:not([data-cfx-revealed]) a.notice[href*="tags="]');
  return tag ? getComputedStyle(tag).filter : 'none';
});
check('spoiler-free blurs tags on unsolved rows', blurred.includes('blur'), blurred);
await page.screenshot({ path: `${out}/problemset-spoiler.png` });
await setSettings({ spoilerFree: false });

// ---- popup
const extId = sw.url().split('/')[2];
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 360, height: 640 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
// API calls are queued at 1 per 2 s, so the contest list can take a few seconds on a cold cache.
const listed = await popup.waitForSelector('.contests li, .empty', { timeout: 30_000 }).then(() => true, () => false);
await popup.screenshot({ path: `${out}/popup-dark.png`, fullPage: true });
check('popup renders contests or empty state', listed);

check('no page errors from CF+', errors.length === 0, errors.slice(0, 3).join(' | '));
await ctx.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${out}`);
process.exit(failed ? 1 : 0);
