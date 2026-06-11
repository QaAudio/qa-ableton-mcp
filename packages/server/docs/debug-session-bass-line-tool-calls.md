# Debug recap: bass-line session tool calls

Session goal: create a kick-aligned bass line on the **bass** MIDI track. This document inspects **every MCP-related step** in that agent run and records failures, workarounds, and fix recommendations.

**Environment:** Live + `qa-ableton-mcp-kernel` on `ws://127.0.0.1:17890`, Cursor MCP client, Set at 120 BPM C Major with arrangement clips on kick (track 0) and 808 kit (track 2).

**Repro script:** `apps/qa-ableton-mcp/scripts/debug-get-track-schema.ts` — calls kernel + validates against `getTrackOutputSchema`.

---

## Resolution (2026-06-09)

| Issue | Fix |
|-------|-----|
| P0 `clip.color` string vs number | `coerceClipColor()` in kernel `serialize.ts` |
| P1 arrangement discovery | `arrangementClipCount` on every track in `get_context` / `get_track` overview |
| P1 huge rack payloads | `includeDevices:false` on `ableton_get_track` |
| P1 opaque -32602 on schema fail | `toToolResult` sets `isError: true` + `steerOutputSchemaMismatch()` |
| P2 `includePitchSummary` on get_track | Removed from input schema (`getTrackShape`) |
| P2 error hints | Updated truncation / find-clip steering; live test adds `get_track:detailed` |

**After pulling:** rebuild kernel (`npm run ableton-mcp:kernel:build`) and restart `npm run ableton-mcp:kernel:dev`, then reload MCP in Cursor.

---

## Executive summary

| Severity | Count | Theme |
|----------|-------|--------|
| **P0 — broken tool output** | 1 | `ableton_get_track` with `responseFormat:'detailed'` fails output validation whenever arrangement/session clips exist (clip `color` type mismatch). Cursor surfaces this as opaque **MCP -32602**. |
| **P1 — agent UX / discovery** | 3 | Arrangement clips absent from `get_context`; 25k char cap truncates large payloads; note cap (128) on `get_clip_notes` concise. |
| **P2 — schema / docs drift** | 2 | `includePitchSummary` accepted on `get_track` but not implemented; error hints recommend `detailed` mode that is currently broken for tracks with clips. |
| **Info — successful path** | — | Agent recovered via `concise` + per-clip `get_clip_notes` + `run_code` batch write. |

---

## Chronological tool call log

### Phase 1 — Perceive (context)

| # | Call | Args (summary) | Result | Notes |
|---|------|----------------|--------|-------|
| 1 | `ableton_get_context` | `{}` | **OK** | Returned tempo, scale, 7 tracks, cue points. Session `clipSlots` all empty on kick/bass/808. **No arrangement clips** (by design). |
| 2 | `ableton_get_track` | track 0, `detailed`, `includePitchSummary:true` | **FAIL** | MCP `-32602`: *Output validation error … no structured content*. |
| 3 | `ableton_get_track` | track 2, `detailed`, `includePitchSummary:true` | **FAIL** | Same -32602. |
| 4 | `ableton_get_track` | track 1 (bass), `detailed`, `includePitchSummary:true` | **Partial** | Large JSON returned but **text truncated** at 25k chars; `[truncated]` steering hint appended. At this moment bass had **no arrangement clips**, so schema validation still passed (only failure mode was size). |

**Agent impact:** Three parallel `detailed` calls on discovery; two hard failures, one oversized response. Agent did not get arrangement clip list from the failed calls.

| # | Call | Args | Result | Notes |
|---|------|------|--------|-------|
| 5 | `ableton_get_track` | track 0, `concise` (default) | **OK** | Revealed 7 arrangement clips (`Kick - Intro` … `Kick - Outro`) with `noteCount` only. |
| 6 | `ableton_get_track` | track 2, `concise` | **OK** | Same section layout for 808 kit. |
| 7 | `ableton_get_track` | track 1 (bass), `concise` | **OK** | `arrangementClips: []` — confirmed empty target. |

### Phase 2 — Read kick / drum notes

All via `ableton_get_clip_notes` with `addr: { kind:'arrangementClip', track, index }` (default **concise**).

