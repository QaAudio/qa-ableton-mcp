/** Structured console logging for the in-Live kernel. Set QA_KERNEL_DEBUG=1 for verbose traces. */

const PREFIX = "[kernel]";

type LogLevel = "debug" | "info" | "warn" | "error";

function debugEnabled(): boolean {
  const v = process.env.QA_KERNEL_DEBUG;
  return v === "1" || v === "true";
}

function write(level: LogLevel, scope: string, msg: string, detail?: unknown): void {
  if (level === "debug" && !debugEnabled()) return;
  const tag = scope ? `${PREFIX} ${scope}` : PREFIX;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (detail !== undefined) fn(tag, msg, detail);
  else fn(tag, msg);
}

export const kernelLog = {
  debug(scope: string, msg: string, detail?: unknown): void {
    write("debug", scope, msg, detail);
  },
  info(scope: string, msg: string, detail?: unknown): void {
    write("info", scope, msg, detail);
  },
  warn(scope: string, msg: string, detail?: unknown): void {
    write("warn", scope, msg, detail);
  },
  error(scope: string, msg: string, detail?: unknown): void {
    write("error", scope, msg, detail);
  },
};

/** Compact JSON for address objects in log lines. */
export function formatAddr(addr: unknown): string {
  if (addr === undefined || addr === null) return "?";
  try {
    return JSON.stringify(addr);
  } catch {
    return String(addr);
  }
}

/** One-line summary of RPC params — avoids dumping full run_code bodies. */
export function summarizeParams(method: string, params: Record<string, unknown>): string {
  switch (method) {
    case "run_code": {
      const code = String(params.code ?? "");
      const firstLine = code.split("\n").find((l) => l.trim()) ?? "";
      const preview = firstLine.slice(0, 72);
      const timeout = params.timeoutMs;
      return `codeLen=${code.length}${preview ? ` preview=${JSON.stringify(preview)}` : ""}${timeout !== undefined ? ` timeoutMs=${timeout}` : ""}`;
    }
    case "get_context": {
      const parts: string[] = [];
      if (params.responseFormat !== undefined) parts.push(`fmt=${params.responseFormat}`);
      if (params.includeReturns !== undefined) parts.push(`returns=${params.includeReturns}`);
      if (params.includeMain !== undefined) parts.push(`main=${params.includeMain}`);
      if (params.includeDevices !== undefined) parts.push(`devices=${params.includeDevices}`);
      return parts.length ? parts.join(" ") : "defaults";
    }
    case "get_track":
    case "get_device":
    case "get_clip_notes":
    case "get_drum_rack_map":
      return `addr=${formatAddr(params.addr)}${params.responseFormat ? ` fmt=${params.responseFormat}` : ""}`;
    case "find_clip":
      return `track=${params.track} name=${JSON.stringify(params.name)} view=${params.view ?? "both"}`;
    case "remap_clip_notes":
      return `scope=${params.scope} pitchMap=${Array.isArray(params.pitchMap) ? params.pitchMap.length : "?"}${params.addr ? ` addr=${formatAddr(params.addr)}` : params.track !== undefined ? ` track=${params.track}` : ""}`;
    case "render_audio":
      return `addr=${formatAddr(params.addr)} beats=${params.startBeat}–${params.endBeat}`;
    case "get_selection":
      return "(no params)";
    default:
      return Object.keys(params).length ? JSON.stringify(params).slice(0, 160) : "(none)";
  }
}

export function msSince(startMs: number): number {
  return Date.now() - startMs;
}
