// WP3 verification: spawn the MCP server over stdio and exercise it as an MCP client.
// Prereq: kernel running (Live Beta + Developer Mode + `npm run ableton-mcp:kernel:dev`)
// and `npm run build` done here. Run: node test-mcp.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const results = [];
const check = (name, cond, detail = "") => {
  results.push(!!cond);
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
};
const textOf = (r) => r?.content?.find((c) => c.type === "text")?.text ?? "";

const EXPECTED_TOOLS = [
  "ableton_run_code",
  "ableton_scan_context",
  "ableton_scan_track",
  "ableton_read_device",
  "ableton_read_clip_notes",
  "ableton_read_selection",
  "ableton_find_clip",
  "ableton_read_drum_rack_map",
  "ableton_remap_clip_notes",
  "ableton_render_audio",
];

const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"] });
const client = new Client({ name: "test-mcp", version: "1.0.0" });
await client.connect(transport);

try {
  const names = (await client.listTools()).tools.map((t) => t.name);
  check(
    "lists all 10 ableton_* tools",
    EXPECTED_TOOLS.every((n) => names.includes(n)) && names.filter((n) => n.startsWith("ableton_")).length === 10,
    names.join(", "),
  );

  const ctx = await client.callTool({ name: "ableton_scan_context", arguments: {} });
  let tempo;
  try {
    tempo = JSON.parse(textOf(ctx)).tempo;
  } catch {
    /* kernel offline or parse error */
  }
  const kernelOnline = !ctx.isError && typeof tempo === "number";
  if (kernelOnline) {
    check("ableton_scan_context returns the song", true, `tempo=${tempo}`);

    const rc = await client.callTool({
      name: "ableton_run_code",
      arguments: { code: "return context.application.song.tempo;" },
    });
    check("ableton_run_code returns a value", !rc.isError && /\d/.test(textOf(rc)), textOf(rc).split("\n")[0]);

    const err = await client.callTool({
      name: "ableton_run_code",
      arguments: { code: "throw new Error('boom');" },
    });
    check(
      "run_code error → isError + [runtime] phase",
      err.isError === true && /\[runtime\]/.test(textOf(err)),
      textOf(err).split("\n")[0],
    );
  } else {
    console.log("⚠️  kernel offline — skipping Live-dependent tool checks");
    check("ableton_scan_context (kernel offline)", ctx.isError === true, textOf(ctx).split("\n")[0]?.slice(0, 80));
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed${passed === results.length ? " ✅" : " ❌"}`);
} catch (e) {
  console.error("client error:", e);
} finally {
  await client.close();
}
