#!/usr/bin/env node
// Stand-in for the `claude` CLI: echoes stream-json events like `claude -p --output-format stream-json`.
'use strict';
const fs = require('fs');

if (process.argv.includes('--version')) {
  console.log('9.9.9 (Fake Claude)');
  process.exit(0);
}
if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  if (process.env.FAKE_MODE === 'error') {
    emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    return;
  }
  if (process.env.FAKE_MODE === 'hang') {
    setInterval(() => {}, 1000);
    return;
  }
  const text = `ECHO:${input.length}`;
  emit({ type: 'system', subtype: 'init' });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 3) } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(3) } } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.0012 });
});
