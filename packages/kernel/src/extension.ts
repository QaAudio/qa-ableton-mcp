import * as ableton from "@ableton-extensions/sdk";
import { WebSocketServer, type WebSocket } from "ws";
import { type Request, type Response, jsonReplacer } from "./protocol.js";
import { handlers } from "./handlers.js";
import { registerSelectionMenus } from "./selection.js";
import { claimAgentRejection } from "./run.js";
import { kernelLog, msSince, summarizeParams } from "./log.js";

const HOST = "127.0.0.1";
const PORT = 17890;
const HANDLER_TIMEOUT_MS = 45000;
// Generous budget (~20s): a previous extension host / dev-run instance can take
// several seconds to release the port during restarts.
const BIND_RETRY_MS = 2000;
const BIND_MAX_RETRIES = 10;

type KernelGlobals = {
  __kernelWss?: WebSocketServer;
  __kernelOnUnhandledRejection?: (reason: unknown) => void;
  __kernelOnUncaughtMonitor?: (err: Error) => void;
};

function onUnhandledRejection(reason: unknown): void {
  const msg = reason instanceof Error ? reason.message : String(reason);
  // run_code first: rejections from agent promises that were never awaited get
  // reported back to the client as a runtime error rather than only logged here.
  if (claimAgentRejection(reason)) {
    kernelLog.warn("process", `unawaited agent promise rejected — routed to run_code client: ${msg}`);
    return;
  }
  kernelLog.error(
    "process",
    `unhandledRejection (kernel stays alive): ${msg}`,
    reason instanceof Error ? reason.stack : undefined,
  );
}

function onUncaughtMonitor(err: Error): void {
  kernelLog.error("process", `uncaughtException (host may terminate): ${err.message}`, err.stack);
}

/** Process listeners survive hot reloads — replace, never accumulate. */
function bindProcessListeners(): void {
  const g = globalThis as unknown as KernelGlobals;
  if (g.__kernelOnUnhandledRejection) process.off("unhandledRejection", g.__kernelOnUnhandledRejection);
  if (g.__kernelOnUncaughtMonitor) process.off("uncaughtExceptionMonitor", g.__kernelOnUncaughtMonitor);
  g.__kernelOnUnhandledRejection = onUnhandledRejection;
  g.__kernelOnUncaughtMonitor = onUncaughtMonitor;
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtExceptionMonitor", onUncaughtMonitor);
}

async function dispatch(
  ctx: ableton.ExtensionContext<"1.0.0">,
  req: Request,
): Promise<Response> {
  const handler = handlers[req.method];
  if (!handler) {
    kernelLog.warn("dispatch", `#${req.id} unknown method: ${req.method}`);
    return { id: req.id, ok: false, error: `Unknown method: ${req.method}` };
  }
  try {
    const hr = await handler(ctx, (req.params as Record<string, unknown>) ?? {});
    return { id: req.id, ok: !hr.error, result: hr.result, error: hr.error, phase: hr.phase, logs: hr.logs };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    kernelLog.error("dispatch", `#${req.id} ${req.method} threw: ${msg}`, e instanceof Error ? e.stack : undefined);
    return {
      id: req.id,
      ok: false,
      error: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
    };
  }
}

function dispatchWithTimeout(
  ctx: ableton.ExtensionContext<"1.0.0">,
  req: Request,
): Promise<Response> {
  return new Promise<Response>((resolve) => {
    let settled = false;
    // Cleared when the handler settles first — a leaked timer here used to log a
    // spurious "handler timeout" for *every* request, 45s after it succeeded.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      kernelLog.error("dispatch", `#${req.id} ${req.method} handler timeout (${HANDLER_TIMEOUT_MS}ms)`);
      resolve({
        id: req.id,
        ok: false,
        error: `Kernel handler '${req.method}' timed out after ${HANDLER_TIMEOUT_MS}ms`,
        phase: "timeout",
      });
    }, HANDLER_TIMEOUT_MS);

    dispatch(ctx, req)
      .catch((e: unknown): Response => {
        // dispatch() already catches handler errors; this is a last-resort net.
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
        kernelLog.error("dispatch", `#${req.id} ${req.method} dispatch itself failed: ${msg.split("\n")[0]}`);
        return { id: req.id, ok: false, error: msg };
      })
      .then((res) => {
        if (settled) {
          kernelLog.warn(
            "dispatch",
            `#${req.id} ${req.method} late result dropped (handler finished after the ${HANDLER_TIMEOUT_MS}ms timeout reply)`,
          );
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(res);
      });
  });
}

/**
 * Deliver a response, never throwing: a non-serialisable result (circular SDK
 * object, etc.) is downgraded to an explicit error response so the client
 * always hears back, and sends to an already-gone client are logged, not fatal.
 */
