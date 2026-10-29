#!/usr/bin/env node
// Copyright 2026 Smart Compost
// SPDX-License-Identifier: Apache-2.0
/**
 * Local stdio MCP server over the Smart Compost Integration API.
 *
 * Six curated, workflow-oriented, read-only tools, NOT a 1:1 mirror of every
 * endpoint. Discovery tools come first so an agent can find the IDs it needs
 * before calling the measurement tools (the same flow a human integrator does).
 *
 * serveStdio answers both protocol eras from one factory: 2025-era clients that
 * open with `initialize` (Claude Desktop, Cursor today) and 2026-07-28 clients
 * that open with `server/discover` and send a `_meta` envelope on each request.
 */
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { apiGet, type ApiResult } from './client.js';

const INSTRUCTIONS = `
Smart Compost Integration API (third-party, read-only).

The measurement tools need a deviceId (e.g. "666") or a processId (UUID). You
usually do not know these up front, so START with list_processes or list_devices
to discover them, then call the measurement / quick-poll tools.

Notes:
- Data respects a mandatory 1-hour delay (the most recent hour is never returned).
- Everything is scoped to your API key's tenant; you only see your own data.
- Measurement tools are paginated (limit/offset); keep limit small unless you
  genuinely need bulk history.
`.trim();

// The announced version is the published one: read from package.json, which npm
// always ships, so a release only bumps package.json.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

// All tools are read-only GETs against an external API: repeating one changes nothing.
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

// --- Output schemas ---
// Mirror the Integration API DTOs in composting-backend (core/dto/integration.dto.ts).
// Loose objects: a field the API adds later passes through instead of failing the call.

const sensor = z.looseObject({
  metricId: z.string(),
  label: z.string(),
  unit: z.string(),
  category: z.string(),
});

const measurement = z.looseObject({
  measuredAt: z.string(),
  ingestedAt: z.string(),
  lagSeconds: z.number().nullable(),
  measuredAtQuality: z.string(),
  isMeasuredAtTrusted: z.boolean(),
  location: z.looseObject({ latitude: z.number(), longitude: z.number() }),
  metrics: z.record(z.string(), z.number()),
});

const deviceRef = z.looseObject({ deviceId: z.string(), deviceName: z.string() });

const deviceReadings = z.looseObject({
  deviceName: z.string(),
  sensors: z.array(sensor),
  measurements: z.array(measurement),
});

const processReadings = z.looseObject({
  processId: z.string(),
  processName: z.string(),
  category: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullish(),
  devices: z.array(
    z.looseObject({
      deviceId: z.string(),
      deviceName: z.string(),
      sensors: z.array(sensor),
      measurements: z.array(measurement),
    }),
  ),
  totalMeasurements: z.number(),
});

const processList = z.object({
  processes: z.array(
    z.looseObject({
      processId: z.string(),
      processName: z.string(),
      category: z.string(),
      currentPhase: z.string().nullish(),
      startedAt: z.string(),
      finishedAt: z.string().nullish(),
      devices: z.array(deviceRef),
    }),
  ),
});

const deviceList = z.object({ devices: z.array(deviceRef) });

