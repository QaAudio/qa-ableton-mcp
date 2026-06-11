import { test } from "node:test";
import assert from "node:assert/strict";
import { runCode, claimAgentRejection } from "./run.js";
import type { Ctx } from "./protocol.js";

/**
 * Mirror the wiring extension.ts does: route unhandled rejections to the
 * in-flight run_code execution. node:test installs its own listener (lazily,
 * after module load) that fails the current test on *any* unhandledRejection,
 * so swap it out for the duration of the callback and delegate only rejections
 * run_code did not claim.
 */
async function withClaimRouting<T>(fn: () => Promise<T>): Promise<T> {
  const existing = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", (reason, promise) => {
    if (claimAgentRejection(reason)) return;
    for (const listener of existing) listener(reason, promise);
  });
  try {
    return await fn();
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const listener of existing) process.on("unhandledRejection", listener);
  }
}

const fakeCtx = {
  application: { song: { tempo: 120 } },
  withinTransaction: <T>(fn: () => T): T => fn(),
} as unknown as Ctx;

test("returns the result of agent code", async () => {
  const r = await runCode(fakeCtx, "const n: number = 21; return n * 2;");
  assert.equal(r.error, undefined);
  assert.equal(r.result, 42);
});

test("withinTransaction binding works", async () => {
  const r = await runCode(fakeCtx, "return withinTransaction(() => 40 + 2);");
  assert.equal(r.error, undefined);
  assert.equal(r.result, 42);
});

test("sync throw is reported as runtime error with logs", async () => {
  const r = await runCode(fakeCtx, 'log("before"); throw new Error("boom");');
  assert.equal(r.phase, "runtime");
  assert.match(r.error ?? "", /boom/);
  assert.deepEqual(r.logs, ["before"]);
});

test("unawaited promise rejection is reported, not swallowed", () =>
  withClaimRouting(async () => {
    const r = await runCode(
      fakeCtx,
      [
        'async function run() { throw new Error("floating-boom"); }',
        "run();", // classic mistake: missing `await`
        'return "done";',
      ].join("\n"),
    );
    assert.equal(r.phase, "runtime");
    assert.match(r.error ?? "", /unawaited promise rejected/);
    assert.match(r.error ?? "", /floating-boom/);
  }));

test("unawaited rejection mid-flight fails the execution early", () =>
  withClaimRouting(async () => {
    const r = await runCode(
      fakeCtx,
      [
        'async function bg() { throw new Error("bg-boom"); }',
        "bg();",
        "await sleep(1000);",
        'return "never";',
      ].join("\n"),
      { timeoutMs: 1500 },
    );
    assert.equal(r.phase, "runtime");
    assert.match(r.error ?? "", /bg-boom/);
  }));

test("ableton.withinTransaction gets a steering error", async () => {
  const r = await runCode(fakeCtx, "return ableton.withinTransaction(() => 1);");
  assert.equal(r.phase, "runtime");
  assert.match(r.error ?? "", /`ableton\.withinTransaction` does not exist/);
  assert.match(r.error ?? "", /withinTransaction\(fn\)/);
});

test("unknown ableton member gets a steering error", async () => {
  const r = await runCode(fakeCtx, "return ableton.nonsense;");
  assert.equal(r.phase, "runtime");
  assert.match(r.error ?? "", /`ableton\.nonsense` does not exist/);
});

test("ableton.song is rejected with guidance before running", async () => {
  const r = await runCode(fakeCtx, "return ableton.song.tempo;");
  assert.equal(r.phase, "runtime");
  assert.match(r.error ?? "", /context\.application\.song/);
});

test("awaited work is bounded by the wall-clock timeout", async () => {
  // Short sleep: the pending timer outlives runCode and would keep the test
  // process alive for its full duration.
  const r = await runCode(fakeCtx, 'await sleep(1000); return "late";', { timeoutMs: 100 });
  assert.equal(r.phase, "timeout");
  assert.match(r.error ?? "", /exceeded 100ms/);
});

test("transpile errors are phased", async () => {
  const r = await runCode(fakeCtx, "const broken: = ;");
  assert.equal(r.phase, "transpile");
});