| # | Clip | Track | index | Result | Notes |
|---|------|-------|-------|--------|-------|
| 8 | Kick - Drop | 0 | 2 | **OK** | 64 notes, full list (at cap). |
| 9 | Kick - Intro | 0 | 0 | **OK** | 4 notes. |
| 10 | Kick - Main | 0 | 5 | **OK** | 36 notes incl. offbeat ghosts at 5.5, 13.5, … |
| 11 | Kick - Rise | 0 | 1 | **OK** | 8 notes, velocity ramp. |
| 12 | Kick - Breakdown | 0 | 3 | **OK** | 13 notes, sparse/accelerating. |
| 13 | Kick - Rise 2 | 0 | 4 | **OK** | 16 notes, every 2 beats. |
| 14 | Kick - Outro | 0 | 6 | **OK** | 20 notes, fade pattern. |
| 15 | Drop (808 kit) | 2 | 2 | **OK with truncation** | `noteCount: 248`, `notesTruncated: true`, only **128 notes** returned. `pitchSummary` still useful (36=kick, 42=hats, etc.). |

**Agent impact:** 808 drop pattern partially invisible (notes 129–248 omitted). Kick data was complete. Agent relied on kick track as primary groove reference — acceptable for this task.

### Phase 3 — Write bass (mutation)

| # | Call | Args | Result | Notes |
|---|------|------|--------|-------|
| 16 | `ableton_run_code` | `ui.confirm` + 7× `createMidiClip` in `withinTransaction` | **OK** | Created 157 notes across 7 clips on track 1. No `outputSchema` on this tool. |

**Not used:** `ableton_create_midi_clip` (Layer B). Reasonable choice: single confirm, single undo group, 7 clips in one batch. Trade-off: no structured write-tool validation on the return payload.

### Phase 4 — Verify

| # | Call | Result | Notes |
|---|------|--------|-------|
| 17 | `get_clip_notes` bass Drop, index 2 track 1 | **OK** | 64 notes, pitches 24/29/31 (C/G/F roots). |
| 18 | `get_track` bass, `concise` | **OK** | 7 arrangement clips listed. |

---

## Issue 1 (P0): `get_track` `detailed` — output schema mismatch

### Symptom

```
MCP error -32602: Output validation error: Tool ableton_get_track has an output schema but no structured content was provided
```

Cursor **does not** expose the server’s `[outputSchema mismatch]` body to the agent when `structuredContent` is withheld — only the generic -32602.

### Root cause (reproduced 2026-06-09)

Kernel returns `clip.color` as a **string**; MCP `clipOutputSchema` expects **number** (`z.number().optional()`).

Validation errors (all 7 arrangement clips on each track):

```
arrangementClips.N.clip.color: Invalid input: expected number, received string
```

**Where it comes from**

- `serializeClipSummary` in `qa-ableton-mcp-kernel/src/serialize.ts` sets `base.color = clip.color` in detailed mode.
- `apps/qa-ableton-mcp/resources/api/sdk.d.ts` declares `color: number`, but Live returns a string at runtime for these clips.

**When it triggers**

- Any `ableton_get_track` / `ableton_get_clip_notes` / `find_clip` response in **detailed** mode that includes clip metadata with `color`.
- **Concise** mode omits `color` → validation passes (explains why the agent recovered with `concise`).

**Repro**

```bash
cd apps/qa-ableton-mcp
npx tsx scripts/debug-get-track-schema.ts
```

### Recommended fixes

1. **Kernel:** Coerce `clip.color` to number in `serializeClipSummary` (or omit if NaN).
2. **Schema:** Alternatively widen to `z.union([z.number(), z.string()])` if Live’s string form is canonical.
3. **Server:** When schema fails, consider returning `isError: true` with mismatch details so Cursor doesn’t map it to a cryptic -32602.
4. **Tests:** Extend `test-output-schemas-live.mjs` to cover `get_track` detailed on a track **with** arrangement clips.

---

## Issue 2 (P1): Arrangement clips not on `get_context`

### Symptom

First `get_context` showed empty session slots on kick/bass/808; agent initially thought there was no musical content.

### Cause

Documented behavior: `get_context` excludes arrangement timeline clips (see tool description and server instructions).

### Agent recovery

Required extra `get_track` round trip per drum/kick track.

### Recommendations

- Skills / server instructions already mention this; consider a one-line **`arrangementClipCount`** per track on `get_context` (cheap summary) to steer agents without full clip payload.

---

