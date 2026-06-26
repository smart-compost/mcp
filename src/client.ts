// Copyright 2026 Smart Compost
// SPDX-License-Identifier: Apache-2.0
/**
 * Tiny fetch wrapper for the Smart Compost Integration API.
 *
 * The x-api-key is read from the SMARTCOMPOST_API_KEY env var and sent on every
 * request. It never leaves this process: this is a local stdio MCP server, so
 * the key stays on the client machine (unlike a hosted SaaS that would store it).
 */

const DEFAULT_BASE = 'https://test.smartcompost.com.br/api';

export interface ApiResult {
  ok: boolean;
  status: number;
  data?: unknown;
  errorText?: string;
}

function baseUrl(): string {
  return (process.env.SMARTCOMPOST_API_BASE ?? DEFAULT_BASE).replace(/\/+$/, '');
}

function apiKey(): string {
  const key = process.env.SMARTCOMPOST_API_KEY;
  if (!key) {
    throw new Error(
      'SMARTCOMPOST_API_KEY is not set. Generate a key on the Integrations page ' +
        'and expose it to this server as an env var.',
    );
  }
  return key;
}

type QueryValue = string | number | string[] | undefined;

export async function apiGet(
  path: string,
  query?: Record<string, QueryValue>,
): Promise<ApiResult> {
  const url = new URL(`${baseUrl()}/integration/v1/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'x-api-key': apiKey() } });
  } catch (err) {
    return { ok: false, status: 0, errorText: `Network error: ${(err as Error).message}` };
  }

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON body; keep the raw text
  }

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).message)
        : text || res.statusText;
    return { ok: false, status: res.status, errorText: message };
  }

  return { ok: true, status: res.status, data };
}
