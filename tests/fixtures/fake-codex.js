#!/usr/bin/env node
// Stand-in for the `codex` CLI: `codex exec ... -o FILE -` writes the last message to FILE.
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log('codex-cli 0.0.0-fake');
  process.exit(0);
}
if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify({ args: argv, cwd: process.cwd() }));
const out = argv[argv.indexOf('-o') + 1];
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  process.stderr.write('[codex] thinking…\n');
  fs.writeFileSync(out, `CODEX:${input.includes('<task>') ? 'ok' : 'missing-task'}`);
  process.stdout.write('CODEX:stdout\n');
});
