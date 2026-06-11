# @quantumaudio/ableton-mcp-kernel

Ableton Live **extension** that hosts a WebSocket server (`ws://127.0.0.1:17890`) and executes agent code via the Extensions SDK. Paired with [`@quantumaudio/ableton-mcp`](../server) (MCP stdio proxy).

License: [Apache-2.0](../../LICENSE).

## Prerequisites

- **Ableton Live 12.4.5+** (public beta tested) with **Developer Mode** (Settings → Extensions)
- **Node ≥ 24**
- **Ableton Extensions SDK** — not redistributed here; see [SDK.md](SDK.md)

## Install SDK (required once)

```bash
cd packages/kernel
npm install /path/to/ableton-extensions-sdk-1.0.0-beta.0.tgz
npm install -D /path/to/ableton-extensions-cli-1.0.0-beta.0.tgz
```

From repo root after `npm install` at workspace level.

## Build & run

```bash
# from qa-ableton-mcp root
npm run build -w @quantumaudio/ableton-mcp-kernel

# Dev-run inside Live Extension Host
npm run start -w @quantumaudio/ableton-mcp-kernel

# Production .ablx
npm run package -w @quantumaudio/ableton-mcp-kernel
```

Dev-run uses `extensions-cli run`; package produces an `.ablx` you can install without Developer Mode.

## Architecture

```
MCP server (stdio)  --WS-->  kernel (in Live)
                              ├── handlers.ts   scan/read tools
                              ├── run.ts        run_code sandbox
                              ├── serialize/    JSON for MCP schemas
                              └── ui-dialogs.ts confirm / progress
```

- **Transpile:** Sucrase (TS → ESM-ish) inside `run_code`
- **Sandbox:** stripped globals; SDK via `context` / `song` bindings; `ir` namespace from `@quantumaudio/music-ir`
- **UI:** in-Live confirm dialog before mutating calls; progress for long work

## Harness scripts

With kernel listening on `:17890`:

```bash
node packages/kernel/test-client.mjs
node packages/kernel/test-perception.mjs
node packages/kernel/test-action.mjs
node packages/kernel/test-output-schemas-live.mjs
```

## Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| (kernel) | `:17890` | WebSocket port (fixed in extension) |
| `ABLETON_KERNEL_URL` | `ws://127.0.0.1:17890` | MCP server override |

## Related packages

| Package | Repo |
|---------|------|
| `@quantumaudio/ableton-mcp` | [qa-ableton-mcp](https://github.com/QaAudio/qa-ableton-mcp) |
| `@quantumaudio/ableton-mcp-schemas` | [qa-ableton-mcp-schemas](https://github.com/QaAudio/qa-ableton-mcp-schemas) |
| `@quantumaudio/music-ir` | [qa-music-ir](https://github.com/QaAudio/qa-music-ir) |

## Contributing

Edit `src/extension.ts` (activate), `handlers.ts`, `run.ts`. Run unit tests (`src/*.test.ts`) and live harness when Live is available. See [../../AGENTS.md](../../AGENTS.md).