## Issue 3 (P1): Response size cap (`CHARACTER_LIMIT = 25000`)

### Symptom

`get_track` bass **detailed** returned valid JSON prefix +:

```
[truncated]
Next: retry with responseFormat:'concise' (default), narrow the query …
```

### Cause

`apps/qa-ableton-mcp/src/tool-result.ts` stringifies validated payload and slices at 25k characters. Venture Bass rack (nested chains + 70+ params on inner Simpler) exceeds limit in detailed mode.

### Impact

Even if Issue 1 were fixed, **detailed full-track dumps** on rack-heavy tracks may remain unusable in agent context without pagination/filter flags.

### Recommendations

- Add `includeDevices?: boolean` to `get_track` (mirror `get_context`).
- Add `includeArrangementNotes?: boolean` default false for detailed track reads.
- Or raise limit selectively for read-only tools (trade-off: context cost).

---

## Issue 4 (P1): `get_clip_notes` note cap (concise)

### Symptom

808 **Drop** clip: `totalNoteCount: 248`, `notesTruncated: true`, 128 notes in array.

### Cause

`CONCISE_MAX_NOTES = 128` in kernel `serialize.ts`; default `responseFormat` is concise.

### Impact

Full drum pattern for 16-bar drop not visible in one call. Agent used kick track instead.

### Recommendations

- For analysis tasks, document **`responseFormat:'detailed'`** once Issue 1 is fixed (no note cap in detailed).
- Or add `offset`/`limit` pagination on notes.
- `includePitchSummary: true` mitigates partially (pitch histogram still returned).

---

## Issue 5 (P2): `includePitchSummary` on `get_track`

### Symptom

Agent passed `includePitchSummary: true` on `get_track` calls.

### Cause

Parameter is declared via `readAddrShape` in `schemas.ts` but **`handlers.get_track` never reads it** — only `get_clip_notes` and `find_clip` implement pitch summaries.

### Impact

Silent no-op; wasted parameter.

### Fix

Either implement (expensive on full track) or remove from `get_track` input schema.

---

## Issue 6 (P2): Misleading error steering

`tool-errors.ts` line 73 suggests:

> verify the exact clip name via **ableton_get_track (responseFormat:'detailed')**

That mode is **currently broken** for tracks with colored arrangement clips (Issue 1).

---

## Issue 7 (Info): Agent tool selection

| Choice | Assessment |
|--------|------------|
| `get_context` first | Correct per workflow. |
| Parallel `get_track` detailed × 3 | Failed; should default to **concise** for layout discovery. |
| `get_clip_notes` per kick section | Correct; right granularity. |
| `run_code` vs `create_midi_clip` × 7 | Valid for confirm + single undo; document as pattern for multi-clip arrangement builds. |
| No `get_drum_rack_map` | OK — task was kick-aligned bass, not drum remapping. |

---

## What worked end-to-end

Despite P0/P1 issues, the agent completed the task:

1. **Concise** `get_track` → section map and clip indices.
2. **Per-clip** `get_clip_notes` on kick → exact groove timing.
3. **`run_code`** with `ui.confirm` + `withinTransaction` → 7 bass clips, 157 notes.
4. **Verify** via `get_clip_notes` + `get_track`.

User-facing undo: single Live Cmd-Z (transaction grouped).

---

## Suggested verification checklist (post-fix)

- [ ] `npx tsx scripts/debug-get-track-schema.ts` → all tracks `structuredContent: YES`
- [ ] `npm run` kernel live schema test (`test-output-schemas-live.mjs`) includes detailed track with clips
- [ ] Cursor agent call `ableton_get_track { responseFormat:'detailed' }` on track 0 returns structured JSON, no -32602
- [ ] `get_clip_notes` detailed on arrangement clip validates after color fix
- [ ] Document max payload strategy (concise defaults, when to use clip-level reads)

---

## File references

| Area | Path |
|------|------|
| Output validation | `apps/qa-ableton-mcp/src/tool-result.ts` |
| Zod schemas | `apps/qa-ableton-mcp/src/output-schemas.ts` |
| Clip serialization | `ableton-extensions/qa-ableton-mcp-kernel/src/serialize.ts` |
| Character limit | `apps/qa-ableton-mcp/src/constants.ts` (`CHARACTER_LIMIT = 25000`) |
| Error hints | `apps/qa-ableton-mcp/src/tool-errors.ts` |
