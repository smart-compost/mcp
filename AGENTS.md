# mcp

`@smart-compost/mcp`: a stdio MCP server, published to public npm, that lets an external
integrator's agent (Claude, Cursor…) read their processes, devices and measurements through
the Integration API with their own `x-api-key`. Six read-only tools, two source files.

> Platform-wide context (service map, gateway headers, deploy gates, git): `../AGENTS.md`,
> linked from `hive-mind/AGENTS.md`. The Integration API itself lives in composting-backend
> (`/integration/v1`), behind user-gateway.

## Commands

```bash
npm ci
npm run build                  # tsc into dist/; the only typecheck
npm run smoke                  # spawns dist/index.js, runs initialize + tools/list; no key needed
npm run dev                    # tsx src/index.ts, for a manual session
```

- Done means `npm run build` and `npm run smoke` both pass. There are no unit tests, no
  eslint and no Prettier config here; `smoke` lists the tools but never calls the API.
- `smoke` runs the built file: build first, or it tests the previous `dist/`.
- To exercise a tool against the API: `SMARTCOMPOST_API_KEY=<key> npm run dev`, then call it
  from an MCP client. Without the key every tool returns an error, and the server still starts.

## Where things live

- `src/index.ts` — server name, version, instructions and the six `registerTool` calls (zod input schemas).
- `src/client.ts` — `apiGet`: base URL, `x-api-key` header, error mapping.
- `scripts/smoke.mjs` — the stdio handshake check.
- `.github/workflows/publish.yml` — npm publish.

## Rules you cannot infer from one file

- stdout is the JSON-RPC channel. Log with `console.error` only; one `console.log` corrupts the
  stream for every client.
- Requests go to `${SMARTCOMPOST_API_BASE}/integration/v1/<path>`, and the base defaults to the
  test environment (`DEFAULT_BASE` in `src/client.ts`). A new tool calls `apiGet` with a path
  relative to `/integration/v1`, and stays read-only unless the Integration API contract changes.
- The API key never leaves the process except to that base URL; do not add telemetry or proxies.
- `README.md` is what npm shows integrators. Keep its env-var names and defaults identical to
  `src/client.ts`, and its tool table identical to `src/index.ts`.
- Tool names and input fields are a public contract: integrators' agents call them by name, so
  renaming or removing one breaks them; a new optional field does not.

## Publishing

- Public npm, not GitHub Packages: the committed `.npmrc` points `@smart-compost` at
  registry.npmjs.org for this package, overriding the org default. No token is stored anywhere.
- `publish.yml` publishes through npm Trusted Publishing (OIDC) when a `v*` tag is pushed (or by
  manual dispatch), with provenance. `prepublishOnly` builds.
- Release: bump `version` in `package.json` and the server version in `src/index.ts` (they have
  drifted), commit `chore(release): X.Y.Z`, tag `vX.Y.Z` on that commit, push the tag.
- `files` ships only `dist`, `README.md`, `LICENSE` and `NOTICE`; Apache-2.0, with SPDX headers in sources.

## Git

- Only `main` exists here (no `develop`): branch from `main`, PR to `main`.
- Conventional Commits in English (`feat:`, `docs:`, `ci:`, `chore(release):`).
