#!/usr/bin/env node
/**
 * Deterministic state grader for the eval suite (Phase 0 seed → Phase 1 harness).
 * Compares Live state via the kernel WS client — no LLM loop yet.
 *
 * Usage:
 *   node evals/grade-state.mjs --task tempo-read --snapshot-before before.json --snapshot-after after.json
 *   node evals/grade-state.mjs --capture before.json   # save get_context for later diff
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KERNEL_URL = process.env.ABLETON_KERNEL_URL ?? "ws://127.0.0.1:17890";
const TASKS_PATH = join(__dirname, "tasks.json");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function kernelCall(method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(KERNEL_URL);
    const id = 1;
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Kernel call timed out (${KERNEL_URL})`));
    }, 60000);

    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on("message", (data) => {
      clearTimeout(timer);
      ws.close();
      const msg = JSON.parse(data.toString());
      if (!msg.ok) reject(new Error(msg.error ?? "kernel error"));
      else resolve(msg.result);
    });
  });
}

async function captureContext(path) {
  const ctx = await kernelCall("get_context", { responseFormat: "concise" });
  writeFileSync(path, `${JSON.stringify(ctx, null, 2)}\n`, "utf8");
  console.log(`Wrote snapshot → ${path}`);
  return ctx;
}

function stableStringify(obj) {
  return JSON.stringify(obj);
}

function gradeStateUnchanged(before, after) {
  return stableStringify(before) === stableStringify(after)
    ? { pass: true }
    : { pass: false, reason: "Live set state changed on a read-only task" };
}

function findTrackIndex(ctx, trackName) {
  const want = trackName.toLowerCase();
  const track = (ctx.tracks ?? []).find((t) => String(t.name).toLowerCase() === want);
  return track?.index ?? null;
}

function maxNoteEnd(notes) {
  let max = 0;
  for (const n of notes ?? []) {
    const end = (n.startTime ?? 0) + (n.duration ?? 0);
    if (end > max) max = end;
  }
  return max;
}

function kickOnsets(notes, kickPitch) {
  return (notes ?? [])
    .filter((n) => n.pitch === kickPitch)
    .map((n) => n.startTime ?? 0)
    .sort((a, b) => a - b);
}

/** Pass when a long clip has the pattern tiled, or clip length equals pattern length. */
function notesTilePattern(kickTimes, patternLength, clipLength, kickPitch, notes) {
  if (clipLength <= patternLength + 0.01) {
    return kickTimes.length >= 4;
  }
  const expected = [];
  for (let t = 0; t < clipLength - 0.01; t += 1) {
    expected.push(t);
  }
  const have = new Set(kickTimes.map((t) => Math.round(t * 1000) / 1000));
  const missing = expected.filter((t) => !have.has(Math.round(t * 1000) / 1000));
  if (missing.length === 0) return true;
  // Allow tiled 4-beat blocks: kicks at 0,1,2,3, 4,5,6,7, …
  const blockExpected = [];
  for (let block = 0; block < clipLength / patternLength; block++) {
    for (let b = 0; b < patternLength; b++) {
      blockExpected.push(block * patternLength + b);
    }
  }
  const blockMissing = blockExpected.filter((t) => !have.has(Math.round(t * 1000) / 1000));
  return blockMissing.length === 0 && (notes?.length ?? 0) >= blockExpected.length;
}

async function gradeMidiPatternTiled(grader) {
  const ctx = await kernelCall("get_context", { responseFormat: "concise" });
  const trackIndex = findTrackIndex(ctx, grader.trackName);
  if (trackIndex == null) {
    return { pass: false, reason: `track '${grader.trackName}' not found` };
  }

  const trackDetail = await kernelCall("get_track", {
    addr: { kind: "track", index: trackIndex },
    responseFormat: "concise",
  });
  const clips = trackDetail.arrangementClips ?? [];
  let clipEntry = clips.find((c) => c.clip?.name === grader.clipName);
  if (!clipEntry && grader.clipName) {
    return { pass: false, reason: `arrangement clip '${grader.clipName}' not found on ${grader.trackName}` };
  }
  if (!clipEntry) clipEntry = clips[0];
  if (!clipEntry?.clip) {
    return { pass: false, reason: `no arrangement clips on track '${grader.trackName}'` };
  }

  const clipIndex = clipEntry.index;
  const summary = clipEntry.clip;
  const clipLength = grader.clipLengthBeats ?? summary.duration ?? summary.endTime - summary.startTime;
  const patternLength = grader.patternLengthBeats ?? 4;
  const kickPitch = grader.kickPitch ?? 36;

  const detail = await kernelCall("get_clip_notes", {
    addr: { kind: "arrangementClip", track: trackIndex, index: clipIndex },
    responseFormat: "detailed",
  });
  const duration = detail.duration ?? clipLength;
  const notes = detail.notes ?? [];
  const kickTimes = kickOnsets(notes, kickPitch);
  const noteEnd = maxNoteEnd(notes);

  if (duration > patternLength + 0.01 && noteEnd <= patternLength + 0.01 && kickTimes.length <= 4) {
    return {
      pass: false,
      reason:
        `long clip (${duration} beats) with notes only in 0–${patternLength} — ` +
        "MIDI loop region equals full clip; tile notes or use shorter lengthBeats",
    };
  }

  if (notesTilePattern(kickTimes, patternLength, duration, kickPitch, notes)) {
    return { pass: true };
  }

  return {
    pass: false,
    reason: `expected ${kickPitch} kicks tiled across ${duration} beats (pattern ${patternLength}); got onsets [${kickTimes.join(", ")}]`,
  };
}

async function gradeTask(task, before, after) {
  const results = [];
  for (const grader of task.graders ?? []) {
    if (grader.type === "state_unchanged") {
      results.push({ grader, ...gradeStateUnchanged(before, after) });
      continue;
    }
    if (grader.type === "midi_pattern_tiled") {
      results.push({ grader, ...(await gradeMidiPatternTiled(grader)) });
      continue;
    }
    results.push({ grader, pass: false, reason: `grader '${grader.type}' not implemented yet` });
  }
  const pass = results.every((r) => r.pass);
  return { taskId: task.id, pass, results };
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.capture) {
    await captureContext(args.capture);
    return;
  }

  const tasks = JSON.parse(readFileSync(TASKS_PATH, "utf8"));
  const task = tasks.find((t) => t.id === args.task);
  if (!task) {
    console.error(`Unknown task '${args.task}'. See evals/tasks.json`);
    process.exit(1);
  }

  const before = args["snapshot-before"]
    ? JSON.parse(readFileSync(args["snapshot-before"], "utf8"))
    : await kernelCall("get_context", { responseFormat: "concise" });
  const after = args["snapshot-after"]
    ? JSON.parse(readFileSync(args["snapshot-after"], "utf8"))
    : await kernelCall("get_context", { responseFormat: "concise" });

  const report = await gradeTask(task, before, after);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
