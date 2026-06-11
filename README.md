# qa-ableton-mcp

Drive **Ableton Live** from AI coding agents via the [Model Context Protocol](https://modelcontextprotocol.io/) and the [Ableton Extensions SDK](https://ableton.github.io/extensions-sdk/). Two packages in one repo:

| Package | Path | Role |
|---------|------|------|
| `@quantumaudio/ableton-mcp` | [`packages/server`](packages/server) | MCP stdio server (tools, skills, schemas) |
| `@quantumaudio/ableton-mcp-kernel` | [`packages/kernel`](packages/kernel) | In-Live extension + WebSocket (`:17890`) |

License: [Apache-2.0](LICENSE).

> **Status:** v0.1 prototype — APIs and skills evolve quickly.

## Why this exists

Unlike fixed-tool Ableton MCPs, this stack exposes **`ableton_run_code`**: agents execute TypeScript against the Extensions SDK inside Live, so new operations do not require server releases. Perception uses typed **scan/read** tools with optional [@quantumaudio/music-ir](https://github.com/QaAudio/qa-music-ir) text representations.

## Quick start

**Prerequisites:** Ableton Live 12.4+ beta with **Developer Mode**, Node ≥ 24, Ableton Extensions SDK tgz (see [packages/kernel/SDK.md](packages/kernel/SDK.md)).

```bash
git clone https://github.com/QaAudio/qa-ableton-mcp.git
cd qa-ableton-mcp
npm install
# Install @ableton-extensions/sdk + cli into packages/kernel (see SDK.md)
npm run build
```

**Terminal 1 — kernel in Live:**

```bash
npm run start -w @quantumaudio/ableton-mcp-kernel
```

**Terminal 2 — MCP (or configure your agent):**

```bash
node packages/server/dist/index.js
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "qa-ableton-mcp": {
      "command": "node",
      "args": ["packages/server/dist/index.js"]
    }
  }
}
```

Optional: `node packages/server/scripts/register-cursor.mjs` from repo root (writes project MCP config + skill links when run inside QuantumAudio monorepo).

## Documentation

- **User guide & tool reference:** [packages/server/README.md](packages/server/README.md)
- **Kernel / extension dev:** [packages/kernel/README.md](packages/kernel/README.md)
- **Agent conventions:** [AGENTS.md](AGENTS.md)

## Ecosystem

| Repo | npm | Purpose |
|------|-----|---------|
| [qa-ableton-mcp-schemas](https://github.com/QaAudio/qa-ableton-mcp-schemas) | `@quantumaudio/ableton-mcp-schemas` | Zod wire schemas |
| [qa-music-ir](https://github.com/QaAudio/qa-music-ir) | `@quantumaudio/music-ir` | Notation / drum grid / structure IR |
| [qa-knowledge](https://github.com/QaAudio/qa-knowledge) | `@quantumaudio/qa-knowledge` | SDK + skills corpus |
| [qa-knowledge-mcp](https://github.com/QaAudio/qa-knowledge-mcp) | `@quantumaudio/knowledge-mcp` | Semantic doc search MCP |

Pair **qa-ableton-mcp** + **qa-knowledge-mcp** in your agent: Live control + SDK lookup (`search_knowledge`).

## Workspace commands

From repo root:

```bash
npm run typecheck    # both packages
npm run build        # both packages
npm run test         # server unit tests (kernel tests via tsx in monorepo)
```

## Contributing

PRs welcome on [QaAudio/qa-ableton-mcp](https://github.com/QaAudio/qa-ableton-mcp). Coordinate schema changes with [qa-ableton-mcp-schemas](https://github.com/QaAudio/qa-ableton-mcp-schemas). See [AGENTS.md](AGENTS.md) and `.cursor/skills/security-guidelines/`.
