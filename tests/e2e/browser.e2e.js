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

// A fake Overleaf page: CodeMirror 6 editor + a file tree whose items carry doc ids like Overleaf's.
const fakePage = (doc, openName, others = []) => `<!doctype html><html><head><meta charset="utf-8"><title>Fake Overleaf</title>
<style>body{margin:0;font-family:sans-serif}.bar{height:40px;background:#1b222c;color:#fff;display:flex;align-items:center;gap:10px;padding:0 12px}
#editor{height:calc(100vh - 40px)} .cm-editor{height:100%}</style></head>
<body><div class="bar">Fake Overleaf — <ul class="file-tree" style="display:flex;gap:8px;list-style:none;margin:0;padding:0">
<li role="treeitem" aria-selected="true" aria-label="${openName}"><span class="entity" data-file-id="open1" data-file-type="doc">${openName}</span></li>
${others.map((o) => `<li role="treeitem" aria-selected="false" aria-label="${o.name}"><span class="entity" data-file-id="${o.id}" data-file-type="doc">${o.name}</span></li>`).join('')}
</ul></div>
<div id="editor"></div>
<script>window.__pageSaw = []; window.addEventListener('message', (e) => { if (/olai/.test(JSON.stringify(e.data || ''))) window.__pageSaw.push(e.data); });</script>
<script type="module">
import { EditorView, basicSetup } from 'https://esm.sh/codemirror@6.0.1';
window.__testView = new EditorView({ doc: ${JSON.stringify(doc)}, extensions: [basicSetup, EditorView.lineWrapping], parent: document.getElementById('editor') });
</script></body></html>`;
const HTML = fakePage(DOC, 'main.tex');

