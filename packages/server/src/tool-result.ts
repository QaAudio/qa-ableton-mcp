import type { z } from "zod";
import type { KernelResponse } from "./kernel-client.js";
import { CHARACTER_LIMIT } from "./constants.js";
import { steerKernelError, steerOutputSchemaMismatch } from "./tool-errors.js";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const REPR_LABELS: Record<string, string> = {
  notation: "notation",
  drumGrid: "drum-grid",
  harmony: "harmony",
  pianoRoll: "piano-roll",
  structure: "structure",
};

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)";
      return `  - ${path}: ${i.message}`;
    })
    .join("\n");
}

function collectRepresentations(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const merged: Record<string, string> = {};
  const top = value.representations;
  if (isPlainObject(top)) {
    for (const [k, v] of Object.entries(top)) {
      if (typeof v === "string") merged[k] = v;
    }
  }
  const clip = value.clip;
  if (isPlainObject(clip) && isPlainObject(clip.representations)) {
    for (const [k, v] of Object.entries(clip.representations)) {
      if (typeof v === "string") merged[k] = v;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function renderRepresentationSections(reprs: Record<string, string>): string {
  const parts: string[] = ["--- intermediate representations ---"];
  for (const [key, text] of Object.entries(reprs)) {
    const label = REPR_LABELS[key] ?? key;
    parts.push(`\n### ${label}\n\`\`\`\n${text}\n\`\`\``);
  }
  return parts.join("");
}

function payloadForJson(value: unknown, reprs?: Record<string, string>): unknown {
  if (!reprs || !isPlainObject(value)) return value;
  const clone = { ...value };
  delete clone.representations;
  if (isPlainObject(clone.clip)) {
    const clip = { ...clone.clip };
    delete clip.representations;
    clone.clip = clip;
  }
  return clone;
}

function stringifyPayload(value: unknown, reprs?: Record<string, string>): { text: string; truncated: boolean } {
  const jsonPart = JSON.stringify(payloadForJson(value, reprs) ?? null, null, 2);
  const reprPart = reprs ? renderRepresentationSections(reprs) : "";
  let text = reprPart ? `${reprPart}\n\n--- sdk json ---\n${jsonPart}` : jsonPart;
  if (text.length <= CHARACTER_LIMIT) return { text, truncated: false };
  if (reprPart) {
    const budget = CHARACTER_LIMIT - reprPart.length - 40;
    const trimmed = budget > 200 ? jsonPart.slice(0, budget) + "\n…(sdk json truncated)" : "";
    text = reprPart + (trimmed ? `\n\n--- sdk json ---\n${trimmed}` : "");
    if (text.length <= CHARACTER_LIMIT) return { text, truncated: true };
  }
  return { text: text.slice(0, CHARACTER_LIMIT), truncated: true };
}

/**
 * Converts a kernel response into an MCP tool result.
 * When `schema` is provided, validates `resp.result` before setting `structuredContent`.
 * On mismatch, omits structuredContent (avoids client -32602) but still returns the raw payload.
 */
export function toToolResult(resp: KernelResponse, schema?: z.ZodType): ToolResult {
  const logs = resp.logs?.length ? `\n\n--- logs ---\n${resp.logs.join("\n")}` : "";
  if (!resp.ok) {
    const phase = resp.phase;
    const steered = steerKernelError(resp.error ?? "unknown kernel error", phase);
    const phaseTag = phase ? ` [${phase}]` : "";
    return {
      content: [{ type: "text" as const, text: `Error${phaseTag}: ${steered}${logs}` }],
      isError: true,
    };
  }

  const result = resp.result;
  const reprs = collectRepresentations(result);
  if (schema && isPlainObject(result)) {
    const parsed = schema.safeParse(result);
    if (parsed.success) {
      const { text, truncated } = stringifyPayload(parsed.data, reprs);
      const note = truncated
        ? `\n\n${steerKernelError("[truncated]", undefined, { truncated: true })}`
        : "";
      return {
        content: [{ type: "text" as const, text: text + logs + note }],
        structuredContent: parsed.data as Record<string, unknown>,
      };
    }

    const { text: rawText, truncated } = stringifyPayload(result, reprs);
    const truncNote = truncated
      ? `\n\n${steerKernelError("[truncated]", undefined, { truncated: true })}`
      : "";
    const warning = [
      "[outputSchema mismatch]",
      steerOutputSchemaMismatch(formatZodIssues(parsed.error.issues)),
      "",
      "--- raw payload ---",
      rawText,
    ].join("\n");

    return {
      content: [{ type: "text" as const, text: warning + logs + truncNote }],
      isError: true,
    };
  }

  const { text, truncated } = stringifyPayload(result, reprs);
  const note = truncated ? `\n\n${steerKernelError("[truncated]", undefined, { truncated: true })}` : "";
  const out: ToolResult = { content: [{ type: "text" as const, text: text + logs + note }] };
  if (isPlainObject(result)) out.structuredContent = result;
  return out;
}
