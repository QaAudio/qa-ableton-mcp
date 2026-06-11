import * as ableton from "@ableton-extensions/sdk";
import { transform } from "sucrase";
import { type Ctx, type HandlerResult, jsonReplacer } from "./protocol.js";
import { confirmDialog, progressDialog, type ConfirmOptions } from "./ui-dialogs.js";
import { ir } from "@quantumaudio/music-ir";
import { kernelLog } from "./log.js";

const DEFAULT_TIMEOUT_MS = 30000;

/** Internal marker so the timeout branch of the race is recognisable. */
class TimeoutError extends Error {}

/** Internal marker for a rejection from a promise the agent forgot to await. */
class FloatingRejection {
  constructor(readonly reason: unknown) {}
}

type RejectionCollector = (reason: unknown) => void;

/** Executions currently inside `runCode`, most recent last. */
const activeExecutions: RejectionCollector[] = [];

/**
 * Attribute a process-level `unhandledRejection` to the in-flight `run_code`
 * execution (most recent when several overlap). The extension's process handler
 * MUST call this first; when it returns `true` the rejection is reported back
 * to the client as a runtime error instead of being silently swallowed —
 * typically agent code that did `run()` instead of `await run()`.
 */
export function claimAgentRejection(reason: unknown): boolean {
  const current = activeExecutions[activeExecutions.length - 1];
  if (!current) return false;
  current(reason);
  return true;
}

/** Let the event loop turn over so Node can surface pending unhandled rejections.
 * NOTE: `setTimeout`, not `setImmediate` — the Ableton Extension Host's embedded
 * Node has no global `setImmediate`. */
async function settleTicks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Run an async UI interaction with the wall-clock timeout paused (user think-time
 * must not trip the run_code timeout). */
async function withPausedTimeout<T>(
  gate: { pause: () => void; resume: () => void },
  fn: () => Promise<T>,
): Promise<T> {
  gate.pause();
  try {
    return await fn();
  } finally {
    gate.resume();
  }
}

/**
 * Globals shadowed (bound to `undefined`) inside the executor to curate scope.
 * NOTE: `node:vm` is a no-op in the Ableton Extension Host's embedded Node, so we
 * execute via `new Function` and curate by shadowing rather than via a vm context.
 * (`eval`/`arguments` can't be used as parameter names in strict mode.)
 */
const SHADOWED = [
  "process",
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "globalThis",
  "global",
  "Buffer",
];

/** Agent code often mistakes `ableton` (SDK namespace) for the Live Song object. */
const ABLETON_SONG_MISTAKE = /\bableton\s*\.\s*song\b/;

/** Steering for common mistakes on the `ableton` namespace binding. */
const ABLETON_MEMBER_HINTS: Record<string, string> = {
  withinTransaction: "use the `withinTransaction(fn)` binding (or `context.withinTransaction`)",
  song: "use the `song` binding or `context.application.song`",
  application: "use `context.application`",
  ui: "use the `ui` binding (ui.confirm / ui.progress)",
};

/**
 * The `ableton` binding handed to agent code. Accessing a member that does not
 * exist on the SDK namespace throws a steering error immediately instead of
 * yielding `undefined` (which surfaces later as an opaque "x is not a function").
 */
const abletonForAgent = new Proxy(ableton, {
  get(target, prop, receiver) {
    if (typeof prop === "symbol" || prop in target) return Reflect.get(target, prop, receiver);
    const hint = ABLETON_MEMBER_HINTS[prop];
    throw new Error(
      `\`ableton.${prop}\` does not exist — \`ableton\` is the SDK namespace (classes/enums), not Live's object model. ` +
        (hint ? `Instead ${hint}.` : "Use the `context`/`song` bindings; search_knowledge for the Ableton SDK quickstart."),
    );
  },
});

async function drainPendingTransactions(pending: Promise<unknown>[]): Promise<void> {
  if (pending.length === 0) return;
  const settled = await Promise.allSettled(pending);
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (rejected) throw rejected.reason;
}

