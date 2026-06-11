# qa-ableton-mcp — Agent Guide

npm workspace: MCP server (`packages/server`) + Live kernel extension (`packages/kernel`). Protocol shared via `@quantumaudio/ableton-mcp-schemas`.

Extensions SDK: https://ableton.github.io/extensions-sdk/

## Layout

```
qa-ableton-mcp/
├── packages/
│   ├── server/          # @quantumaudio/ableton-mcp — MCP stdio, tools, skills/
│   └── kernel/          # @quantumaudio/ableton-mcp-kernel — extension, WS :17890
├── package.json         # workspaces: packages/*
└── AGENTS.md
```

## Commands (repo root)

| Command | When |
|---------|------|
| `npm run typecheck` | After TS edits in either package |
| `npm run build` | Before MCP run, packaging, or tests |
| `npm run test` | Server unit tests |

Per-package:

```bash
npm run build -w @quantumaudio/ableton-mcp
npm run start -w @quantumaudio/ableton-mcp-kernel   # dev-run in Live
npm run package -w @quantumaudio/ableton-mcp-kernel # .ablx
```

Live verification (requires Live + kernel on `:17890`):

```bash
node packages/kernel/test-perception.mjs
node packages/kernel/test-output-schemas-live.mjs
```

## TypeScript conventions

- TS under `src/` only; NodeNext + `.js` import suffixes.
- Kernel bundles to single CJS `dist/extension.js` via `packages/kernel/build.ts` (esbuild).
- Server is plain `tsc` → `dist/`.
- Schemas live in **qa-ableton-mcp-schemas** — do not duplicate Zod in server/kernel.

## Change workflow

| Area | Touch |
|------|--------|
| Wire format / output JSON | `qa-ableton-mcp-schemas` → kernel `serialize/` → server `output-schemas` |
| New MCP tool | `packages/server/src/tools.ts`, kernel `handlers.ts`, schemas |
| `run_code` sandbox | `packages/kernel/src/run.ts` |
| Skills | `packages/server/skills/` |

## Vendor SDK

Do **not** commit Ableton's SDK `.tgz`. Document install in `packages/kernel/SDK.md`. Local dev: `npm install` path/to/sdk.tgz in `packages/kernel`.

## Related repos

- [qa-ableton-mcp-schemas](https://github.com/QaAudio/qa-ableton-mcp-schemas)
- [qa-music-ir](https://github.com/QaAudio/qa-music-ir)
- [qa-knowledge](https://github.com/QaAudio/qa-knowledge) + [qa-knowledge-mcp](https://github.com/QaAudio/qa-knowledge-mcp)

Security / publish: `.cursor/skills/security-guidelines/SKILL.md`.