const BIB_DOC = String.raw`@article{vaswani2017attention,
  title={Attention is all you need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  journal={arXiv preprint arXiv:1706.03762},
  year={2017}
}

@misc{devlin2018bert,
  title={BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author={Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton and Toutanova, Kristina},
  eprint={1810.04805},
  archivePrefix={arXiv},
  year={2018}
}

@article{unusedthing2020,
  title={A paper nobody cites},
  author={Nobody, A.},
  journal={Journal of Nothing},
  year={2020}
}
`;
const MAIN_TEX = String.raw`\documentclass{article}
egin{document}
Transformers \cite{vaswani2017attention} and BERT \citep{devlin2018bert} build on residual networks \cite{he2016deep}, which won ImageNet in 2015.
\end{document}
`;
const BIB_HTML = fakePage(BIB_DOC, 'refs.bib', [{ id: 'mainid', name: 'main.tex' }]);

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
      const u = req.url();
      if (u.startsWith('https://www.overleaf.com/Project/e2ebib/doc/mainid/download')) req.respond({ status: 200, contentType: 'text/plain', body: MAIN_TEX });
      else if (u.startsWith('https://www.overleaf.com/project/e2ebib')) req.respond({ status: 200, contentType: 'text/html', body: BIB_HTML });
      else if (u.startsWith('https://www.overleaf.com/project/')) req.respond({ status: 200, contentType: 'text/html', body: HTML });
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

    const ONLY_BIB = process.env.E2E_ONLY_BIB === '1';
    if (!ONLY_BIB) {
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

    // ---- 7) autocomplete (auto): pause after typing → ghost text → Tab accepts
    const ghost = () => editor(() => { const g = document.querySelector('.olai-ghost'); return g && g.style.display !== 'none' ? g.textContent : ''; });
    async function waitGhost(ms = 30000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const g = await ghost(); if (g) return g; await sleep(250); }
      return '';
    }
    await cursorAt('Transformers changed natural language processing.', 'Transformers changed natural language processing.'.length);
    await page.keyboard.type(' Since then, attention models have', { delay: 25 });
    const t0 = Date.now();
    const suggestion = await waitGhost();
    log(`autocomplete ghost after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(suggestion));
    assert.ok(suggestion, 'expected a ghost suggestion');
    await page.screenshot({ path: path.join(OUT, '8-autocomplete.png') });
    await sleep(4000); // let the stream finish so the ghost is final
    const finalSug = await ghost();
    const lineBefore = (await docText()).split('\n')[6];
    await page.keyboard.press('Tab');
    await sleep(300);
    const lineAfter = (await docText()).split('\n')[6];
    log('Tab accepted →', JSON.stringify(lineAfter.slice(-100)));
    assert.equal(lineAfter, lineBefore + finalSug, 'Tab inserted exactly the ghost text');
    assert.ok(!/have\s*have/.test(lineAfter), 'no echoed word');
    assert.match(lineAfter, /models have\s\S/, 'a space separates the next word');
    assert.equal(await ghost(), '');

    // ---- 8) autocomplete (manual): nothing on pause; Alt+\ requests; Esc dismisses
    await evalOn(await one('ac-mode'), function () { this.value = 'manual'; this.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.keyboard.type(' We', { delay: 25 });
    await sleep(2500);
    assert.equal(await ghost(), '', 'manual mode: no automatic suggestion');
    await page.keyboard.down('Alt');
    await page.keyboard.press('Backslash');
    await page.keyboard.up('Alt');
    const manualSug = await waitGhost();
    log('manual (Alt+\\) ghost:', JSON.stringify(manualSug));
    assert.ok(manualSug);
    const beforeEsc = await docText();
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await ghost(), '');
    assert.equal(await docText(), beforeEsc, 'Esc leaves the document unchanged');
    log('Esc dismissed ✓');
    await evalOn(await one('ac-mode'), function () { this.value = 'off'; this.dispatchEvent(new Event('change', { bubbles: true })); });

    // ---- 9) term unification across the document (one transaction)
    await editor(() => {
      const v = window.__testView; const d = v.state.doc.toString(); const at = d.indexOf('\\section{Method}');
      v.dispatch({ changes: { from: at, insert: 'We pre-train on a data set. Pretraining helps, and the data set is public. We optimise it, then optimize it and optimize again.\n' } });
    });
    await clickText('cat', '점검');
    await sleep(300);
    await clickText('chip', '용어 통일');
    await sleep(900);
    const termsText = (await text('lint-view')).replace(/\s+/g, ' ');
    log('terms view:', termsText.slice(0, 200));
    await page.screenshot({ path: path.join(OUT, '9-terms.png') });
    await click(await one('terms-apply'));
    await sleep(600);
    const unified = await docText();
    assert.ok(!/optimise/.test(unified), 'optimise → optimize');
    log('after unify:', JSON.stringify(unified.split('\n').find((l) => l.startsWith('We pre')) || unified.split('\n').find((l) => /optimize it/.test(l))));
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
    await editor(() => window.__testView.focus());
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
    await sleep(200);
    log('one ⌘Z restores all term changes:', /optimise/.test(await docText()));

    // ---- 10) generated table → package prompt (기입 요청) → preamble insertion
    await clickText('cat', 'LaTeX');
    await editor(() => {
      const v = window.__testView; const d = v.state.doc.toString(); const at = d.indexOf('\\end{document}');
      v.dispatch({ changes: { from: at, insert: 'Model, Accuracy, F1\nBaseline, 81.2, 79.0\nOurs, 86.5, 84.1\n' } });
      const d2 = v.state.doc.toString(); const a = d2.indexOf('Model, Accuracy'); const b = d2.indexOf('84.1') + 4;
      v.dispatch({ selection: { anchor: a, head: b } }); v.focus();
    });
    await sleep(300);
    await clickText('chip', '표 만들기');
    log('table:', await waitStatus(/^(완료|변경할).*\[표 만들기\]/));
    await clickText('apply', '적용');
    await sleep(1200);
    const prompt = await visible('pkg-prompt');
    const promptText = prompt ? (await text('pkg-msg')).replace(/\s+/g, ' ') : '(no prompt)';
    log('package prompt:', promptText);
    await page.screenshot({ path: path.join(OUT, '10-pkg-prompt.png') });
    assert.ok(prompt, 'expected a package prompt (booktabs)');
    await click(await one('pkg-add'));
    await sleep(500);
    const pre = (await docText()).split('\\begin{document}')[0];
    log('preamble now:', JSON.stringify(pre));
    assert.match(pre, /\\usepackage\{booktabs\}/);

    // ---- 11) private channel: page scripts never saw extension traffic, and the bridge node is not in the DOM
    const saw = await editor(() => ({ n: window.__pageSaw.length, node: !!document.querySelector('olai-bridge') }));
    log('page-visible extension messages:', saw.n, '| bridge node in DOM:', saw.node);
    assert.equal(saw.n, 0);
    assert.equal(saw.node, false);

    } // end of !ONLY_BIB

    // ---- 12) BibTeX: arXiv → published, missing citations, add by DOI, audit (real metadata APIs, no AI)
    await page.goto('https://www.overleaf.com/project/e2ebib', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.cm-editor');
    await page.waitForFunction(() => document.getElementById('overleaf-ai-extension-root'), { timeout: 10000 });
    await sleep(1200);
    const ls = await evalOn(await one('launcher'), function () { const r = this.getBoundingClientRect(); return { hidden: this.hidden, display: getComputedStyle(this).display, w: r.width, h: r.height, panel: !this.parentElement.querySelector('.panel').hidden }; });
    log('bib page launcher state:', JSON.stringify(ls));
    if (ls.panel) { /* panel already open */ } else await click(await one('launcher'));
    await sleep(500);
    await clickText('cat', '문헌');
    await clickText('chip', 'arXiv → 출판본');
    await sleep(1500);
    log('bib summary:', (await text('bib-view')).split('\n')[0]);
    await click(await one('bib-check-pub'));
    const t1 = Date.now();
    for (let i = 0; i < 120; i++) { await sleep(500); const tx = await text('bib-view'); if (!/확인 중/.test(tx) && /devlin2018bert/.test(tx)) break; }
    const upText = (await text('bib-view')).replace(/\s+/g, ' ');
    log(`publication check (${((Date.now() - t1) / 1000).toFixed(1)}s):`, upText.slice(0, 400));
    await page.screenshot({ path: path.join(OUT, '11-bib-upgrade.png') });
    assert.match(upText, /devlin2018bert → [^·]*(NAACL|North American|Association for Computational)/i);
    await click(await one('bib-apply-up'));
    await sleep(1500);
    const bibAfter = await docText();
    assert.match(bibAfter, /@inproceedings\{devlin2018bert,/);
    assert.match(bibAfter, /10\.18653\/v1\/n19-1423/i);
    log('devlin2018bert corrected → @inproceedings with DOI 10.18653/v1/N19-1423 ✓', /@inproceedings\{vaswani2017attention/.test(bibAfter) ? '| vaswani → NeurIPS ✓' : '| vaswani unchanged (S2 busy?)');

    await clickText('chip', '누락 인용 채우기');
    await sleep(1500);
    await click(await one('bib-find-missing'));
    for (let i = 0; i < 60; i++) { await sleep(500); if (/일치도/.test(await text('bib-view')) || /찾지 못했습니다/.test(await text('bib-view'))) break; }
    const missText = (await text('bib-view')).replace(/\s+/g, ' ');
    log('missing:', missText.slice(0, 300));
    assert.match(missText, /he2016deep/);
    await click((await findAll('bib-add-one'))[0]);
    for (let i = 0; i < 20 && !/he2016deep/.test(await docText()); i++) await sleep(400);
    const added = await docText();
    assert.match(added, /@\w+\{he2016deep,/);
    log('he2016deep added:', (added.match(/@\w+\{he2016deep,[\s\S]*?\n\}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160));

    await clickText('chip', 'BibTeX 추가');
    await sleep(1200);
    const input = await one('bib-input');
    await evalOn(input, function () { this.focus(); });
    await page.keyboard.type('10.1145/3065386');
    await click(await one('bib-search'));
    for (let i = 0; i < 40; i++) { await sleep(400); if ((await findAll('bib-add-one')).length) break; }
    log('DOI lookup:', (await text('bib-results')).replace(/\s+/g, ' ').slice(0, 160));
    await click((await findAll('bib-add-one'))[0]);
    for (let i = 0; i < 20 && !/3065386/.test(await docText()); i++) await sleep(400);
    assert.match(await docText(), /3065386/);
    log('DOI entry appended ✓');

    await clickText('chip', 'BibTeX 점검');
    await sleep(1500);
    const auditText = (await text('bib-view')).replace(/\s+/g, ' ');
    log('audit:', auditText.slice(0, 260));
    assert.match(auditText, /unusedthing2020/);
    await page.screenshot({ path: path.join(OUT, '12-bib-audit.png') });

    await page.goto('https://www.overleaf.com/project/e2e', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.cm-editor');
    await sleep(800);
    await click(await one('launcher'));
    await sleep(400);

    // ---- 13) model picker writes settings
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
