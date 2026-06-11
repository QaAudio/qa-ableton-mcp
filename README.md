# qa-ableton-mcp

MCP stdio server + in-Live kernel extension.

Part of [QuantumAudio](https://github.com/QaAudio). License: Apache-2.0.

## Development

```bash
npm ci
npm run typecheck
npm run build
```

## Layout

- `packages/server` — `@quantumaudio/ableton-mcp`
- `packages/kernel` — `@quantumaudio/ableton-mcp-kernel` (see `packages/kernel/SDK.md`)
