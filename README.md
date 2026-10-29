# @smart-compost/mcp

MCP server for the Smart Compost platform. An LLM agent (Claude, Cursor, etc.)
lists your processes/devices and pulls measurements as **tools**, using your
`x-api-key`. Currently wraps the **Integration API**; named generically so more
of the platform can be exposed over time.

> **Local stdio. Key stays on the client.** The `x-api-key` is read from an env
> var and only ever leaves this process to call your own gateway. Nothing is
> proxied through a third party.

## Tools

Six curated, read-only, workflow-oriented tools (not a 1:1 mirror of every
endpoint). Discovery comes first so the agent can find IDs before asking for
data. The server also ships top-level instructions telling the model to start
with discovery.

| Tool | Endpoint | Purpose |
| --- | --- | --- |
| `list_processes` | `GET /processes` | Discover processes (with nested devices) |
| `list_devices` | `GET /devices` | Discover device ids |
| `get_latest_device_readings` | `GET /data/{deviceId}` | Quick poll, 5 most recent |
| `get_latest_process_readings` | `GET /data/process/{processId}` | Quick poll per process |
| `get_device_measurements` | `GET /devices/{deviceId}/measurements` | History, paginated |
| `get_process_measurements` | `GET /processes/{processId}/measurements` | History, all devices |

Every tool is annotated read-only and idempotent, and declares an `outputSchema`.
A result carries the response as `structuredContent` and the same JSON as text in
`content`, so clients that read either one get the same data. The two list tools
wrap their arrays as `{ "processes": [...] }` and `{ "devices": [...] }`, since
structured content must be an object.

Errors come back as tool results with `isError: true`, the API's message, and
the next step: on 401/403 generate a new key on the Integrations page; on 404 call
`list_devices` or `list_processes` for a valid id; on 429 wait (the `Retry-After`
delay when the API sends one).

## Protocol

Speaks MCP 2026-07-28 (`server/discover`, no handshake) and the 2025 revisions
that open with `initialize`, from the same binary. The era is chosen per
connection by what the client sends first, so clients that still open with
`initialize` (Claude Desktop, Cursor) keep working unchanged.

## Install

Add it in one line, no clone or build:

```bash
claude mcp add smart-compost \
  -e SMARTCOMPOST_API_KEY=sk_live_xxx \
  -- npx -y @smart-compost/mcp
```

Cursor / Windsurf / Claude Desktop (`mcp.json`):

```json
{
  "mcpServers": {
    "smart-compost": {
      "command": "npx",
      "args": ["-y", "@smart-compost/mcp"],
      "env": { "SMARTCOMPOST_API_KEY": "sk_live_xxx" }
    }
  }
}
```

Config:

- `SMARTCOMPOST_API_KEY` (required): your Integration API key (`sk_live_...`),
  generated on the Integrations page.
- `SMARTCOMPOST_API_BASE` (optional): defaults to `https://test.smartcompost.com.br/api`.
  Use `https://smartcompost.com.br/api` for production.

Then ask the agent things like "list my composting processes" or "show the
latest readings for device 666".

## License

Apache-2.0
