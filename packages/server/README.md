
> Status: **v0.1 prototype**, work-in-progress, see [Why this exists](#Why-this-exists)

# Ableton SDK - Model Context Protocol (MCP) Server

An **Ableton SDK MCP server** made via Ableton Extensions SDK + **Agent Skills** to allow AI coding agents operate Ableton Live, for long-running music production sessions.


Prompt: Transpose all tonal MIDI clips two semitones down


https://github.com/user-attachments/assets/4c91f96d-b491-41b7-8851-bf189f0739eb




## Why this exists

>Acknowledging several existing Ableton MCPs: [ableton-mcp](https://github.com/ahujasid/ableton-mcp), [extended](https://github.com/jon-wrennall/ableton-mcp-extended), [producer-pal](https://github.com/adamjmurray/producer-pal).

This one is built purely with [Ableton Extensions SDK](https://www.ableton.com/en/live/extensions) with a different approach: **allowing coding agents to execute TypeScript inside Live**, unlike previous Live MCPs that hard-code tools (e.g., adding-clips, adding-notes). So ideally, a coding agent operates a Live session with all operations supported by the SDK.

All together, this repository gives your AI coding agent the following resources:
 - **An Ableton Extension** with a Live UI for confirm/progress
 - **An MCP server** built with Ableton Extensions SDK 
 - **Knowledge skills** about Ableton + music-making expertise (work-in-progress)




## How it works

### MCP tools
The MCP exposes ten tools to the agent (all prefixed `ableton_`):

| Tool | What it does |
|------|-------------|
| `ableton_scan_context` | Set overview — session clips, **clipPlacement**, optional **perceiveHints**, device metadata, mixer, arrangementClipCount per track; optional `representations:['structure']` |
| `ableton_scan_track` | One track — arrangement/session clips, devices (`includeDevices:false` to skip rack trees), mixer; optional `representations:['structure']` |
| `ableton_read_device` | All parameters of a device by name + current values (incl. DrumChain `receivingNote` in detailed mode) |
| `ableton_read_clip_notes` | MIDI notes in a clip; optional `includePitchSummary`; `representations` for notation/drumGrid/harmony/pianoRoll text |
| `ableton_read_selection` | Whatever the user right-clicked → "Send to Agent" in Live |
| `ableton_find_clip` | Find a MIDI clip by exact name on a track (session/arrangement) |
| `ableton_read_drum_rack_map` | Drum Rack pad map — requires device `addr` (e.g. `{"kind":"device","track":1,"index":0}`) |
| `ableton_remap_clip_notes` | Batch remap note pitches (single clip or all arrangement clips on a track) |
| `ableton_render_audio` | Export a track's audio (pre-FX) as a WAV for analysis |
| `ableton_run_code` | **Primary mutation path — execute JS/TS against the Extensions SDK inside Live** (tracks, MIDI, devices, mixer); `ir` namespace for repr parse/encode |

Use scan/read/find tools to perceive Live state; use `ableton_run_code` for all writes. On tool error, fix and retry that tool — do not pivot reads into `run_code`.

### Scan / read ladder

| Need | Tool |
|------|------|
| Overview, session clips, device addrs, arrangement clip counts | `scan_context` |
| Arrangement timeline clip summaries / notes | `scan_track` (`responseFormat:'detailed'` for notes; `includeDevices:false` on heavy racks) |
| MIDI notes (SDK JSON or repr text) | `read_clip_notes` (`representations:['notation']`, etc.) |
| Song-form timeline | `scan_context` / `scan_track` with `representations:['structure']` |
| Clip by name | `find_clip` |
| Drum Rack pads | `scan_context` → DrumRack `devices[].addr` → `read_drum_rack_map` |

See [`skills/SKILL.md`](skills/SKILL.md) and [`docs/skills-upgrade-plan.md`](docs/skills-upgrade-plan.md) for addr shapes and failure recovery.

### SDK documentation

The Ableton Extensions SDK guides, API reference, examples, and full `.d.ts` type surface live in
the QuantumAgent knowledge base under [`docs/knowledge/ableton-sdk/`](../../docs/knowledge/ableton-sdk) and are
retrieved through the **qa-knowledge** MCP (`search_knowledge` / `get_knowledge_chunk`). This server no
longer serves `ableton://` resources. Before the first `run_code`, search for the SDK quickstart and recipes.

| Knowledge path | Purpose |
|----------------|---------|
| `ableton-sdk/guides/quickstart.md` | Entry point — workflow, tool routing, run_code sandbox, session vs arrangement |
| `ableton-sdk/guides/recipes.md` | Copy-paste device/mixer/media/track/MIDI snippets |
| `ableton-sdk/guides/cheatsheet.md` | Curated production API |
| `ableton-sdk/sdk-types.md` | Full TypeScript `.d.ts` type surface |
| `ableton-sdk/api/`, `ableton-sdk/reference/`, `ableton-sdk/examples/` | Converted vendor SDK docs |

Regenerate the converted vendor docs with `npm run knowledge:convert-sdk`; re-index with `npm run knowledge:index`.

**Output schemas:** the MCP server pre-validates kernel JSON against declared `outputSchema`. On mismatch, the tool still succeeds but returns a `[outputSchema mismatch]` warning plus the **raw payload** (no client `-32602` hard fail). Every schema must pass the Live gate: `npm run ableton-mcp:test:live` (kernel on `:17890`).

### `run_code` — how JS/TS executes inside Live

When your coding agent calls `ableton_run_code`, the MCP sends the code over WebSocket to the
Ableton Extension. The extension:

1. **Transpiles** TypeScript to ES module output (via [Sucrase](https://github.com/alangpierce/sucrase)).
2. **Executes** via `new Function(…)` in a thin sandbox — globals like `fetch`, `require`,
   `process`, `eval` are shadowed/removed. 
3. **Returns** `{ result, logs, error, phase }` — `phase` is `"transpile"` / `"runtime"` /
   `"timeout"` / `"serialize"` for debug. Rejections from promises the agent never awaited
   (e.g. `run()` instead of `await run()`) are attributed to the in-flight `run_code` call
   and reported as a `"runtime"` error instead of dying as a host-side unhandled rejection.

## Prerequisites
- **Ableton Live 12.4.5 public beta** (tested against 12 Beta) with **Developer Mode** on
  (Live → Settings → Extensions) — required to dev-run the extension.
- **Node ≥ 24**.
- A **coding agent with MCP support** (Cursor, Claude Code, etc.).

## Setup

From the QuantumAudio repo root:

```bash
npm install
npm run ableton-mcp:kernel:build
npm run ableton-mcp:build
npm run ableton-mcp:register
```

## Run

### Have extension running inside Live

**A) Dev-run the kernel** (simplest during development):

```bash
npm run ableton-mcp:kernel:dev
```

**B) Or install as an extension** (no dev mode needed by the end user):

```bash
npm run ableton-mcp:kernel:package
# then drag the .ablx onto Live → Settings → Extensions
```

Either way the kernel listens on `ws://127.0.0.1:17890`.

Kernel extension: [`ableton-extensions/qa-ableton-mcp-kernel/`](../../ableton-extensions/qa-ableton-mcp-kernel/).

### Connect Cursor

Run `npm run ableton-mcp:register` to write [`.cursor/mcp.json`](../../.cursor/mcp.json):

```json
{
  "mcpServers": {
    "qa-ableton-mcp": {
      "command": "node",
      "args": ["apps/qa-ableton-mcp/dist/index.js"]
    }
  }
}
```

Reload MCP servers in Cursor after building.

Optional env: `ABLETON_KERNEL_URL` to override the default `ws://127.0.0.1:17890`.

### Skills

Agent skills live in [`skills/`](skills/). Run `npm run ableton-mcp:register` to link music-producer skills into [`.cursor/skills/`](../../.cursor/skills/). Extension-dev skills: `live-sdk-context`, `ableton-extension-dev` in `.cursor/skills/`.

## Usage
With Live open and the extension running, ask the agent things like:
- *"Make an 8-bar house loop"* → the **ableton-playbooks** skill builds drums + bass +
  chords + lead in key, with instruments and a rough mix (one Cmd-Z undoes it).
- *"Write a IV–V–vi progression in D minor on a new track"* → **ableton-midi** + **music-strategies**.
- *"Add a warm pad with Operator and a reverb send"* → **ableton-sound-design** + **ableton-mixing**.
- Select clips/tracks in Live → right-click **"Send to Agent"**, then ask about *"the selection"*.

Every edit triggers an **in-Live confirmation dialog** before it runs; long work shows a
**progress bar**. The agent reports what changed and that **Cmd-Z** reverts it.

<img src="./docs/confirm.png" width="400px"></img>

## Limitations
 - built-in Live devices only (VST/AU or preset loading are not allowed by the SDK)
 - no automation / clip envelopes (not allowed by the SDK) 
 - no transport/playback control (not allowed by the SDK) 
 - clip length/loop fixed at creation (modifying them is not allowed by the SDK) 
 - audio render is pre-FX/per-track (post-FX not allowed by the SDK) 
 - all Drum Rack has no samples (the SDK can't load factory kits) 
 - the agent's safety (e.g., undo, rewind, etc.) is limited (undo / version control not allowed by the SDK)
 - See `docs/knowledge/skills/music-producer/ableton-safety/` for the full list.

## Credits & license
See [PROVENANCE.md](PROVENANCE.md). 
