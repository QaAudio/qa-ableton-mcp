# qa-ableton-mcp — Eval suite (design + seed task bank)

> **Status:** design + seed + harness skeleton (Phase 0 complete → Phase 1 agent loop).
> This doc defines *what* we measure and *how we'll grade*, plus the initial task bank.
> Rationale and method: [eval distillation](../../quantum-agent/docs/mcp-tool-design/04-evals-for-agents.md);
> backlog record `backlog.eval_suite` in [ableton-mcp-knowledge.md](../../quantum-agent/docs/ableton-mcp-knowledge.md).

## Why

The MCP currently has **no way to measure** whether a tool-description, schema, skill, or
`run_code`-guide change helps or hurts. Per the distillation, evals turn "feels better" into
evidence. This suite is the prerequisite that makes all Phase 1+ tool work evidence-driven.

## Scope & principles (from 04)

- Start small: **20–50 tasks** from real producer requests; big early effect sizes mean small
  samples suffice.
- **Grade the outcome, not the path** — agents find valid alternate strategies; don't over-specify
  tool order.
- **Favor deterministic graders** — we own the environment (the kernel can re-query Live state).
- **Balance** mutate vs must-not-mutate tasks to catch over-eager edits.
- **Capability vs regression:** start as capability (low pass rate); graduate passing tasks into a
  regression suite run on kernel/server/skill changes.

## Architecture

- **Home:** `apps/qa-ableton-mcp/evals/` (this folder). Task bank in [`tasks.json`](./tasks.json); deterministic grader in [`grade-state.mjs`](./grade-state.mjs) (kernel WS, no LLM loop yet).
- **Transport:** reuse the existing kernel WS client ([kernel-client.ts](../src/kernel-client.ts)) or
  drive the full MCP stdio path for end-to-end fidelity. Open decision.
- **Harness:** one agentic `while`-loop per task (LLM ⇄ tool calls); record the full transcript +
  the final Live state (outcome). Emit reasoning/feedback before tool calls (CoT).
- **Determinism caveat:** Live is not fully headless. Each trial should start from a known set
  (template `.als` or a scripted reset via `run_code`). Record manual-setup cost as a constraint.

## Graders

- **Outcome / state check (primary, deterministic):** after the run, call
  `get_context` / `get_track` / `get_clip_notes` and assert the expected track/clip/device/notes
  exist with expected properties.
- **Tool-call metrics:** number of `run_code` calls, error `phase` distribution
  (`transpile`/`runtime`/`timeout`), tokens, latency.
- **Must-not-mutate check:** assert the set state is unchanged for read-only tasks (snapshot diff).
- **LLM rubric (only where open-ended):** musical sensibility / instruction-following.

Scoring per task: binary (all graders pass), weighted (threshold), or hybrid; build in partial
credit for multi-part tasks.

## Metrics to track

`pass@1` (and `pass^k` for reliability-sensitive tasks), tokens/task, tool-calls/task, error rate
by phase, latency. Track on a static bank so regressions are visible.

**Agent-behavior metrics** (from transcript, Phase 1 harness):

- `run_code` calls on read-only / perceive tasks (should be 0).
- `-32602` input validation count (wrong `addr` shapes).
- After a recoverable tool error: retry of the same tool + continued Layer B use (partial
  fallback — not full pivot to `run_code`).

Tasks in `tasks.json` may include `expectedTools` / `avoidTools` for transcript graders;
deterministic `grade-state.mjs` only checks Live state today.

## Seed task bank (v0 — expand toward 20–50)

Each task: prompt + verifiable outcome + class (`mutate` / `read-only`) + (optional) expected tools.

1. **Tempo read** (read-only) — "What is the tempo and time signature of the set?" → outcome: answer
   matches `song.tempo` / signature; set state unchanged.
2. **Scale/key read** (read-only) — "What key/scale is the set in?" → matches `get_context` scale; no mutation.
3. **Track inventory** (read-only) — "List the audio tracks and whether each is armed." → matches context.
4. **Add MIDI clip** (mutate) — "Add a 1-bar MIDI clip with a C-major triad to a new MIDI track." →
   outcome: a new MIDI track with a clip containing pitches {60,64,67}. Expect `ableton_run_code`.
4b. **Create audio track** (mutate) — "Create a new audio track named 'Stem'." → outcome: audio track
   named Stem exists. Expect `ableton_run_code`.
5. **Bassline in key** (mutate) — "Add a 4-bar MIDI clip in C minor with a simple root-note bassline
   to the track named 'Bass'." → outcome: clip exists on 'Bass'; all notes in C-minor; length 4 bars.
6. **Return + send** (mutate) — "Create a return track with a Reverb and send the drums to it." →
   outcome: a return track with a Reverb device exists; drum track send to it > 0.
7. **Insert device** (mutate) — "Put an EQ Eight on the master and set a low cut." → outcome: EQ Eight
   present on main; relevant band enabled. (Respects built-in-device-only limit.)
8. **Rename empties** (mutate) — "Rename every empty audio track to 'unused-N'." → outcome: each
   previously empty audio track renamed; non-empty tracks untouched.
9. **Read device params** (read-only) — "Report the parameters and current values of the first device
   on track 1." → matches `get_device`; no mutation.
10. **Duplicate clip notes** (mutate) — "Duplicate the MIDI clip in track 'Lead' slot 1 into slot 2." →
    outcome: slot 2 holds a clip whose notes equal slot 1's.
11. **Transpose** (mutate) — "Transpose the notes in the selected MIDI clip up an octave." → outcome:
    every note pitch +12 vs before. (Uses `get_selection`.)
12. **Safety / no-op** (read-only) — "Is there anything on the master chain?" → outcome: correct
    answer; explicitly no edits made.

## Harness commands (today)

```bash
# Capture a get_context snapshot (requires kernel running in Live)
npm run eval:capture -- evals/snapshots/before.json

# Grade a read-only task against two snapshots (state_unchanged grader)
npm run eval:grade -- --task safety-noop --snapshot-before evals/snapshots/before.json --snapshot-after evals/snapshots/after.json
```

Mutate-task graders (`track_exists`, `clip_notes_match`, …) are stubbed — implement in Phase 1.

## Open questions (resolve in Phase 1)

- Transport for the full agent loop (MCP stdio vs direct kernel WS) and where the LLM runs.
- Live reset strategy for trial isolation (template set vs scripted teardown).
- LLM-judge model + calibration for the rubric tasks.

## Doc-trace

This design is recorded as `backlog.eval_suite` in the groundwork (added in Phase 0 Step 06) and
flips the "eval-driven development" row of the distillation verdict map to in-progress.
