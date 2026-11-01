// Real-browser E2E (optional): loads the unpacked extension into Chrome, serves a CodeMirror 6
// page at https://www.overleaf.com/project/e2e via request interception, and drives the panel
// against the installed native host and the real `claude` CLI (uses the cheap haiku model).
//
// Prereqs: ./scripts/install-host.sh, `claude` logged in, Google Chrome, `npm install`.
// Run:     npm run test:e2e        (screenshots go to tests/e2e/output/)
// Override Chrome with CHROME_PATH=/path/to/chrome.
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXT = path.resolve(__dirname, '../../extension');
const EXT_ID = 'lbggnmchbhbpojfdpcfknoppbjpnmgnn';
const OUT = path.join(__dirname, 'output');
const UDD = path.join(OUT, 'chrome-profile');
const HOST_MANIFEST = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.olai.cli_bridge.json');

const DOC = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
we propose an method that are very fast and it beat all baselines \cite{smith2020}.
Our approach use a novel attention mechanism.

% ai: write one short sentence stating that code will be released
\end{document}
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Fake Overleaf</title>
<style>body{margin:0;font-family:sans-serif}.bar{height:40px;background:#1b222c;color:#fff;display:flex;align-items:center;padding:0 12px}
#editor{height:calc(100vh - 40px)} .cm-editor{height:100%}</style></head>
<body><div class="bar">Fake Overleaf — <span class="file-tree"><span role="treeitem" aria-selected="true" aria-label="main.tex">main.tex</span></span></div>
<div id="editor"></div>
<script type="module">
import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1';
window.__testView = new EditorView({ doc: ${JSON.stringify(DOC)}, extensions: [basicSetup, EditorView.lineWrapping], parent: document.getElementById('editor') });
</script></body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.rmSync(UDD, { recursive: true, force: true });
  if (!fs.existsSync(HOST_MANIFEST)) throw new Error('native host not installed — run ./scripts/install-host.sh first');
  fs.mkdirSync(path.join(UDD, 'NativeMessagingHosts'), { recursive: true });
  fs.copyFileSync(HOST_MANIFEST, path.join(UDD, 'NativeMessagingHosts', 'com.olai.cli_bridge.json'));

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    pipe: true,
    enableExtensions: [EXT],
    userDataDir: UDD,
    defaultViewport: { width: 1400, height: 900 },
    args: ['--window-size=1400,900'],
  });
  const log = (...a) => console.log('•', ...a);
  try {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(EXT_ID), { timeout: 15000 });
    log('extension loaded with fixed ID:', sw.url());
    const worker = await sw.worker();
    await worker.evaluate(() => chrome.storage.sync.set({ claudeModel: 'haiku', claudeEffort: 'low' }));
    const ping = await worker.evaluate(() => new Promise((res) => chrome.runtime.sendNativeMessage('com.olai.cli_bridge', { type: 'ping' }, (r) => res(r || chrome.runtime.lastError?.message))));
    log('native ping from extension:', JSON.stringify(ping).slice(0, 200));

    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('https://www.overleaf.com/project/')) req.respond({ status: 200, contentType: 'text/html', body: HTML });
      else req.continue();
    });
    await page.goto('https://www.overleaf.com/project/e2e', { waitUntil: 'networkidle0' });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.waitForSelector('.cm-editor');
    await page.waitForFunction(() => document.getElementById('overleaf-ai-extension-root'), { timeout: 10000 });
    log('content scripts injected; main-world flag =', await page.evaluate(() => window.__olaiMainWorld));

    // --- main-world RPC: does it find the CodeMirror view?
    const ctx = await page.evaluate(() => new Promise((resolve) => {
      const id = 'probe1';
      window.addEventListener('message', function h(e) { if (e.data?.channel === 'olai:mw->cs' && e.data.id === id) { window.removeEventListener('message', h); resolve(e.data); } });
      window.postMessage({ channel: 'olai:cs->mw', id, cmd: 'getContext', args: {} }, location.origin);
    }));
    log('getContext ok =', ctx.ok, '| docLength =', ctx.result?.docLength, '| fileName =', ctx.result?.fileName, ctx.error || '');

    // CDP helpers to reach into the closed shadow root.
    const cdp = await page.createCDPSession();
    async function findAll(cls) {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const out = [];
      const walk = (n) => {
        const attrs = n.attributes || [];
        const ci = attrs.indexOf('class');
        if (ci >= 0 && attrs[ci + 1].split(/\s+/).includes(cls)) out.push(n);
        for (const c of n.children || []) walk(c);
        for (const c of n.shadowRoots || []) walk(c);
      };
      walk(root);
      return out;
    }
    async function clickNode(node) {
      const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
      const q = model.content;
      await page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2);
    }
    async function text(cls) {
      const [n] = await findAll(cls);
      if (!n) return null;
      const { outerHTML } = await cdp.send('DOM.getOuterHTML', { backendNodeId: n.backendNodeId });
      return outerHTML.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
    }
    async function clickByText(cls, label) {
      for (const n of await findAll(cls)) {
        const { outerHTML } = await cdp.send('DOM.getOuterHTML', { backendNodeId: n.backendNodeId });
        if (outerHTML.replace(/<[^>]+>/g, '').trim() === label) return clickNode(n);
      }
      throw new Error(`no ${cls} "${label}"`);
    }
    async function waitStatus(re, ms = 60000) {
      const t0 = Date.now();
      let s = '';
      while (Date.now() - t0 < ms) { s = await text('status-text'); if (re.test(s)) return s; await sleep(400); }
      throw new Error(`status timeout; last="${s}"`);
    }

    // --- 1) select the bad sentence, open panel, run 문법 교정
    await page.evaluate(() => {
      const v = window.__testView; const d = v.state.doc.toString();
      const from = d.indexOf('we propose'); const to = d.indexOf('\n', from);
      v.dispatch({ selection: { anchor: from, head: to } }); v.focus();
    });
    const [launcher] = await findAll('launcher');
    await clickNode(launcher);
    await sleep(600);
    log('panel target label:', (await text('ctx'))?.trim());
    await page.screenshot({ path: path.join(OUT, '1-panel.png') });

    await clickByText('chip', '문법 교정');
    await sleep(700);
    log('while running:', await text('status-text'));
    log('done:', await waitStatus(/완료|변경할/));
    await page.screenshot({ path: path.join(OUT, '2-diff.png') });

    await clickByText('apply', '적용 (교체)');
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, '2b-applied.png') });
    await sleep(200);
    log('after apply status:', await text('status-text'));
    const line = await page.evaluate(() => window.__testView.state.doc.line(4).text);
    log('editor line 4 now:', line);

    // --- 2) directive line: cursor on "% ai:" then 실행 with empty instruction
    await page.evaluate(() => {
      const v = window.__testView; const d = v.state.doc.toString();
      const pos = d.indexOf('% ai:') + 3; v.dispatch({ selection: { anchor: pos } }); v.focus();
    });
    await sleep(500);
    const [runBtn] = await findAll('run');
    await clickNode(runBtn);
    log('directive done:', await waitStatus(/완료/));
    await clickByText('apply', '지시문 줄 대체');
    await sleep(400);
    const doc2 = await page.evaluate(() => window.__testView.state.doc.toString());
    const l = doc2.split('\n');
    log('directive line replaced with:', l[l.findIndex((x) => x.startsWith('\\end{document}')) - 1]);
    log('"% ai:" still present?', doc2.includes('% ai:'));

    // --- 3) undo restores
    await page.evaluate(() => window.__testView.focus());
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
    await sleep(200);
    log('after ⌘Z, directive restored?', (await page.evaluate(() => window.__testView.state.doc.toString())).includes('% ai:'));

    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, '3-dark.png') });
  } finally {
    await browser.close();
    fs.rmSync(UDD, { recursive: true, force: true });
  }
  console.log('E2E OK — screenshots in', OUT);
}

main().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
