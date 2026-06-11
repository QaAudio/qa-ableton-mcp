---
name: ableton-mcp
description: >-
  Umbrella index for the qa-ableton-mcp server — drive Ableton Live from an agent
  via scan/read tools plus run_code execution. Always-on summary: workflow loop,
  when to scan vs read vs run_code, addr/track resolution, failure recovery,
  safety, and routing to producer / extension-dev subsets.
---

# qa-ableton-mcp (umbrella)

Drive Ableton Live through the in-Live kernel. This is the always-on **index** — routes to
child skills for depth.

## MCP tools

| Role | Tools |
|------|-------|
| Scan | `scan_context`, `scan_track` |
| Read / find | `read_device`, `read_clip_notes`, `read_selection`, `find_clip`, `read_drum_rack_map` |
| Execute | **`run_code`** — primary path for all writes (tracks, MIDI, devices, mixer, arrangement) |
| Specialized write | `remap_clip_notes` (batch pitch remap after `read_drum_rack_map`) |
| Audio export | `render_audio` |

Rule of thumb: **scan and read with scan/read/find tools**; **mutate with `run_code`** inside
`withinTransaction`. Do not re-implement reads in `run_code` when a scan/read tool exists.

## The loop

1. **Scan** — `ableton_scan_context`, then narrower `ableton_scan_*` / `ableton_read_*` tools
2. **Read / find** — drill into tracks, clips, devices, drum maps, or selection as needed.
3. **Plan** — pick subset skill(s); read their `SKILL.md` on demand; map intent to SDK steps.
4. **Validate** — `ui.confirm(...)` before destructive or large edits.
5. **Execute** — `ableton_run_code` for writes (`ir.parseNotation` / `ir.parseDrumGrid` / `ir.parsePianoRoll` for repr-* text); `ableton_remap_clip_notes` only for batch pitch remaps.
6. **Verify** — re-scan context / `read_clip_notes` after edits (handles are ephemeral).

## Scan / read routing

`scan_context` is bounded: Session View `clipSlots` and device **metadata**, not full notes or
arrangement timeline clips. Each track includes **`clipPlacement`** (`session_only` / `arrangement_only` / `both`).
Top-level **`perceiveHints`** warn when Session-only MIDI exists on an arrangement-heavy set (notes invisible in Arrangement piano roll).

| Need | Tool chain |
|------|------------|
| Set overview, track list, session clips, clipPlacement, perceiveHints, device metadata | `scan_context` |
| Bar-timeline / song form (all tracks) | `scan_context { representations: ["structure"] }` — see **repr-structure** |
| Arrangement timeline clips | `scan_track { addr: { kind: "track", index: N } }` |
| Track bar-timeline | `scan_track { representations: ["structure"] }` |
| MIDI notes in a clip (SDK JSON) | `read_clip_notes { addr: clipSlot \| arrangementClip }` |
| MIDI as text (notation, drums, harmony, piano roll) | `read_clip_notes { representations: ["notation"] }` etc. — see **repr-*** skills |
| Clip by exact name | `find_clip { track: N, name, view?, representations?: [...] }` |
| Drum Rack pad map | `scan_context` → DrumRack `devices[].addr` → `read_drum_rack_map { addr }` |
| Device parameters | `read_device { addr: device }` |
| User selection | `read_selection` (after Send to Agent in Live) |

**Do not use `run_code` to read clips, notes, or drum maps when a scan/read tool exists.**

## Addresses & track resolution

Objects use **positional `addr` values**, not permanent ids. Copy `addr` from scan/read responses
verbatim into tools that accept `addr`.

| `kind` | Shape | Used for |
|--------|-------|----------|
| `track` | `{ kind: "track", index: N, name?: "…" }` | `scan_track`, `render_audio` |
| `device` | `{ kind: "device", track: N, index: D, chain?: […] }` | `read_device`, **`read_drum_rack_map`** |
| `clipSlot` | `{ kind: "clipSlot", track: N, slot: S }` | `read_clip_notes`, MIDI write via `run_code` |
| `arrangementClip` | `{ kind: "arrangementClip", track: N, index: K }` | `read_clip_notes`, MIDI write via `run_code` |

**Wrong:** bare `1`, `track: 1`, or `{ track: 1 }` — unless the tool schema uses a flat `track`
field (exceptions below).

After add/delete/move tracks or devices, re-run `scan_context` and refresh addrs.

### User intent → track index `N`

Start from `scan_context` → `tracks[]` (`index`, `name`, `type`).

| User says | Do |
|-----------|-----|
| Track name ("Drums") | Match `name` (exact); use that `index`. |
| Track index ("track 1") | `{ kind: "track", index: N }`. |
| Ordinal ("first MIDI track") | Filter `type === "midi"`; pick the row's `index`. |
| Selected track | `read_selection` after Send to Agent; else ask. |

There is **no separate track id** — only `index` (+ optional `name` on track addrs).

### Track vs device (Drum Rack)

Drum Rack is a **device** on a track:

1. Resolve track index `N`.
2. In `tracks[N].devices[]`, find `type: "DrumRack"`.
3. Use that device's `addr` for `read_drum_rack_map` — not `{ kind: "track", index: N }`.

Example: `{ "addr": { "kind": "device", "track": 1, "index": 0 } }`.

### Flat `track` exceptions

| Tool | Params |
|------|--------|
| `find_clip` | `track`, `name`, optional `view` |
| `remap_clip_notes` | `track` when `scope: "trackArrangement"` |

Check each tool's schema — shapes differ.

## When a tool fails

**One failed call ≠ abandon scan/read tools.** Fix that call; use `run_code` for writes and steps
no specialized tool covers.

1. **Read the error** — `-32602` = wrong arguments (check schema). Kernel errors often end with
   `Next:`.
2. **Re-scan** — `scan_context` after structural edits.
3. **Retry the same tool** with corrected args (wrap `addr`, use `kind: "device"` for Drum Rack).
4. **Fix the script** — adjust `run_code` for write failures; do not re-implement reads in `run_code`.
5. **Do not** replace scan/read/find with ad-hoc `run_code` reads when those tools apply.

| Anti-pattern | Do instead |
|--------------|------------|
| `read_drum_rack_map` fails → one `run_code` for pads + notes | Fix `addr` → retry; `remap_clip_notes` or `run_code` for notes |
| `scan_context` missing arrangement clips → `run_code` for timeline | `scan_track` → `read_clip_notes` |
| Any error → "SDK for everything" | Fix the failing step only |

## Safety

Scan first; `ui.confirm(...)` before destructive/large edits; one undo step per batch. Default
read-only unless the user asks for edits. See **ableton-safety**.

## Routing

- **ableton-music-producer** — compose / arrange / mix / sound-design (MIDI, devices, playbooks).
- **ableton-extension-dev** — read-only SDK context while coding extensions.

## Reference

- SDK guides/reference: `search_knowledge` (qa-knowledge MCP) over `docs/knowledge/ableton-sdk/` — start with the SDK quickstart
- Upgrade notes: `apps/qa-ableton-mcp/docs/skills-upgrade-plan.md`
- Target design: `apps/quantum-agent/docs/mcp-tool-design/06-ideal-mcp-architecture.md`
- Hard limits: server instructions and the SDK quickstart (search_knowledge)
