/** Local visual fixture using the production contest content script and theme CSS. */
import { build } from 'vite';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(resolve(tmpdir(), 'cfx-contest-preview-'));
const entry = resolve(output, 'entry.ts');
const settingsModule = `
  let settings = {handle: 'alice', liveRank: true, contestPanel: true, contestPanelPosition: 'right'};
  const listeners = new Set();
  export const getSettings = async () => ({...settings});
  export const onSettingsChanged = (fn) => {listeners.add(fn); return () => listeners.delete(fn)};
  window.changePreviewSettings = (patch) => {settings = {...settings, ...patch}; for(const fn of listeners) fn(patch)};
`;
const messagingModule = `
  window.previewScenario = 'cf';
  let calls = 0;
  const started = Date.now();
  export async function send() {
    document.querySelector('#requests').textContent = String(++calls);
    if(window.previewScenario === 'offline') throw new Error('Simulated offline mode');
    const type = window.previewScenario === 'icpc' ? 'ICPC' : window.previewScenario === 'ioi' ? 'IOI' : 'CF';
    const elapsed = 1800 + (Date.now() - started) / 1000;
    const points = type === 'CF' ? [500,1000,1500,1750,2000,2500] : type === 'IOI' ? [100,100,100,100,100,100] : [];
    return {
      contest: {id:99, name:'Simulated round', type, phase:window.previewScenario === 'finished' ? 'FINISHED' : 'CODING', frozen:window.previewScenario === 'frozen', relativeTimeSeconds:elapsed, durationSeconds:7200},
      problems: ['A','B','C','D','E','F'].map((index,i) => ({index, name:['First Steps','Counting Paths','A Tricky Query','Two Operations','The Final Challenge','Bonus'][i], points:points[i]})),
      row: {handle:'alice', rank:Math.max(1,42-Math.floor((Date.now()-started)/8000)), points:450, penalty:30, solved:[true,false,false,false,false,false], team:false,
        problemResults: ['A','B','C','D','E','F'].map((_,i) => ({points:i===0 ? (type==='ICPC'?1:type==='IOI'?100:450) : i===4 && type==='IOI'?35:0, rejectedAttemptCount:i===1?2:0, type:'PRELIMINARY'}))},
      submissions: [{id:3,problem:{index:'C'},verdict:'TESTING'},{id:2,problem:{index:'B'},verdict:'WRONG_ANSWER'}], fetchedAt:Date.now()
    };
  }
`;
await writeFile(entry, `
  import ${JSON.stringify(resolve(root, 'src/theme/tokens.css'))};
  import script from ${JSON.stringify(resolve(root, 'src/entrypoints/contest.content.ts'))};
  const cleanups = [];
  script.main({isValid:true, onInvalidated:fn=>cleanups.push(fn), addEventListener:(target,type,fn)=>target.addEventListener(type,fn)});
  document.querySelectorAll('[data-position]').forEach(button=>button.addEventListener('click',()=>window.changePreviewSettings({contestPanelPosition:button.dataset.position})));
  document.querySelectorAll('[data-scenario]').forEach(button=>button.addEventListener('click',()=>{window.previewScenario=button.dataset.scenario; window.changePreviewSettings({handle:'alice'})}));
  document.querySelectorAll('[data-theme]').forEach(button=>button.addEventListener('click',()=>document.documentElement.dataset.cfxTheme=button.dataset.theme));
`);
await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [{
    name: 'contest-preview-fixtures',
    enforce: 'pre',
    resolveId(source) {
      if (/\/lib\/settings(?:\.ts)?$/.test(source)) return '\0preview-settings';
      if (/\/lib\/messaging(?:\.ts)?$/.test(source)) return '\0preview-messaging';
      if (source === 'wxt/utils/define-content-script') return '\0preview-definition';
    },
    load(id) {
      if (id === '\0preview-settings') return settingsModule;
      if (id === '\0preview-messaging') return messagingModule;
      if (id === '\0preview-definition') return 'export const defineContentScript = script => script;';
    },
  }],
  build: { outDir: resolve(output, 'dist'), emptyOutDir: true, copyPublicDir: false, rolldownOptions: { input: entry, output: { format: 'iife', entryFileNames: 'preview.js', assetFileNames: 'preview.[ext]' } } },
});
const buttons = (attribute, choices) => choices.map(([value, label]) => `<button ${attribute}="${value}">${label}</button>`).join(' ');
const html = `<!doctype html><html data-cfx-theme="light"><head><meta charset="utf-8"><title>CF+ contest preview</title>
<link rel="stylesheet" href="/theme/slate.css"><link rel="stylesheet" href="/theme/dark.css">
<style>
body{margin:0;background:var(--cfx-bg);color:var(--cfx-text);font:14px/1.6 Verdana,sans-serif}a{color:var(--cfx-link)}
.review{padding:12px 24px;border-bottom:1px solid var(--cfx-border);background:var(--cfx-surface-2)}.review button{font:12px Verdana;padding:5px 9px;cursor:pointer}
.review p{margin:5px 0}#header{max-width:1200px;margin:24px auto 30px;display:flex;justify-content:space-between;align-items:center}#header strong{font-size:32px;color:var(--cfx-caption)}
.lang-chooser{text-align:right}.layout{max-width:1200px;margin:auto;display:flex;gap:24px;align-items:flex-start}#pageContent{flex:1;min-width:0}#sidebar{width:280px;flex-shrink:0;order:2}
.roundbox{border:1px solid var(--cfx-border);border-radius:6px 6px 0 0;margin-bottom:20px}.caption{border-bottom:1px solid var(--cfx-border);padding:5px 10px;color:var(--cfx-caption);font-weight:bold}
.statement{padding:30px;border:1px solid var(--cfx-border)}.statement h1{text-align:center;font-size:24px}.statement p{max-width:70ch}.user-blue{color:#00e;font-weight:bold}
</style></head><body>
<div class="review"><strong>CF+ local contest preview — simulated data</strong><p>
${buttons('data-scenario', [['cf','Live CF'],['icpc','ICPC'],['ioi','IOI'],['frozen','Frozen'],['offline','Offline'],['finished','Finished']])}
 · Requests: <span id="requests">0</span></p><p>
Position: ${buttons('data-position', [['right','Right'],['top','Top'],['left','Left']])}
 · Theme: ${buttons('data-theme', [['light','Default'],['slate','Slate'],['dark','Pure dark']])}</p></div>
<div id="header"><strong>Codeforces</strong><div class="lang-chooser"><a class="rated-user user-blue" href="https://codeforces.com/profile/alice">alice</a></div></div>
<div class="layout"><aside id="sidebar"><div class="roundbox"><div class="caption">→ Contest</div><p style="padding:10px">Simulated round · coding</p></div></aside>
<main id="pageContent"><article class="statement"><h1>A. First Steps</h1><p>This page runs the production contest navigator with simulated API responses. A is accepted, B has two rejected attempts, C is testing, and D/F are unattempted. IOI mode includes a partial score on E.</p>
<p>The rank changes on each eight-second refresh. Available CF points decay by the elapsed contest minute. Use Finished to verify that the widgets disappear, and Live CF to restore them.</p></article></main></div>
<script src="/preview.js"></script></body></html>`;
const assets = new Map([
  ['/contest/99/problem/A', { type: 'text/html', body: html }],
  ['/preview.js', { type: 'text/javascript', body: await readFile(resolve(output, 'dist/preview.js')) }],
  ...await Promise.all(['slate','dark'].map(async (theme) => [`/theme/${theme}.css`, { type: 'text/css', body: await readFile(resolve(root, `.output/chrome-mv3/theme/${theme}.css`)) }])),
]);
const server = createServer((req, res) => {
  const asset = assets.get(new URL(req.url, 'http://localhost').pathname);
  if (!asset) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' });
  res.end(asset.body);
});
server.listen(4174, '127.0.0.1', () => console.log('Contest preview: http://127.0.0.1:4174/contest/99/problem/A'));
