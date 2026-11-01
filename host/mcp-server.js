#!/usr/bin/env node
/*
 * Overleaf AI — MCP (Model Context Protocol) stdio server for agent mode.
 *
 * Claude Code starts this process (--mcp-config). It exposes Overleaf tools to the agent and relays
 * every tool call over a private local socket (OLAI_TOOL_SOCK, created by host.js) to the bridge,
 * which forwards it to the browser extension where the tool actually runs (reading project files,
 * registering edit proposals for the user to approve, …). This server has no file or network access
 * of its own. No dependencies: Node.js built-ins only.
 */
'use strict';

const net = require('net');
const readline = require('readline');

const { TOOLS } = require('./agent-tools.js');

// ------------------------------------------------------------ socket link ---

let sock = null;
let sockBuf = '';
let seq = 0;
const pending = new Map();

function connect() {
  if (sock) return sock;
  const path = process.env.OLAI_TOOL_SOCK;
  if (!path) throw new Error('OLAI_TOOL_SOCK not set');
  sock = net.createConnection(path);
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    sockBuf += d;
    let nl;
    while ((nl = sockBuf.indexOf('\n')) >= 0) {
      const line = sockBuf.slice(0, nl);
      sockBuf = sockBuf.slice(nl + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      const p = pending.get(m.id);
      if (p) { pending.delete(m.id); p(m); }
    }
  });
  sock.on('error', () => { for (const [, p] of pending) p({ ok: false, error: 'bridge connection lost' }); pending.clear(); sock = null; });
  sock.on('close', () => { sock = null; });
  return sock;
}

function callTool(name, args) {
  return new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'tool call timed out' }); }, 120000);
    pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
    try { connect().write(`${JSON.stringify({ id, name, args: args || {} })}\n`); } catch (e) { clearTimeout(timer); pending.delete(id); resolve({ ok: false, error: String(e.message || e) }); }
  });
}

// --------------------------------------------------------------- MCP stdio ---

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (!m || typeof m !== 'object') return;
  const { id, method, params } = m;
  if (method === 'initialize') {
    out({ jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'overleaf', version: '0.6.0' } } });
  } else if (method === 'tools/list') {
    out({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const name = params && params.name;
    if (!TOOLS.some((t) => t.name === name)) { out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true } }); return; }
    const r = await callTool(name, params.arguments);
    const text = r.ok ? (typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2)) : `Error: ${r.error || 'tool failed'}`;
    out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(text).slice(0, 200000) }], isError: !r.ok } });
  } else if (method === 'ping') {
    out({ jsonrpc: '2.0', id, result: {} });
  } else if (id !== undefined && method) {
    out({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
rl.on('close', () => process.exit(0));

