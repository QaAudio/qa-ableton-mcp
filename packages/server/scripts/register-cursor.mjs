#!/usr/bin/env node
/**
 * Register qa-ableton-mcp with Cursor: merge MCP server into .cursor/mcp.json
 * and junction/symlink music-producer skills into .cursor/skills/.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(appDir, "../..");
const cursorDir = path.join(repoRoot, ".cursor");
const mcpJsonPath = path.join(cursorDir, "mcp.json");
const cursorSkillsDir = path.join(cursorDir, "skills");
const skillsRootDir = path.join(appDir, "skills");
// music-producer skills live in the shared knowledge base (docs/knowledge/skills).
const musicProducerDir = path.join(repoRoot, "docs", "knowledge", "skills", "music-producer");
const mcpEntryPath = "apps/qa-ableton-mcp/dist/index.js";
const knowledgeMcpEntryPath = "apps/qa-knowledge-mcp/dist/index.js";

function readJson(filePath) {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function linkSkill(name, target) {
  const linkPath = path.join(cursorSkillsDir, name);
  const relativeTarget = path.relative(path.dirname(linkPath), target);

  // lstat (not existsSync): a broken junction "exists" as a link but its
  // target does not, and existsSync follows the link.
  const stat = lstatSync(linkPath, { throwIfNoEntry: false });
  if (stat) {
    if (stat.isSymbolicLink() || stat.isDirectory()) {
      rmSync(linkPath, { recursive: true, force: true });
    } else {
      rmSync(linkPath, { force: true });
    }
  }

  mkdirSync(cursorSkillsDir, { recursive: true });

  if (process.platform === "win32") {
    execFileSync("cmd.exe", ["/c", "mklink", "/J", linkPath, target], {
      stdio: "inherit",
    });
    return;
  }

  symlinkSync(relativeTarget, linkPath, "dir");
}

function registerMcp() {
  const mcpJson = readJson(mcpJsonPath);
  mcpJson.mcpServers ??= {};
  mcpJson.mcpServers["qa-ableton-mcp"] = {
    command: "node",
    args: [mcpEntryPath],
  };
  mcpJson.mcpServers["qa-knowledge-mcp"] = {
    command: "node",
    args: [knowledgeMcpEntryPath],
    env: {
      QDRANT_URL: "http://127.0.0.1:6333",
      EMBEDDING_PROVIDER: "openrouter",
      EMBEDDING_MODEL: "openai/text-embedding-3-small",
      EMBEDDING_DIMENSIONS: "1536",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    },
  };
  writeJson(mcpJsonPath, mcpJson);
  console.log(`Updated ${path.relative(repoRoot, mcpJsonPath)}`);
}

function registerSkills() {
  if (!existsSync(musicProducerDir)) {
    console.warn("No music-producer skills directory found — skipping skill links.");
    return;
  }

  const entries = readdirSync(musicProducerDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = path.join(musicProducerDir, entry.name);
    linkSkill(entry.name, source);
    console.log(`Linked .cursor/skills/${entry.name} → ${path.relative(repoRoot, source)}`);
  }

  const manifestSource = path.join(musicProducerDir, "SKILL.md");
  if (existsSync(manifestSource)) {
    linkSkill("ableton-music-producer", musicProducerDir);
    console.log(
      `Linked .cursor/skills/ableton-music-producer → ${path.relative(repoRoot, musicProducerDir)}`,
    );
  }

  // Umbrella index skill lives at the skills root (apps/qa-ableton-mcp/skills/SKILL.md).
  // Cursor reads .cursor/skills/ableton-mcp/SKILL.md; nested subset dirs are ignored (non-recursive).
  if (existsSync(path.join(skillsRootDir, "SKILL.md"))) {
    linkSkill("ableton-mcp", skillsRootDir);
    console.log(`Linked .cursor/skills/ableton-mcp → ${path.relative(repoRoot, skillsRootDir)}`);
  }
}

registerMcp();
registerSkills();

console.log("\nNext steps:");
console.log("  1. npm run ableton-mcp:kernel:build && npm run ableton-mcp:build");
console.log("  2. npm run knowledge:build");
console.log("  3. npm run ableton-mcp:kernel:dev   (kernel in Live on ws://127.0.0.1:17890)");
console.log("  4. Reload MCP servers in Cursor");