function sendResponse(socket: WebSocket, res: Response): void {
  let payload: string;
  try {
    payload = JSON.stringify(res, jsonReplacer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    kernelLog.error("ws", `#${res.id} response not serialisable: ${msg}`);
    payload = JSON.stringify({
      id: res.id,
      ok: false,
      error:
        `Kernel produced a result that could not be serialised to JSON (${msg}). ` +
        `Return plain data (numbers/strings/arrays/objects), not SDK objects.`,
      phase: "serialize",
      logs: res.logs?.filter((l) => typeof l === "string"),
    });
  }
  if (socket.readyState !== socket.OPEN) {
    kernelLog.warn("ws", `#${res.id} response dropped — client disconnected before delivery`);
    return;
  }
  socket.send(payload, (err) => {
    if (err) kernelLog.error("ws", `#${res.id} send failed: ${err.message}`);
  });
}

function bindWss(context: ableton.ExtensionContext<"1.0.0">, attempt = 0): void {
  const g = globalThis as unknown as KernelGlobals;
  const wss = new WebSocketServer({ host: HOST, port: PORT });
  g.__kernelWss = wss;

  wss.on("listening", () => kernelLog.info("ws", `listening on ${HOST}:${PORT}`));

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      if (g.__kernelWss === wss) g.__kernelWss = undefined;
      wss.close();
      // Hot reloads / dev-run restarts can race the old instance releasing the
      // port; retry before declaring a hard conflict.
      if (attempt < BIND_MAX_RETRIES) {
        kernelLog.warn(
          "ws",
          `port ${PORT} in use — retrying in ${BIND_RETRY_MS}ms (${attempt + 1}/${BIND_MAX_RETRIES})`,
        );
        setTimeout(() => bindWss(context, attempt + 1), BIND_RETRY_MS);
      } else {
        kernelLog.error(
          "ws",
          `port ${PORT} already in use after ${BIND_MAX_RETRIES} retries — quit other kernel instances (dev-run + installed .ablx) and restart Live`,
        );
      }
    } else {
      kernelLog.error("ws", "server error", err);
    }
  });

  wss.on("connection", (socket: WebSocket) => {
    kernelLog.info("ws", "client connected");
    // Without this, a socket error (e.g. ECONNRESET) is an unhandled 'error'
    // event and would take down the extension host.
    socket.on("error", (err) => kernelLog.warn("ws", `socket error: ${err.message}`));
    socket.on("message", async (data) => {
      const raw = data.toString();
      let req: Request;
      try {
        req = JSON.parse(raw) as Request;
      } catch {
        kernelLog.warn("ws", "invalid JSON request", raw.slice(0, 120));
        sendResponse(socket, { id: -1, ok: false, error: "Invalid JSON" });
        return;
      }

      try {
        const params = (req.params as Record<string, unknown>) ?? {};
        const t0 = Date.now();
        kernelLog.info("req", `#${req.id} ${req.method} — ${summarizeParams(req.method, params)}`);

        const res = await dispatchWithTimeout(context, req);
        const dur = msSince(t0);

        if (res.ok) {
          const extras: string[] = [`${dur}ms`];
          if (res.logs?.length) extras.push(`agentLogs=${res.logs.length}`);
          kernelLog.info("res", `#${req.id} ${req.method} ok (${extras.join(", ")})`);
          if (res.logs?.length) kernelLog.debug("res", `#${req.id} agent logs`, res.logs);
        } else {
          const head = res.error?.split("\n")[0] ?? "unknown error";
          kernelLog.warn("res", `#${req.id} ${req.method} FAIL (${dur}ms) phase=${res.phase ?? "-"} — ${head}`);
          if (res.logs?.length) kernelLog.debug("res", `#${req.id} agent logs`, res.logs);
          if (res.error && res.error.includes("\n")) {
            kernelLog.debug("res", `#${req.id} stack`, res.error);
          }
        }

        sendResponse(socket, res);
      } catch (e) {
        // Belt-and-braces: nothing above should throw, but if it does the client
        // must still get an answer instead of an unhandledRejection + silence.
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
        kernelLog.error("ws", `#${req.id} request handling failed: ${msg.split("\n")[0]}`);
        sendResponse(socket, { id: req.id, ok: false, error: `Kernel internal error: ${msg}` });
      }
    });
    socket.on("close", () => kernelLog.info("ws", "client disconnected"));
  });
}

export function activate(activation: ableton.ActivationContext) {
  const context = ableton.initialize(activation, "1.0.0");

  kernelLog.info("lifecycle", "activating …");
  bindProcessListeners();
  registerSelectionMenus(context);

  const g = globalThis as unknown as KernelGlobals;
  const previous = g.__kernelWss;
  if (previous) {
    kernelLog.info("lifecycle", "rebind WS (hot reload)");
    g.__kernelWss = undefined;
    previous.close(() => bindWss(context));
  } else {
    bindWss(context);
  }

  kernelLog.info("lifecycle", "activated");
}