/**
 * Hardened executor for agent-authored code.
 *
 * Containment, not isolation: the code runs in the host process with the live
 * SDK `context`. We transpile TS, curate the scope (shadowed globals; no
 * require/process/fs), bound awaited work by wall-clock time, and report phased
 * errors. LIMITATION: a *synchronous* infinite loop cannot be interrupted (it
 * blocks the event loop so the timeout timer can't fire) — only awaited work is
 * bounded. Acceptable because the author is the coding agent (semi-trusted).
 */
export async function runCode(
  ctx: Ctx,
  code: string,
  opts: { timeoutMs?: number } = {},
): Promise<HandlerResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logs: string[] = [];
  const log = (...args: unknown[]) =>
    logs.push(
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a, jsonReplacer))).join(" "),
    );
  const consoleShim = { log, error: log, warn: log, info: log, debug: log };

  // 1. Wrap first (so a top-level `return` is valid), then strip TS types.
  //    `disableESTransforms` keeps modern ES syntax (??, ?., ??=, class fields,
  //    numeric separators) as-is for the host's native Node (>=24) instead of
  //    down-levelling it. Without this, sucrase rewrites `??`/`?.` into helper
  //    calls (`_nullishCoalesce`/`_optionalChain`) and prepends the helper decls;
  //    embedded after our `return ${transpiled}` those decls fall out of scope →
  //    `ReferenceError: _nullishCoalesce is not defined` at runtime.
  let transpiled: string;
  try {
    transpiled = transform(`(async () => {\n${code}\n})()`, {
      transforms: ["typescript"],
      disableESTransforms: true,
    }).code;
    kernelLog.debug("run_code", `transpile ok → ${transpiled.length} chars`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    kernelLog.warn("run_code", `transpile failed: ${msg}`);
    return { error: `[transpile] ${msg}`, phase: "transpile", logs };
  }

  if (ABLETON_SONG_MISTAKE.test(code)) {
    return {
      error:
        `[runtime] \`ableton\` is the SDK namespace (classes/enums), not Live's object model — it has no \`.song\`. ` +
        `Use \`context.application.song\` or the \`song\` binding. search_knowledge for the Ableton SDK quickstart.`,
      phase: "runtime",
      logs,
    };
  }

  // 2. Build the executor with curated bindings + shadowed globals.
  const ac = new AbortController();

  // Pausable wall-clock timeout state (the timer is armed in step 3). UI dialogs
  // pause it via `gate` so the time the user spends in a confirm/progress dialog
  // doesn't count against the timeout.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = timeoutMs;
  let startedAt = 0;
  let fireTimeout: (e: TimeoutError) => void = () => {};
  const arm = () => {
    startedAt = Date.now();
    timer = setTimeout(() => {
      ac.abort();
      fireTimeout(new TimeoutError());
    }, Math.max(0, remaining));
  };
  const gate = {
    pause: () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        remaining -= Date.now() - startedAt;
        kernelLog.debug("run_code", `timeout paused (${remaining}ms remaining)`);
      }
    },
    resume: () => {
      if (timer === undefined) {
        kernelLog.debug("run_code", `timeout resumed (${remaining}ms remaining)`);
        arm();
      }
    },
  };

  // In-Live UI helpers (WP6 safety/UX): confirm dialogs + progress dialogs, each
  // pausing the timeout while open. The agent uses these to confirm destructive/
  // large actions and to show progress for long work.
  const logUiRejection = (label: string, e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    kernelLog.error(
      "ui",
      `${label} failed: ${msg}`,
      e instanceof Error ? e.stack : undefined,
    );
  };
  const withUiTimeout = <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const p = withPausedTimeout(gate, fn);
    void p.catch((e) => logUiRejection(label, e));
    return p;
  };
  const ui = {
    confirm: (opts: ConfirmOptions | string) =>
      withUiTimeout("confirm", () =>
        confirmDialog(ctx, typeof opts === "string" ? { summary: opts } : opts),
      ),
    progress: (
      text: string,
      cb: (update: (t: string, p?: number) => Promise<void>, signal: AbortSignal) => Promise<unknown>,
    ) => withUiTimeout("progress", () => progressDialog(ctx, text, cb)),
  };

  const pendingTx: Promise<unknown>[] = [];

  const bindings: Record<string, unknown> = {
    context: ctx,
    song: ctx.application.song,
    ableton: abletonForAgent,
    log,
    console: consoleShim,
    withinTransaction: <T>(fn: () => T): T => {
      const txResult = ctx.withinTransaction(fn);
      if (txResult instanceof Promise) pendingTx.push(txResult);
      return txResult;
    },
    sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    signal: ac.signal,
    ui,
    ir,
  };
  const names = [...Object.keys(bindings), ...SHADOWED];
  const values = [...Object.values(bindings), ...SHADOWED.map(() => undefined)];

  // Floating-rejection channel: rejections from promises the agent never awaited
  // are routed here by `claimAgentRejection` (wired to the process-level
  // `unhandledRejection` handler in extension.ts) and fail this execution instead
  // of vanishing into the host log while the client sees "ok".
  let fireFloating: (e: FloatingRejection) => void = () => {};
  const floatingPromise = new Promise<never>((_, reject) => {
    fireFloating = reject;
  });
  // The race observes it, but keep it from ever becoming unhandled itself.
  void floatingPromise.catch(() => {});
  const collector: RejectionCollector = (reason) => fireFloating(new FloatingRejection(reason));
  activeExecutions.push(collector);

  try {
    let codePromise: Promise<unknown>;
    try {
      const fn = new Function(...names, `"use strict";\nreturn ${transpiled};`) as (
        ...args: unknown[]
      ) => unknown;
      codePromise = Promise.resolve(fn(...values));
    } catch (e) {
      // new Function syntax error, or a synchronous throw before the first await.
      const msg = e instanceof Error ? e.message : String(e);
      kernelLog.warn("run_code", `sync runtime error: ${msg}`);
      return {
        error: `[runtime] ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`,
        phase: "runtime",
        logs,
      };
    }

    kernelLog.debug("run_code", `executing (timeout=${timeoutMs}ms, codeLen=${code.length})`);

    // 3. Bound awaited work by wall-clock time (+ cooperative AbortSignal). The timer
    //    is armed here; `ui` dialogs pause/resume it (see gate) so user think-time is
    //    excluded. (A *synchronous* infinite loop still can't be interrupted.)
    const timeoutPromise = new Promise<never>((_, reject) => {
      fireTimeout = reject;
    });
    arm();

    try {
      const result = await Promise.race([codePromise, timeoutPromise, floatingPromise]);
      await drainPendingTransactions(pendingTx);
      // Grace window: Node only reports an unawaited rejection after the microtask
      // queue drains, which is *after* codePromise resolved. Without this, the
      // classic `run()` (instead of `await run()`) mistake replies "ok" and the
      // error is lost.
      await Promise.race([settleTicks(2), floatingPromise]);
      kernelLog.debug("run_code", `completed${logs.length ? ` with ${logs.length} agent log line(s)` : ""}`);
      return { result, logs };
    } catch (e) {
      if (e instanceof TimeoutError) {
        kernelLog.warn("run_code", `timeout after ${timeoutMs}ms${logs.length ? ` (${logs.length} agent log line(s) captured)` : ""}`);
        return {
          error: `[timeout] execution exceeded ${timeoutMs}ms (awaited work may still be running)`,
          phase: "timeout",
          logs,
        };
      }
      if (e instanceof FloatingRejection) {
        const r = e.reason;
        const full = r instanceof Error ? `${r.message}\n${r.stack ?? ""}` : String(r);
        kernelLog.warn("run_code", `unawaited promise rejected: ${full.split("\n")[0]}`);
        return {
          error:
            `[runtime] unawaited promise rejected: ${full}\n` +
            `A promise created by your code rejected without being awaited — ` +
            `always await async work (e.g. \`return run()\` or \`await run()\`, not \`run()\`).`,
          phase: "runtime",
          logs,
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      kernelLog.warn("run_code", `async runtime error: ${msg}`);
      const full = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
      return { error: `[runtime] ${full}`, phase: "runtime", logs };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    const i = activeExecutions.indexOf(collector);
    if (i !== -1) activeExecutions.splice(i, 1);
  }
}
