# qa-ableton-mcp — Skills & agent-behavior upgrade plan

Living document for issues observed while testing the new Ableton MCP skills. Each entry captures
what happened, root cause, and proposed fixes across **skills**, **MCP server**, **kernel**, and
**evals**.

**Status:** implemented (WP-A, WP-B seed, WP-D partial) — 2026-06-09.

**Related:** [ideal MCP architecture](../../quantum-agent/docs/mcp-tool-design/06-ideal-mcp-architecture.md),
[eval suite design](../evals/README.md), canonical skills in [`skills/`](../skills/).

---

## How to add an issue

Copy the template below into a new `### Issue N` section. Keep observations factual; separate
*what the agent did* from *what it should have done*.

```markdown
### Issue N — short title

**Observed** — what the agent did (tool calls, quotes, transcript link if any).

**Expected** — correct tool/skill path.

**Root cause** — skill gap, misleading doc, tool description, kernel behavior, eval gap, etc.

**Proposed fixes**
| Layer | Change |
|-------|--------|
| Skills | … |
| MCP server | … |
| Kernel | … |
| Evals | … |

**Acceptance** — how we know it's fixed (eval task, manual checklist).

**Priority** — P0/P1/P2.
```

---

## Cross-cutting themes (emerging)

| Theme | Description |
|-------|-------------|
| **Perceive routing** | Agents default to `run_code` when `get_context` is incomplete, instead of the next specialized perceive tool (`get_track`, `get_clip_notes`, `find_clip`). |
| **Context vs drill-down** | `get_context` is intentionally bounded; skills must state what it *excludes* and which tool to call next. |
| **Layer B completeness** | Specialized tools exist but are under-listed in the umbrella skill vs server instructions. |
| **Skill ↔ kernel truth** | Child skills must match kernel serialization (e.g. arrangement clips only on `get_track`). |
| **Addr shapes & validation** | Agents pass bare track indices or wrong nesting (`track: 1` instead of `addr: { kind: "device", … }`). MCP Zod rejects before kernel `steerKernelError` hints run. |
| **Tool param inconsistency** | Some tools use `addr` objects; others use flat `track: number` (`find_clip`, `create_midi_clip`). Agents over-generalize the flat pattern. |
| **Object kind vs track** | Drum Rack workflows need a **device** addr (`kind: "device"`), not a track addr — skills don't spell out the resolution ladder. |
| **Failure → full `run_code` pivot** | After one tool error (especially `-32602` or a kernel error), agents abandon Layer B and do the **entire** remaining workflow in `run_code` instead of fixing/retrying **that** call and continuing with tools elsewhere. |

---

## Issue backlog

### Issue 1 — `run_code` used to read arrangement clips and MIDI notes

**Observed** — After `ableton_get_context`, the agent noted that arrangement clips were missing
from the snapshot and ran `ableton_run_code` to iterate `track.getArrangementClips()`, read clip
metadata, and filter kick notes (`pitch 35–37`) via the SDK.

**Expected** — Read-only perceive chain without custom SDK code:

1. `ableton_get_track` — `{ addr: { kind: "track", index: N } }` → `arrangementClips[]` with
   summaries (`name`, `startTime`, `endTime`, `noteCount`, …).
2. `ableton_get_clip_notes` — `{ addr: { kind: "arrangementClip", track: N, index: k } }` with
   optional `includePitchSummary: true` for pitch histograms.
3. Or `ableton_find_clip` — `{ track: N, name: "…", view: "arrangement", includePitchSummary: true }`
   when the clip name is known.

**Root cause**

| Layer | Detail |
|-------|--------|
| **Kernel (by design)** | `serializeSongOverview` / `get_context` only includes Session View `clipSlots`, not arrangement timeline clips (`serializeTrackOverview` in `qa-ableton-mcp-kernel/src/serialize.ts`). |
| **Umbrella skill** | [`skills/SKILL.md`](../skills/SKILL.md) lists `get_clip_notes` but does not map “arrangement timeline → `get_track` first”. Rule of thumb says “perceive with specialized tool” without a routing table. |
| **Child skill (misleading)** | [`ableton-arrangement/SKILL.md`](../skills/music-producer/ableton-arrangement/SKILL.md) step 1 says perceive with `get_context` for `arrangementClips` — those fields are **not** on context, only on `get_track`. |
| **Tool visibility** | `ableton_find_clip`, `ableton_remap_clip_notes`, `ableton_get_drum_rack_map` are in server instructions ([`src/index.ts`](../src/index.ts)) but omitted from umbrella Layer B list. |
| **Tool description** | `get_context` description says “clip-slot occupancy” but does not explicitly say arrangement clips require `get_track`. |