const pagedDeviceReadings = deviceReadings.extend({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

// --- Results ---

// The next step for the agent, by HTTP status. The API's own message stays in
// front: a 404 can mean "no data in the last hour", not only "wrong id".
function nextStep(r: ApiResult): string {
  switch (r.status) {
    case 0:
      return 'Could not reach the API. Check the network and SMARTCOMPOST_API_BASE, then retry.';
    case 401:
    case 403:
      return (
        'The API key is invalid, revoked or expired. Generate a new one on the Integrations ' +
        'page and set it as SMARTCOMPOST_API_KEY; retrying with the same key will fail again.'
      );
    case 404:
      return (
        'If the id is wrong, call list_devices or list_processes to get a valid deviceId or ' +
        'processId, then retry.'
      );
    case 429:
      return r.retryAfter
        ? `Rate limited. Wait ${r.retryAfter} seconds before the next call.`
        : 'Rate limited. Wait a minute before the next call, and avoid calling in a loop.';
    default:
      return r.status >= 500
        ? 'The Smart Compost API failed on its side. Retry in a few minutes.'
        : 'Check the arguments against the tool description, then retry.';
  }
}

// structuredContent must be an object, so list endpoints are wrapped under a key.
function toResult(r: ApiResult, wrap?: string) {
  if (!r.ok) {
    const reason = r.status === 0 ? r.errorText : `HTTP ${r.status}: ${r.errorText}`;
    return {
      content: [{ type: 'text' as const, text: `Error. ${reason ?? 'Request failed.'}\n${nextStep(r)}` }],
      isError: true,
    };
  }
  const data = (wrap ? { [wrap]: r.data } : r.data) as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

const iso = (what: string) => z.string().optional().describe(`ISO 8601 ${what} of range`);

// --- Server ---
// Registration order is the order tools/list returns: discovery first.

function buildServer(): McpServer {
  const server = new McpServer({ name: 'smartcompost', version }, { instructions: INSTRUCTIONS });

  // --- Discovery ---

  server.registerTool(
    'list_processes',
    {
      title: 'List processes',
      description:
        'List all processes for your tenant (active and finished), each with the devices in it. ' +
        'Start here to discover processId and deviceId values for the other tools.',
      inputSchema: z.object({}),
      outputSchema: processList,
      annotations: readOnly,
    },
    async () => toResult(await apiGet('processes'), 'processes'),
  );

  server.registerTool(
    'list_devices',
    {
      title: 'List devices',
      description:
        'List all devices available to your API key, deduplicated by deviceId. ' +
        'Use a deviceId with get_latest_device_readings or get_device_measurements.',
      inputSchema: z.object({}),
      outputSchema: deviceList,
      annotations: readOnly,
    },
    async () => toResult(await apiGet('devices'), 'devices'),
  );

  // --- Quick poll (5 most recent) ---

  server.registerTool(
    'get_latest_device_readings',
    {
      title: 'Latest device readings (quick poll)',
      description:
        'Get the 5 most recent measurements for a device (subject to the 1-hour delay). ' +
        'Get a valid deviceId from list_devices or list_processes first.',
      inputSchema: z.object({ deviceId: z.string().describe('Public device id, e.g. "666"') }),
      outputSchema: deviceReadings,
      annotations: readOnly,
    },
    async ({ deviceId }) => toResult(await apiGet(`data/${encodeURIComponent(deviceId)}`)),
  );

  server.registerTool(
    'get_latest_process_readings',
    {
      title: 'Latest process readings (quick poll)',
      description:
        'Get the 5 most recent measurements per device in a process (subject to the 1-hour delay).',
      inputSchema: z.object({ processId: z.string().describe('Process id (UUID)') }),
      outputSchema: processReadings,
      annotations: readOnly,
    },
    async ({ processId }) =>
      toResult(await apiGet(`data/process/${encodeURIComponent(processId)}`)),
  );

  // --- History (paginated) ---

  server.registerTool(
    'get_device_measurements',
    {
      title: 'Device measurements (history, paginated)',
      description:
        'Get historical measurements for a device with optional date range and pagination. ' +
        "If processId is omitted, the device's active process is used.",
      inputSchema: z.object({
        deviceId: z.string().describe('Public device id, e.g. "666"'),
        processId: z
          .string()
          .optional()
          .describe('Scope to a specific process (UUID). Omit to use the active process.'),
        startDate: iso('start'),
        endDate: iso('end'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max records (default 100)'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
      }),
      outputSchema: pagedDeviceReadings,
      annotations: readOnly,
    },
    async ({ deviceId, processId, startDate, endDate, limit, offset }) =>
      toResult(
        await apiGet(`devices/${encodeURIComponent(deviceId)}/measurements`, {
          processId,
          startDate,
          endDate,
          limit,
          offset,
        }),
      ),
  );

  server.registerTool(
    'get_process_measurements',
    {
      title: 'Process measurements (all devices, paginated)',
      description:
        'Get measurements from all devices in a process, grouped by device. ' +
        'Optionally filter to specific deviceIds.',
      inputSchema: z.object({
        processId: z.string().describe('Process id (UUID)'),
        deviceIds: z
          .array(z.string())
          .optional()
          .describe('Filter to these deviceIds (omit for all devices in the process)'),
        startDate: iso('start'),
        endDate: iso('end'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Max records per device (default 100)'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
      }),
      outputSchema: processReadings,
      annotations: readOnly,
    },
    async ({ processId, deviceIds, startDate, endDate, limit, offset }) =>
      toResult(
        await apiGet(`processes/${encodeURIComponent(processId)}/measurements`, {
          deviceIds,
          startDate,
          endDate,
          limit,
          offset,
        }),
      ),
  );

  return server;
}

serveStdio(buildServer);
// stderr so it never pollutes the stdio JSON-RPC channel
console.error('smartcompost MCP server running on stdio');
