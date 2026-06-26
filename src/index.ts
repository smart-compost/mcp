#!/usr/bin/env node
/**
 * Local stdio MCP server over the Smart Compost Integration API (spike).
 *
 * Six curated, workflow-oriented, read-only tools — NOT a 1:1 mirror of every
 * endpoint. Discovery tools come first so an agent can find the IDs it needs
 * before calling the measurement tools (the same flow a human integrator does).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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

const server = new McpServer(
  { name: 'smartcompost', version: '0.1.0' },
  { instructions: INSTRUCTIONS },
);

// All tools are read-only and hit an external API.
const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

function toResult(r: ApiResult) {
  if (!r.ok) {
    return {
      content: [
        { type: 'text' as const, text: `Error ${r.status}: ${r.errorText ?? 'request failed'}` },
      ],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(r.data, null, 2) }],
  };
}

// --- Discovery ---

server.registerTool(
  'list_processes',
  {
    title: 'List processes',
    description:
      'List all processes for your tenant (active and finished), each with the devices in it. ' +
      'Start here to discover processId and deviceId values for the other tools.',
    inputSchema: {},
    annotations: readOnly,
  },
  async () => toResult(await apiGet('processes')),
);

server.registerTool(
  'list_devices',
  {
    title: 'List devices',
    description:
      'List all devices available to your API key, deduplicated by deviceId. ' +
      'Use a deviceId with get_latest_device_readings or get_device_measurements.',
    inputSchema: {},
    annotations: readOnly,
  },
  async () => toResult(await apiGet('devices')),
);

// --- Quick poll (5 most recent) ---

server.registerTool(
  'get_latest_device_readings',
  {
    title: 'Latest device readings (quick poll)',
    description:
      'Get the 5 most recent measurements for a device (subject to the 1-hour delay). ' +
      'Get a valid deviceId from list_devices or list_processes first.',
    inputSchema: { deviceId: z.string().describe('Public device id, e.g. "666"') },
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
    inputSchema: { processId: z.string().describe('Process id (UUID)') },
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
      'If processId is omitted, the device\'s active process is used.',
    inputSchema: {
      deviceId: z.string().describe('Public device id, e.g. "666"'),
      processId: z
        .string()
        .optional()
        .describe('Scope to a specific process (UUID). Omit to use the active process.'),
      startDate: z.string().optional().describe('ISO 8601 start of range'),
      endDate: z.string().optional().describe('ISO 8601 end of range'),
      limit: z.number().int().min(1).max(1000).optional().describe('Max records (default 100)'),
      offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
    },
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
    inputSchema: {
      processId: z.string().describe('Process id (UUID)'),
      deviceIds: z
        .array(z.string())
        .optional()
        .describe('Filter to these deviceIds (omit for all devices in the process)'),
      startDate: z.string().optional().describe('ISO 8601 start of range'),
      endDate: z.string().optional().describe('ISO 8601 end of range'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe('Max records per device (default 100)'),
      offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
    },
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so it never pollutes the stdio JSON-RPC channel
  console.error('smartcompost MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