**Proposed fixes**

| Layer | Change |
|-------|--------|
| **Skills — umbrella** | Add a **Perceive routing** table to [`skills/SKILL.md`](../skills/SKILL.md): Session clips → `get_context.clipSlots`; arrangement clips → `get_track`; MIDI notes → `get_clip_notes`; clip by name → `find_clip`. Explicit rule: **do not use `run_code` to read clips/notes**. Expand Layer B list with `find_clip`, `get_drum_rack_map`, `remap_clip_notes`. |
| **Skills — arrangement** | Fix workflow step 1: `get_context` for tracks/tempo/scale; **`get_track` for arrangement clips**. |
| **Skills — midi** | In workflow step 1, note that arrangement clips are not on context. |
| **Skills — `.cursor` mirrors** | Same edits via `npm run ableton-mcp:register` sync (`.cursor/skills/ableton-mcp/`, `ableton-arrangement/`, etc.). |
| **MCP server** | Extend `ableton_get_context` description: “Excludes arrangement timeline clips (use `ableton_get_track`).” Optionally add `nextStep` hint in tool-errors when agent might need arrangement data. |
| **Kernel** | No change required for Issue 1 (behavior is intentional). *Optional future:* lightweight `arrangementClipCount` per track on context overview to nudge drill-down without full clip payloads. |
| **Evals** | Add read-only task to [`evals/tasks.json`](../evals/tasks.json): “List kick pitches on drums track arrangement clip” — grader asserts `get_track` + `get_clip_notes` used, **no** `run_code`, state unchanged. Track `run_code` call count metric. |
| **README** | Short “perceive ladder” in [`README.md`](../README.md) matching umbrella skill. |

**Acceptance**

- [ ] Agent eval task passes without `run_code` on a template set with arrangement MIDI drums.
- [x] Umbrella + arrangement skills explicitly state `get_context` ≠ arrangement clips.
- [x] `get_context` tool description mentions arrangement exclusion.

**Priority** — P1 (common perceive path; wrong tool wastes tokens and bypasses caps/pitchSummary).

---

### Issue 2 — `get_drum_rack_map` called with wrong args (`addr` missing / track index only)

**Observed** — Agent called `ableton_get_drum_rack_map` with a bare track reference (e.g.
`track: 1` or just the number `1`), not a wrapped `addr` object. MCP rejected before the kernel
ran:

```text
MCP error -32602: Input validation error: Invalid arguments for tool ableton_get_drum_rack_map:
  path ["addr"] — expected object, received undefined
```

**Expected** — Drum Rack map requires a **Drum Rack device** address from context, not a track
index:

```json
{
  "addr": { "kind": "device", "track": 1, "index": 0 }
}
```

Where `track` is the regular track index and `index` is the device slot on that track (from
`tracks[i].devices[j]` — pick the entry with `type: "DrumRack"`).

Resolution ladder:

1. `ableton_get_context` → scan `tracks[]` for the target track and its `devices[]`.
2. Find device with `type === "DrumRack"` → use its embedded `addr` verbatim.
3. `ableton_get_drum_rack_map { addr: <that addr> }`.

**Root cause**

| Layer | Detail |
|-------|--------|
| **Skills** | No umbrella section on **how to identify tracks** or **addr shapes**. Agents guess parameter shapes from tool names. |
| **Umbrella skill** | [`skills/SKILL.md`](../skills/SKILL.md) does not document the `addr` model or user-intent → index resolution. |
| **Child skill** | [`drum-racks.md`](../skills/music-producer/ableton-sound-design/reference/drum-racks.md) says “device `addr` from `get_context`” but not how to get there from “the drums track”. |
| **MCP validation** | Zod failure (`-32602`) happens in the MCP server **before** kernel `steerKernelError` — no “Next: pass `{ kind:'device',… }`” hint on schema errors. |
| **Param inconsistency** | `find_clip` / `create_midi_clip` use flat `track: number`; `get_drum_rack_map` / `get_track` / `get_device` require `addr`. Agents over-apply the flat pattern. |
| **No track “id”** | Live MCP uses positional **index** (+ optional `name` sanity check on track addrs). There is no stable UUID — agents may confuse UI labels, handle ids, or bare numbers with `addr`. |

