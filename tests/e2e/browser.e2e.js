// Real-browser E2E (optional): loads the unpacked extension into Chrome, serves a CodeMirror 6
// page at https://www.overleaf.com/project/e2e via request interception, and drives the panel
// against the installed native host and the real `claude` CLI (uses the cheap Haiku 5.5 model).
//
// Prereqs: ./scripts/install-host.sh, `claude` logged in, Google Chrome, `npm install`.
// Run:     npm run test:e2e        (screenshots go to tests/e2e/output/)
// Env:     CHROME_PATH=/path/to/chrome   E2E_WEB=0 to skip the web-search step
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');

const EXT = path.resolve(__dirname, '../../extension');
const EXT_ID = 'lbggnmchbhbpojfdpcfknoppbjpnmgnn';
const OUT = path.join(__dirname, 'output');
const UDD = path.join(OUT, 'chrome-profile');
const HOST_MANIFEST = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.olai.cli_bridge.json');
const TEST_MODEL = 'claude-haiku-5-5';

const DOC = String.raw`\documentclass{article}
\begin{document}
\title{Draft}
\section{Introduction}
we propose an method that are very fast and it beat all baselines \cite{smith2020}.
Our approach use a novel attention mechanism, and we train a CNN on the the data.
Transformers changed natural language processing.

% ai: write one short sentence stating that code will be released
\section{Method}
Our method encodes inputs with a sparse attention layer and decodes them with a small MLP.
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
const log = (...a) => console.log('•', ...a);

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
    defaultViewport: { width: 1400, height: 950 },
    args: ['--window-size=1400,950'],
  });
  try {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(EXT_ID), { timeout: 15000 });
    log('extension loaded with fixed ID');
    const worker = await sw.worker();
    await worker.evaluate((m) => chrome.storage.sync.set({ claudeModel: m, claudeEffort: 'auto' }), TEST_MODEL);

    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('https://www.overleaf.com/project/')) req.respond({ status: 200, contentType: 'text/html', body: HTML });
      else req.continue();
    });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.goto('https://www.overleaf.com/project/e2e', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.cm-editor');
    await page.waitForFunction(() => document.getElementById('overleaf-ai-extension-root'), { timeout: 10000 });

    // ---- CDP helpers that reach into the closed shadow root
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
    async function evalOn(node, fn, ...args) {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendNodeId });
      const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn.toString(), arguments: args.map((value) => ({ value })), returnByValue: true });
      return r.result.value;
    }
    const one = async (cls) => { const [n] = await findAll(cls); if (!n) throw new Error(`no .${cls}`); return n; };
    const text = async (cls) => evalOn(await one(cls), function () { return this.innerText; });
    const visible = async (cls) => evalOn(await one(cls), function () { return !this.hidden && this.offsetParent !== null; });
    async function click(node) {
      await evalOn(node, function () { this.scrollIntoView({ block: 'center' }); });
      const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
      const q = model.content;
      await page.mouse.click((q[0] + q[4]) / 2, (q[1] + q[5]) / 2);
    }
    async function clickText(cls, label) {
      for (const n of await findAll(cls)) {
        const t = await evalOn(n, function () { return this.innerText.trim(); });
        if (t === label || t.startsWith(label)) return click(n);
      }
      throw new Error(`no .${cls} "${label}"`);
    }
    async function waitStatus(re, ms = 120000) {
      const t0 = Date.now();
      let s = '';
      while (Date.now() - t0 < ms) {
        s = await text('status-text');
        if (re.test(s)) return s;
        if (/실패|오류|시간 초과|찾지 못/.test(s)) throw new Error(`run failed: ${s} ${await text('err-detail')}`);
        await sleep(400);
      }
      throw new Error(`status timeout; last="${s}"`);
    }
    const editor = (fn, ...args) => page.evaluate(fn, ...args);
    const selectText = (needle, whole = true) => editor((n, w) => {
      const v = window.__testView; const d = v.state.doc.toString();
      const from = d.indexOf(n); const to = w ? d.indexOf('\n', from) : from + n.length;
      v.dispatch({ selection: { anchor: from, head: to } }); v.focus();
    }, needle, whole);
    const cursorAt = (needle, offset = 0) => editor((n, o) => {
      const v = window.__testView; const pos = v.state.doc.toString().indexOf(n) + o;
      v.dispatch({ selection: { anchor: pos } }); v.focus();
    }, needle, offset);
    const docText = () => editor(() => window.__testView.state.doc.toString());
    const selectedLine = () => editor(() => { const v = window.__testView; return v.state.doc.lineAt(v.state.selection.main.from).number; });

    // ---- open panel, model bar
    await click(await one('launcher'));
    await sleep(800);
    const modelValue = await evalOn(await one('model'), function () { return this.value; });
    const effortValue = await evalOn(await one('effort'), function () { return this.value; });
    const modelOptions = await evalOn(await one('model'), function () { return [...this.options].map((o) => o.value); });
    log('model bar:', modelValue, '| effort:', effortValue, '| options include Opus 5.5 & Fable 5.1:', modelOptions.includes('claude-opus-5-5') && modelOptions.includes('claude-fable-5-1'));
    assert.equal(modelValue, TEST_MODEL);
    assert.equal(effortValue, 'auto');
    const cats = (await text('cats')).replace(/\s+/g, ' ');
    log('categories:', cats);
    await page.screenshot({ path: path.join(OUT, '1-panel.png') });

    // ---- 1) 문법 교정 on a selection; toggle one change off; apply
    await selectText('we propose');
    await sleep(400);
    await clickText('chip', '문법 교정');
    log('grammar:', await waitStatus(/^(완료|변경할).*\[문법 교정\]/));
    const info = await text('diff-info');
    log('diff:', info);
    const chg = await findAll('chg');
    assert.ok(chg.length >= 2, 'expected several changes');
    await click(chg[chg.length - 1]); // reject the last change
    await sleep(200);
    const composed = await evalOn(await one('out'), function () { return this.value; });
    log('after rejecting last change:', JSON.stringify(composed));
    await page.screenshot({ path: path.join(OUT, '2-diff-hunks.png') });
    await clickText('apply', '적용');
    await sleep(400);
    const line5 = (await docText()).split('\n')[4];
    assert.equal(line5, composed);
    log('editor line 5 matches composed text ✓');

    // ---- 2) local lint view and jump
    await clickText('cat', '점검');
    await sleep(800);
    const lintItems = await findAll('lint-list');
    const lintText = await evalOn(lintItems[0], function () { return this.innerText; });
    log('lint:', lintText.split('\n').filter(Boolean).slice(0, 6).join(' | '));
    assert.match(lintText, /반복된 단어/);
    const rep = (await findAll('lint-list'))[0];
    const li = await evalOn(rep, function () { const el = [...this.querySelectorAll('li')].find((x) => /반복된 단어/.test(x.innerText)); el.scrollIntoView(); el.setAttribute('data-e2e', '1'); return el.dataset.line; });
    // click via function on the marked element (inside the closed root)
    await evalOn(rep, function () { this.querySelector('[data-e2e]').click(); });
    await sleep(300);
    log(`lint jump → editor selection on line ${await selectedLine()} (issue line ${li})`);
    assert.equal(String(await selectedLine()), li);
    await page.screenshot({ path: path.join(OUT, '3-lint.png') });

    // ---- 3) title candidates (variants) inserted at cursor
    await clickText('cat', '작성');
    await cursorAt('\\title{Draft}', 0);
    await editor(() => { const v = window.__testView; const d = v.state.doc.toString(); const a = d.indexOf('Draft'); v.dispatch({ selection: { anchor: a, head: a + 5 } }); });
    await sleep(300);
    await clickText('chip', '제목 후보');
    log('titles:', await waitStatus(/^후보.*\[제목 후보\]/));
    const cards = await findAll('variant');
    assert.ok(cards.length >= 3, `expected title candidates, got ${cards.length}`);
    const firstTitle = await evalOn(cards[0], function () { return this.querySelector('pre').innerText; });
    log('first title:', firstTitle);
    await page.screenshot({ path: path.join(OUT, '4-variants.png') });
    await click((await findAll('v-apply'))[0]); // real mouse click: synthetic clicks are ignored by design
    await sleep(400);
    assert.ok((await docText()).includes(`\\title{${firstTitle}}`), 'title replaced');
    log('title replaced in editor ✓');

    // ---- 4) reviewer simulation report (document scope) with line links
    await clickText('cat', '검토');
    await cursorAt('Our method', 0);
    await sleep(300);
    await clickText('chip', '논리·주장 점검');
    log('logic report:', await waitStatus(/^완료.*\[논리·주장 점검\]/, 180000));
    const reportLinks = await evalOn(await one('report'), function () { return [...this.querySelectorAll('a.lref')].map((a) => a.dataset.line); });
    log('report line links:', reportLinks.slice(0, 8).join(', ') || '(none)');
    await page.screenshot({ path: path.join(OUT, '5-report.png') });
    if (reportLinks.length) {
      await evalOn(await one('report'), function () { this.querySelector('a.lref').click(); });
      await sleep(300);
      log(`clicked L${reportLinks[0]} → editor line ${await selectedLine()}`);
      assert.equal(String(await selectedLine()), reportLinks[0]);
    }

    // ---- 5) directive line
    await cursorAt('% ai:', 3);
    await sleep(300);
    await click(await one('run'));
    log('directive:', await waitStatus(/^완료.*\[지시문\]/));
    await clickText('apply', '지시문 줄 대체');
    await sleep(300);
    assert.ok(!(await docText()).includes('% ai:'), 'directive replaced');
    log('directive replaced ✓');

    // ---- 6) web reference search (Claude WebSearch tool)
    if (process.env.E2E_WEB !== '0') {
      await clickText('cat', '문헌');
      await selectText('Transformers changed');
      await sleep(300);
      await clickText('chip', '관련 문헌 찾기');
      const s = await waitStatus(/^완료.*\[관련 문헌 찾기\]/, 300000);
      log('find-refs:', s, '| BibTeX button visible:', await visible('bib'));
      const rep2 = await text('report');
      log('find-refs report excerpt:', rep2.replace(/\s+/g, ' ').slice(0, 220));
      await page.screenshot({ path: path.join(OUT, '6-refs.png') });
    }

    // ---- 7) model picker writes settings
    const modelSel = await one('model');
    await evalOn(modelSel, function () { this.value = 'claude-sonnet-5-5'; this.dispatchEvent(new Event('change', { bubbles: true })); });
    await sleep(300);
    const stored = await worker.evaluate(() => chrome.storage.sync.get('claudeModel'));
    log('model picker saved:', stored.claudeModel);
    assert.equal(stored.claudeModel, 'claude-sonnet-5-5');

    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await clickText('cat', '교정');
    await sleep(300);
    await page.screenshot({ path: path.join(OUT, '7-dark.png') });
  } finally {
    await browser.close();
    fs.rmSync(UDD, { recursive: true, force: true });
  }
  console.log('E2E OK — screenshots in', OUT);
}

main().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
