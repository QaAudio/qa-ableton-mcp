import type { z } from "zod";
import { kernel } from "./kernel-client.js";
import { steerKernelError } from "./tool-errors.js";
import { toToolResult } from "./tool-result.js";

/** Forwards one kernel RPC and converts the response to an MCP tool result. */
export async function proxy(method: string, params?: unknown, schema?: z.ZodType) {
  try {
    const resp = await kernel.call(method, params);
    return toToolResult(resp, schema);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: "text" as const, text: steerKernelError(msg) }],
      isError: true,
    };
  }
}