**Proposed fixes**

| Layer | Change |
|-------|--------|
| **Skills — umbrella** | Add **Addresses & track resolution** section (draft below). Add **Perceive routing** row: Drum Rack pads → `get_context` devices → `get_drum_rack_map(addr)`. |
| **Skills — sound-design** | Expand `drum-racks.md` with worked example: user says “drums track” → name match → device addr → `get_drum_rack_map`. |
| **Skills — `.cursor` mirrors** | Register script sync. |
| **MCP server** | Enrich `get_drum_rack_map` description with JSON example. Consider Zod `.describe()` on `addr` with full example object. |
| **MCP server (optional)** | Custom Zod error formatter for `-32602` that appends `ADDR_HINT` from [`tool-errors.ts`](../src/tool-errors.ts) when `addr` is missing. |
| **MCP server (optional)** | Alternate input: `track: number` on `get_drum_rack_map` → kernel finds first `DrumRack` on that track (reduces failure mode; keep `addr` as primary). |
| **Kernel** | No change required for minimal fix. Optional: `find_device_on_track(trackIndex, type: "DrumRack")` helper handler. |
| **Evals** | Read-only task: “What MIDI pitch is the kick pad on the drums track?” — grader checks valid `get_drum_rack_map` args and correct `receivingNote`; metric: zero `-32602` on drum tools. |

**Acceptance**

- [x] Umbrella skill documents addr shapes + user-intent → index resolution (name, ordinal, index).
- [ ] Agent resolves “drums track” → Drum Rack **device** addr without `-32602` (eval/manual).
- [x] `get_drum_rack_map` tool description includes a full example `addr` object.

**Priority** — P1 (hard failure, no recovery hint; blocks drum remap workflows).

---

### Issue 3 — After one tool failure, agent pivots to full `run_code` instead of partial recovery

