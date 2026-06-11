import { kernel } from "../src/kernel-client.js";
import { getTrackOutputSchema } from "@quantumaudio/ableton-mcp-schemas";
import { toToolResult } from "../src/tool-result.js";

async function check(trackIndex: number, params: Record<string, unknown> = {}) {
  const resp = await kernel.call("get_track", {
    addr: { kind: "track", index: trackIndex },
    responseFormat: "detailed",
    ...params,
  });
  const out = toToolResult(resp, getTrackOutputSchema);
  console.log(`\n=== Track ${trackIndex} ${JSON.stringify(params)} ===`);
  console.log("kernel ok:", resp.ok);
  console.log("structuredContent:", out.structuredContent ? "YES" : "NO");
  console.log("isError:", out.isError ?? false);
  const text = out.content[0]?.text ?? "";
  if (text.includes("[outputSchema mismatch]")) {
    const issues = text.split("Issues:")[1]?.split("--- raw payload ---")[0]?.trim();
    console.log("Schema issues:\n", issues);
  } else if (text.includes("[truncated]")) {
    console.log("Text truncated at", text.length, "chars");
  } else {
    console.log("Text length:", text.length);
  }
}

for (const i of [0, 1, 2]) {
  await check(i);
}
await check(1, { includeDevices: false });
