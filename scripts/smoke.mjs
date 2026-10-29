#!/usr/bin/env node
/**
 * Smoke test: spawn the built server twice over stdio, once per protocol era,
 * and check that both list the same six tools in the same order.
 *
 * - 2026-07-28: no handshake; `server/discover`, then `tools/list`, each request
 *   carrying the `_meta` envelope.
 * - 2025 (legacy): the `initialize` handshake that Claude Desktop and Cursor
 *   still send, then `tools/list`.
 *
 * Does NOT need an API key: neither method touches the upstream API.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'dist', 'index.js');

const MODERN = '2026-07-28';
const LEGACY = '2025-06-18';
const EXPECTED = [
  'list_processes',
  'list_devices',
  'get_latest_device_readings',
  'get_latest_process_readings',
  'get_device_measurements',
  'get_process_measurements',
];

const clientInfo = { name: 'smoke', version: '0.0.0' };
const envelope = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': clientInfo,
  'io.modelcontextprotocol/clientCapabilities': {},
};

/** Spawn the server, send each step once the reply it waits for has arrived, collect replies by id. */
function session(label, steps) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: {
        ...process.env,
        SMARTCOMPOST_API_KEY: process.env.SMARTCOMPOST_API_KEY ?? 'smoke-no-key',
      },
    });
    const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
    const replies = new Map();
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label}: timed out after replies ${[...replies.keys()].join(',')}`));
    }, 10000);

    let step = 0;
    const next = () => {
      while (step < steps.length) {
        const { msg, waitFor } = steps[step];
        if (waitFor !== undefined && !replies.has(waitFor)) return;
        send(msg);
        step++;
      }
      const pending = steps.filter((s) => s.msg.id !== undefined && !replies.has(s.msg.id));
      if (pending.length === 0) {
        clearTimeout(timer);
        child.kill();
        resolve(replies);
      }
    };

    let buffer = '';
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
          clearTimeout(timer);
          child.kill();
          reject(new Error(`${label}: non-JSON line on stdout: ${line}`));
          return;
        }
        if (msg.id !== undefined) replies.set(msg.id, msg);
      }
      next();
    });
    next();
  });
}

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

function checkTools(label, reply) {
  check(!reply.error, `${label}: tools/list returned ${JSON.stringify(reply.error)}`);
  const tools = reply.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  check(
    JSON.stringify(names) === JSON.stringify(EXPECTED),
    `${label}: tools are [${names.join(', ')}], expected [${EXPECTED.join(', ')}]`,
  );
  for (const t of tools) {
    const a = t.annotations ?? {};
    check(a.readOnlyHint === true && a.idempotentHint === true, `${label}: ${t.name} annotations`);
    check(t.outputSchema?.type === 'object', `${label}: ${t.name} has no object outputSchema`);
  }
  return tools;
}

// 2026-07-28: discover, then list. No initialize.
const modern = await session(MODERN, [
  { msg: { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: envelope } } },
  { msg: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: envelope } }, waitFor: 1 },
]);
const discover = modern.get(1);
check(
  discover.result?.supportedVersions?.includes(MODERN),
  `${MODERN}: server/discover did not offer ${MODERN}: ${JSON.stringify(discover.error ?? discover.result)}`,
);
check(discover.result?.resultType === 'complete', `${MODERN}: server/discover has no resultType`);
check(modern.get(2).result?.resultType === 'complete', `${MODERN}: tools/list has no resultType`);
const modernTools = checkTools(MODERN, modern.get(2));

// 2025 era: the initialize handshake, then list.
const legacy = await session(LEGACY, [
  {
    msg: {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: LEGACY, capabilities: {}, clientInfo },
    },
  },
  { msg: { jsonrpc: '2.0', method: 'notifications/initialized' }, waitFor: 1 },
  { msg: { jsonrpc: '2.0', id: 2, method: 'tools/list' } },
]);
const init = legacy.get(1);
check(
  init.result?.protocolVersion === LEGACY,
  `${LEGACY}: initialize answered ${JSON.stringify(init.error ?? init.result?.protocolVersion)}`,
);
const legacyTools = checkTools(LEGACY, legacy.get(2));

const shape = (tools) => JSON.stringify(tools.map(({ name, inputSchema }) => ({ name, inputSchema })));
check(shape(modernTools) === shape(legacyTools), 'the two eras advertise different input schemas');

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log(`PASS: ${MODERN} (server/discover) and ${LEGACY} (initialize) both list ${EXPECTED.length} tools`);
for (const t of modernTools) console.log(`  - ${t.name} [read-only, idempotent]`);