**Observed** — When an intended Layer B call fails (e.g. Issue #2 `-32602` on
`get_drum_rack_map`, or Issue #1 missing data after `get_context`), the agent treats the failure
as “tools don't work” and switches the **rest of the task** to `ableton_run_code` — re-perceiving
(arrangement clips, notes, drum map) and mutating in one or more large SDK scripts. Tools that
would still work (`get_track`, `get_clip_notes`, `create_midi_clip`, `set_clip_notes`, …) are
not used for subsequent steps.

**Expected** — **Partial fallback:** fix or scope `run_code` to the **one gap** Layer B cannot
cover; keep using specialized tools for everything else.

| Failure type | Recover with | Keep using tools for |
|--------------|--------------|----------------------|
| Wrong args (`-32602`) | Read error + schema; fix params; **retry the same tool** | All other steps (perceive, MIDI write, remap) |
| Kernel error with `Next:` hint | Follow the hint; re-query `get_context` if addrs drifted | Steps that already succeeded or have a Layer B tool |
| Missing data on `get_context` | Next perceive tool (`get_track`, …) — **not** `run_code` | Notes → `get_clip_notes`; writes → MIDI tools |
| No Layer B tool for the action | `run_code` for **that mutation only** (devices, mixer, arrangement placement) | Perceive + MIDI read/write via Layer B |

Example drum workflow after `get_drum_rack_map` fails once:

1. Fix `addr` → retry `get_drum_rack_map` (do not read pads via SDK).
2. Still use `remap_clip_notes` or `set_clip_notes` for pitch changes — not `clip.notes = …` in
   `run_code` unless the specialized tool cannot do it.

**Root cause**

| Layer | Detail |
|-------|--------|
| **Umbrella skill** | [`skills/SKILL.md`](../skills/SKILL.md) says “act with `run_code` for everything else” without a **failure recovery** rule or “partial fallback” boundary. |
| **Server instructions** | [`src/index.ts`](../src/index.ts) workflow step 3: “use `ableton_run_code` for everything else” — reads as exclusive fallback, not last resort for uncovered actions only. |
| **Child skills** | Several producer skills center `run_code` in workflow step 3 (`ableton-midi`, `ableton-mixing`, `music-producer`) without “on tool error, fix and retry; don't replace the whole act phase.” |
| **`steerKernelError`** | Kernel errors include `Next:` hints aimed at **one** recovery action; skills don't say “apply locally, then continue with Layer B.” |
| **MCP `-32602`** | Schema failures have no steering — agent may infer entire MCP layer is unusable (see Issue #2 / WP-D). |
| **Eval gap** | No task that injects a recoverable tool failure and grades that later steps still use Layer B. |

**Related** — Issue #1 (read perceive via `run_code` after incomplete context) and Issue #2
(wrong args) are common **triggers** for this pivot; fixing routing/addr docs alone may not stop
the pivot without an explicit recovery policy.

**Proposed fixes**

| Layer | Change |
|-------|--------|
| **Skills — umbrella** | Add **When a tool fails** section (draft below). Tighten Layer A/B rule: `run_code` = uncovered mutations + bespoke logic, **not** a substitute for perceive/MIDI tools after errors. |
| **Skills — safety** | [`guardrails.md`](../skills/music-producer/ableton-safety/reference/guardrails.md): one failed tool ≠ abandon read-only perceive tools. |
| **Skills — producer children** | One-line in midi/mixing/sound-design workflows: “If a specialized tool errors, fix args and retry; use `run_code` only for the step with no Layer B tool.” |
| **MCP server** | Server instructions step 3: “On tool error, follow `Next:` / fix schema — retry that tool. Do not replace the whole workflow with `run_code`.” |
| **`run_code` guide resource** | In [`quickstart.md`](../resources/quickstart.md) + server [`INSTRUCTIONS`](../src/index.ts): “Escape hatch for actions without a specialized tool — not a replacement for scan/read tools after a failure.” |
| **MCP server (optional)** | WP-D: schema errors with `ADDR_HINT` reduce false “MCP is broken” pivots. |
| **Evals** | **Recovery task:** deliberate bad `get_drum_rack_map` args in harness OR scripted first-call failure; grade that agent retries with valid args **and** uses `set_clip_notes` / `get_clip_notes` for other steps. Metric: `run_code` count bounded after recoverable errors. |

**Acceptance**

- [x] Umbrella + server instructions state partial-fallback policy explicitly.
- [x] Eval recovery task seeded (`drum-workflow-recovery`); transcript grading Phase 1.
- [x] Child skills (midi, mixing, safety) mention retry-not-replace.

**Priority** — P1 (meta-behavior; amplifies Issues #1–#2 and wastes tokens/reliability).

---

### Issue 4 — Long MIDI clip + short notes + `looping:true` (empty piano roll)

**Observed** — Agent creates an arrangement (or session) clip with `lengthBeats=40` (or another
long section length), writes a 4-beat drum/harmonic pattern in beats 0–4, and sets
`looping:true` expecting Live to repeat the 4-beat pattern across the clip (as in the Live UI loop
brace). The Arrangement piano roll shows the **full 40 beats**, mostly empty; playback does not
tile the short pattern.

**Expected** — Either:

1. `lengthBeats` = pattern length (e.g. 4) with notes filling 0–4 (Session / launchable loop), or
2. `lengthBeats` = section length with **notes tiled in code** across the full span (eight-bar-loop
   playbook), or separate clips per section (`arrangement-clips.md`).

Do **not** rely on `looping:true` to shrink the loop region below `lengthBeats` for MIDI.

**Root cause**

| Layer | Detail |
|-------|--------|
| **SDK** | MIDI `createMidiClip` has no `loopSettings`; `loopStart`/`loopEnd` are read-only and equal the full clip at creation ([`resources/api/sdk.d.ts`](../resources/api/sdk.d.ts)). Only `clip.looping` is writable. |
| **Skills — ableton-midi** | [`ableton-midi/SKILL.md`](../skills/music-producer/ableton-midi/SKILL.md) said “loop by default” without distinguishing the `looping` boolean from a short musical loop or warning that loop region = `lengthBeats`. |
| **Skills — reference** | [`clips-and-notes.md`](../skills/music-producer/ableton-midi/reference/clips-and-notes.md) mentioned fixed loop points but not the anti-pattern or valid tiling patterns. |
| **MCP tool** | `create_midi_clip` `looping` param implied Live UI loop-brace behavior; no link to `lengthBeats` semantics. |
| **Verify gap** | Default `get_clip_notes` (concise) omits `loopStart`/`loopEnd` — agents cannot spot `loopEnd >> maxNoteEnd` without `responseFormat:"detailed"`. |

**Proposed fixes**

| Layer | Change |
|-------|--------|
| **Skills — ableton-midi** | § “Clip length vs loop region” in `clips-and-notes.md`; updated hard limits in `SKILL.md`. |
| **MCP server** | Clarify `lengthBeats` and `looping` in [`schemas.ts`](../src/schemas.ts) and [`tools.ts`](../src/tools.ts). |
| **Evals** | Task `arrangement-drum-pattern-tiled` — 16-beat arrangement clip with 4-beat kick pattern; grader rejects sparse long clip. |
| **Kernel (optional)** | Post-create warning when `looping && maxNoteEnd < duration * 0.9`. |

**Acceptance**

- [x] `clips-and-notes.md` documents anti-pattern + valid patterns.
- [x] `ableton-midi/SKILL.md` hard limits distinguish loop region vs `looping` flag.
- [x] `create_midi_clip` schema/tool descriptions warn about long clip + short notes.
- [ ] Eval task passes when agent tiles notes; fails on broken `lengthBeats=16` + notes in 0–4 only.
- [ ] Agent eval on producer prompts no longer produces empty long arrangement clips.

**Priority** — P1 (common producer workflow; visible user-facing bug in piano roll).

---

## Draft — umbrella “When a tool fails” section

*Target: [`skills/SKILL.md`](../skills/SKILL.md) — implement in WP-A.*

### Policy: partial fallback, not full pivot

**One failed tool call does not mean abandon Layer B.** Fix the failing call (or use `run_code`
**only for that step** if no specialized tool exists), then continue with specialized tools for
everything else.

### Recovery ladder

1. **Read the error** — MCP `-32602` = wrong arguments (check tool schema). Kernel errors often
   end with `Next:` ([`steerKernelError`](../src/tool-errors.ts)).
2. **Re-query if needed** — `ableton_get_context` after structural edits (addrs drift).
3. **Retry the same tool** with corrected args (e.g. wrap `addr`, pick `kind: "device"` not
   `kind: "track"` for Drum Rack).
4. **Escalate narrowly** — `run_code` only for the **specific action** Layer B does not cover
   (insert device, set mixer, place arrangement clip, `ui.confirm`, multi-step bespoke logic).
5. **Do not** re-implement perceive or MIDI read/write in `run_code` when
   `get_track` / `get_clip_notes` / `create_midi_clip` / `set_clip_notes` / `find_clip` /
   `get_drum_rack_map` / `remap_clip_notes` apply.

### Anti-patterns

| Don't | Do instead |
|-------|------------|
| `get_drum_rack_map` fails → one `run_code` that reads clips, maps pads, and rewrites notes | Fix `addr` → retry `get_drum_rack_map`; `remap_clip_notes` or `set_clip_notes` for pitches |
| `get_context` missing arrangement clips → `run_code` for all timeline inspection | `get_track` then `get_clip_notes` |
| Any tool error → “I'll use the SDK for everything” | Identify which step failed; only that step may need `run_code` |

### What `run_code` is for (Layer A)

- Mutations with **no** Layer B tool (most device/mixer/arrangement timeline ops).
- Bespoke multi-step logic inside **one** undo step (`withinTransaction`).
- `ui.confirm` / `ui.progress` before large edits.

### What Layer B is for (even after errors)

- Perceive: `get_context`, `get_track`, `get_device`, `get_clip_notes`, `get_selection`,
  `find_clip`, `get_drum_rack_map`.
- Session write: `create_track`.
- MIDI write: `create_midi_clip`, `set_clip_notes`, `remap_clip_notes`.
- Audio: `render_audio`.

---

## Draft — umbrella “Addresses & track resolution” section

*Target: [`skills/SKILL.md`](../skills/SKILL.md) — implement in WP-A.*

### The `addr` model

Objects in Live are referenced by a **positional address**, not a permanent id. Every perceive
response includes an `addr` — **copy it verbatim** into tools that accept `addr`.

| `kind` | Shape | Used for |
|--------|-------|----------|
| `track` | `{ kind: "track", index: N, name?: "…" }` | `get_track`, `render_audio` (audio tracks) |
| `device` | `{ kind: "device", track: N, index: D, chain?: […] }` | `get_device`, **`get_drum_rack_map`** |
| `clipSlot` | `{ kind: "clipSlot", track: N, slot: S }` | `get_clip_notes`, MIDI write tools |
| `arrangementClip` | `{ kind: "arrangementClip", track: N, index: K }` | `get_clip_notes`, MIDI write tools |

**Wrong:** `track: 1`, `{ track: 1 }`, or a bare number — unless the tool schema explicitly
uses a flat `track` field (see below).

**Handles are ephemeral** — after add/delete/move tracks or devices, re-run `get_context` and
refresh addrs.

### Resolving what the user meant → track index `N`

Always start with `ableton_get_context` → `tracks[]` (each row has `index`, `name`, `type`).

| User says | Do |
|-----------|-----|
| **Track name** (“Drums”, “Kick”) | Find `tracks[]` where `name` matches (case-sensitive exact match). Use that row's `index`. |
| **Track index** (“track 1”, “index 0”) | Use that integer as `index` in `{ kind: "track", index: N }`. |
| **Ordinal / role** (“first MIDI track”, “the drum track”) | Filter `type === "midi"` (and optionally name/device heuristics), pick the intended row's `index`. |
| **Selected track** | `ableton_get_selection` if the user used Send to Agent; else ask or infer from context. |

There is **no separate track id** in MCP — only `index` (+ optional `name` on track addrs for
drift warnings).

### Track index vs device addr (Drum Rack)

A **track** holds **devices**. Drum Rack is a **device** on a track:

1. Resolve track index `N` (table above).
2. From `tracks[N].devices[]`, find `type: "DrumRack"`.
3. Use that device's `addr` (e.g. `{ kind: "device", track: N, index: 0 }`) for
   `get_drum_rack_map` and `get_device` — **not** `{ kind: "track", index: N }`.

### Tools that use flat `track` (exception)

These take a **track index integer**, not a full `addr`:

| Tool | Param |
|------|-------|
| `ableton_find_clip` | `track`, `name`, optional `view` |
| `ableton_create_midi_clip` | `track`, `view`, … |
| `ableton_remap_clip_notes` | `track` when `scope: "trackArrangement"` |

Check each tool's schema before calling — do not assume all tools share the same shape.

### Perceive routing (rollup)

| Need | Tool chain |
|------|------------|
| Set overview, track list, session clips, device metadata | `get_context` |
| Arrangement timeline clips | `get_track { addr: { kind: "track", index: N } }` |
| MIDI notes in a clip | `get_clip_notes { addr: clipSlot \| arrangementClip }` |
| Clip by name | `find_clip { track: N, name, view? }` |
| Drum Rack pad map | `get_context` → DrumRack `devices[].addr` → `get_drum_rack_map { addr }` |
| Device parameters | `get_device { addr: device }` |

**Rule:** do not use `run_code` to read clips, notes, or drum maps when a Layer B tool exists.

---

## Work packages (rollup)

| Package | Issues | Effort | Notes |
|---------|--------|--------|-------|
| **WP-A — Perceive + addr + recovery docs** | #1, #2, #3 | S | Umbrella routing, addr/track resolution, **partial-fallback policy**; README; child skill fixes; server instructions + run_code guide. |
| **WP-B — Eval: perceive + recovery** | #1, #2, #3 | M | Read-only perceive tasks; **recovery task** after recoverable failure; metrics for `run_code` misuse, `-32602`, post-error tool mix. |
| **WP-C — Context hints (optional)** | #1 | M | Kernel `arrangementClipCount` on overview or richer tool-errors. |
| **WP-D — Schema error steering (optional)** | #2, #3 | S | MCP layer appends `ADDR_HINT` on Zod failures — reduces false full pivot to `run_code`. |

---

## Implementation log

| Date | Change | Issue |
|------|--------|-------|
| 2026-06-09 | Plan created; Issue #1 documented | #1 |
| 2026-06-09 | Issue #2 + draft umbrella addr/track section | #2 |
| 2026-06-09 | Issue #3 + draft partial-fallback / recovery section | #3 |
| 2026-06-09 | WP-A implemented: umbrella + child skills, README, server instructions, run_code guide | #1–#3 |
| 2026-06-09 | WP-B seed: eval tasks + README metrics | #1–#3 |
| 2026-06-09 | WP-D partial: `steerInputValidationError`, schema/tool descriptions | #2–#3 |
| 2026-06-09 | `ableton_create_track` Layer B tool (MIDI + audio); kernel `tracks.ts`, eval tasks | session_helpers slice |
