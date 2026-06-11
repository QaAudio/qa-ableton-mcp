#!/usr/bin/env node

/**
 * qa-ableton-mcp — bridges a coding agent (Cursor, Claude Code, etc.) to the
 * in-Live Ableton kernel over MCP (stdio). Thin, stateless proxy: each tool call
 * → one kernel WebSocket request. The kernel owns resolution/serialization/exec.
 *
 * stdio rule: NEVER write to stdout (it is the MCP channel). Log via console.error.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KERNEL_URL } from "./constants.js";
import { registerTools } from "./tools.js";

/** MCP server instructions — workflow summary shown to agents at connect time. */
export const INSTRUCTIONS = `Drive Ableton Live via the in-Live kernel as ableton extension (rely on ableton extensionsSDK).
**IMPORTANT** The Ableton Extensions SDK guides and reference live in the QuantumAgent knowledge base. Use the qa-knowledge MCP \`search_knowledge\` (and \`get_knowledge_chunk\`) tools to look them up — quickstart and recipes before your first \`ableton_run_code\`, the cheatsheet for the run_code API, and the full SDK types as the source of truth.
`;

const server = new McpServer(
  { name: "qa-ableton-mcp", version: "1.0.0" },
  { instructions: INSTRUCTIONS },
);

registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[qa-ableton-mcp] running on stdio; kernel = ${KERNEL_URL}`);
}

main().catch((e) => {
  console.error("[qa-ableton-mcp] fatal:", e);
  process.exit(1);
});
