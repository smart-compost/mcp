# @smart-compost/mcp

MCP server for the Smart Compost platform. An LLM agent (Claude, Cursor, etc.)
lists your processes/devices and pulls measurements as **tools**, using your
`x-api-key`. Currently wraps the **Integration API**; named generically so more
of the platform can be exposed over time.

> **Local stdio. Key stays on the client.** The `x-api-key` is read from an env
> var and only ever leaves this process to call your own gateway. Nothing is
> proxied through a third party.

## Tools

Six **curated, read-only, workflow-oriented** tools (not a 1:1 mirror of every
endpoint). Discovery comes first so the agent can find IDs before asking for
data. The server also ships top-level **instructions** telling the model to
start with discovery.

| Tool | Endpoint | Purpose |
| --- | --- | --- |
| `list_processes` | `GET /processes` | Discover processes (+ nested devices) |
| `list_devices` | `GET /devices` | Discover device ids |
| `get_latest_device_readings` | `GET /data/{deviceId}` | Quick poll, 5 most recent |
| `get_latest_process_readings` | `GET /data/process/{processId}` | Quick poll per process |
| `get_device_measurements` | `GET /devices/{deviceId}/measurements` | History, paginated |
| `get_process_measurements` | `GET /processes/{processId}/measurements` | History, all devices |

## Install (for integrators)

Once published, a third-party dev adds it in one line — no clone, no build:

```bash
claude mcp add smartcompost \
  -e SMARTCOMPOST_API_KEY=sk_live_xxx \
  -- npx -y @smart-compost/mcp
```

Cursor / Windsurf / Claude Desktop (`mcp.json`):

```json
{
  "mcpServers": {
    "smartcompost": {
      "command": "npx",
      "args": ["-y", "@smart-compost/mcp"],
      "env": { "SMARTCOMPOST_API_KEY": "sk_live_xxx" }
    }
  }
}
```

Config:

- `SMARTCOMPOST_API_KEY` (required) — Integration API key (`sk_live_...`).
- `SMARTCOMPOST_API_BASE` (optional) — defaults to `https://test.smartcompost.com.br/api`.
  Use `https://smartcompost.com.br/api` for prod or `https://composting.local.me/api` locally.

## Local development

```bash
npm install
npm run build      # tsc -> dist/
npm run smoke      # handshake + tools/list (no key needed) -> expect 6 tools
```

## Self-hosted MCP vs Scalar Agent

| | This server (self-hosted) | Scalar Agent (hosted SaaS) |
| --- | --- | --- |
| Where the key lives | Client machine (env var) | Scalar dashboard |
| API traffic | Direct to your gateway | Proxied via `api.scalar.com` |
| Tool design | You curate (6 tools) | Auto from OpenAPI |
| Cost / ops | Free, you run it | Paid plan, they run it |
| Transport | stdio (local) | Remote HTTP |

## Publishing

`prepublishOnly` runs the build. `publishConfig.registry` targets GitHub Packages
(`@smart-compost` scope), matching the rest of the org. Note: GitHub Packages is
private/org-scoped — if external integrators must `npx` without org access,
publish to public npm instead (flip `publishConfig.registry`). Future direction:
a remote **Streamable HTTP + bearer-header** variant for zero-install, and
server-side field filtering for the large measurement responses.
