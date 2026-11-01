#!/usr/bin/env node
// Stand-in for the `claude` CLI: echoes stream-json events like `claude -p --output-format stream-json`.
'use strict';
const fs = require('fs');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log('9.9.9 (Fake Claude)');
  process.exit(0);
}
const sysIdx = argv.indexOf('--system-prompt-file');
const record = {
  args: argv,
  system: sysIdx >= 0 ? fs.readFileSync(argv[sysIdx + 1], 'utf8') : null,
  systemMode: sysIdx >= 0 ? (fs.statSync(argv[sysIdx + 1]).mode & 0o777).toString(8) : null,
  cwd: process.cwd(),
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null, CLAUDE_CODE_DISABLE_CLAUDE_MDS: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS || null, CLAUDE_CODE_DISABLE_AUTO_MEMORY: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY || null },
};
if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(record));

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const mode = process.env.FAKE_MODE;
  if (mode === 'error') {
    emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    return;
  }
  if (mode === 'hang' || mode === 'hang-tree') {
    process.on('SIGTERM', () => {}); // ignore TERM: must be killed with SIGKILL
    if (mode === 'hang-tree') {
      const g = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
      if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, JSON.stringify({ child: process.pid, grandchild: g.pid }));
    }
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'null-line') {
    process.stdout.write('null\n42\n');
    emit({ type: 'result', subtype: 'success', is_error: false, result: 'after-null' });
    return;
  }
  if (mode === 'no-newline') {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'FINAL' })); // no trailing \n
    return;
  }
  if (mode === 'multi') {
    emit({ type: 'stream_event', event: { type: 'message_start' } });
    emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Let me search.' } } });
    emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'server_tool_use', name: 'WebSearch' } } });
    emit({ type: 'stream_event', event: { type: 'message_start' } });
    emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A long and substantive report about the papers that were found.' } } });
    emit({ type: 'stream_event', event: { type: 'message_start' } });
    emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done.' } } });
    emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.' });
    return;
  }
  const text = `ECHO:${input.length}`;
  emit({ type: 'system', subtype: 'init' });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 3) } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(3) } } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.0012 });
});
