#!/usr/bin/env node
/**
 * Smoke test: spawn the built server, run the MCP initialize handshake over
 * stdio, then call tools/list and print the registered tools. Does NOT need an
 * API key (tools/list never touches the upstream API).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'dist', 'index.js');

const child = spawn(process.execPath, [entry], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, SMARTCOMPOST_API_KEY: process.env.SMARTCOMPOST_API_KEY ?? 'smoke-no-key' },
});

const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');

let buffer = '';
const timer = setTimeout(() => {
  console.error('FAIL: timed out waiting for tools/list');
  child.kill();
  process.exit(1);
}, 10000);

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    if (msg.id === 1) {
      // initialize result -> complete the handshake, then list tools
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    } else if (msg.id === 2) {
      clearTimeout(timer);
      const tools = msg.result?.tools ?? [];
      console.log(`PASS: server returned ${tools.length} tools`);
      for (const t of tools) {
        const ro = t.annotations?.readOnlyHint ? ' [read-only]' : '';
        console.log(`  - ${t.name}${ro}`);
      }
      child.kill();
      process.exit(tools.length === 6 ? 0 : 1);
    }
  }
});

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.0' },
  },
});
