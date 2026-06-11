# @quantumaudio/ableton-mcp

> Status: **v0.1 prototype**, work-in-progress

[MCP](https://modelcontextprotocol.io/) stdio server bridging coding agents to Ableton Live via the in-Live kernel ([`@quantumaudio/ableton-mcp-kernel`](../kernel)).

License: [Apache-2.0](../../LICENSE).

## Why this exists

Built on the [Ableton Extensions SDK](https://www.ableton.com/en/live/extensions) with **`ableton_run_code`**: agents execute TypeScript inside Live instead of relying on a fixed tool list. Scan/read tools provide typed perception; optional [@quantumaudio/music-ir](https://github.com/QaAudio/qa-music-ir) text representations help models reason about MIDI and arrangement.

## MCP tools

| Tool | What it does |
|------|-------------|
| `ableton_scan_context` | Set overview — clips, clipPlacement, devices, mixer; optional `representations:['structure']` |
| `ableton_scan_track` | One track — clips, devices, mixer; optional structure repr |
| `ableton_read_device` | Device parameters + values |
| `ableton_read_clip_notes` | MIDI notes; optional notation/drumGrid/harmony/pianoRoll |
| `ableton_read_selection` | User "Send to Agent" selection |
| `ableton_find_clip` | Find MIDI clip by name |
| `ableton_read_drum_rack_map` | Drum Rack pad map (needs device `addr`) |
| `ableton_remap_clip_notes` | Batch pitch remap |
| `ableton_render_audio` | Export track audio (pre-FX) as WAV |
| `ableton_run_code` | **Primary mutation path** — execute JS/TS in Live; `ir` namespace for repr parse/encode |

Use scan/read for perception; **`ableton_run_code` for all writes**. On tool error, fix and retry — do not pivot reads into `run_code`.

### Scan / read ladder

| Need | Tool |
|------|------|
| Overview, device addrs | `scan_context` |
| Arrangement clip notes | `scan_track` (`responseFormat:'detailed'`) |
| MIDI as text | `read_clip_notes` + `representations` |
| Song timeline | `scan_*` + `representations:['structure']` |
| Clip by name | `find_clip` |
| Drum pads | `scan_context` → `read_drum_rack_map` |

See [`skills/SKILL.md`](skills/SKILL.md) for agent workflow.

## SDK documentation (knowledge MCP)

SDK guides, API reference, and types live in the [qa-knowledge](https://github.com/QaAudio/qa-knowledge) corpus. Retrieve them via [qa-knowledge-mcp](https://github.com/QaAudio/qa-knowledge-mcp):

- `search_knowledge` — find sections
- `get_knowledge_chunk` — full text

Key paths: `ableton-sdk/guides/quickstart.md`, `recipes.md`, `cheatsheet.md`, `sdk-types.md`.

This server no longer exposes `ableton://` MCP resources.

## `run_code` execution

1. MCP sends code over WebSocket to the kernel extension
2. Kernel transpiles TS (Sucrase) and runs in a thin sandbox
3. Returns `{ result, logs, error, phase }` (`transpile` \| `runtime` \| `timeout` \| `serialize`)

## Prerequisites

- Ableton Live 12.4.5+ beta, **Developer Mode** for kernel dev-run
- Node ≥ 24
- Kernel running on `ws://127.0.0.1:17890` — see [kernel README](../kernel/README.md)

## Setup (standalone repo)

From [qa-ableton-mcp](https://github.com/QaAudio/qa-ableton-mcp) root:

```bash
npm install
# Install Extensions SDK into packages/kernel — see packages/kernel/SDK.md
npm run build
npm run start -w @quantumaudio/ableton-mcp-kernel   # Live
node packages/server/dist/index.js                   # MCP
```

## Cursor

```json
{
  "mcpServers": {
    "qa-ableton-mcp": {
      "command": "node",
      "args": ["packages/server/dist/index.js"]
    },
    "qa-knowledge-mcp": {
      "command": "node",
      "args": ["/path/to/qa-knowledge-mcp/dist/index.js"],
      "env": {
        "QDRANT_URL": "http://127.0.0.1:6333",
        "KNOWLEDGE_ROOT": "/path/to/qa-knowledge/docs/knowledge"
      }
    }
  }
}
```

Optional env: `ABLETON_KERNEL_URL` (default `ws://127.0.0.1:17890`).

### Skills

Agent skills in [`skills/`](skills/). Music-production skills are indexed from [qa-knowledge](https://github.com/QaAudio/qa-knowledge) (`docs/knowledge/skills/music-producer/`). Dev skills (`live-sdk-context`, `ableton-mcp-dev`) ship under `skills/dev-cursor/`.

## Development

```bash
npm run typecheck -w @quantumaudio/ableton-mcp
npm run build -w @quantumaudio/ableton-mcp
npm test -w @quantumaudio/ableton-mcp
```

Output schemas: kernel JSON is pre-validated against `@quantumaudio/ableton-mcp-schemas`. Live gate: `node packages/kernel/test-output-schemas-live.mjs` with kernel on `:17890`.

## Limitations

- Built-in Live devices only (no VST/AU loading via SDK)
- No automation / clip envelopes / transport control (SDK limits)
- Drum Racks without factory samples (SDK cannot load kits)
- Edits use in-Live confirm + undo where SDK allows

See qa-knowledge skills under `music-producer/ableton-safety/` for guardrails.

## Credits

See [PROVENANCE.md](PROVENANCE.md).

## Related repos

[qa-ableton-mcp-schemas](https://github.com/QaAudio/qa-ableton-mcp-schemas) · [qa-music-ir](https://github.com/QaAudio/qa-music-ir) · [qa-knowledge](https://github.com/QaAudio/qa-knowledge) · [qa-knowledge-mcp](https://github.com/QaAudio/qa-knowledge-mcp)
