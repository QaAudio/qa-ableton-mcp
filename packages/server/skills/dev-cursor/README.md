# Dev skills (Cursor parity)

Keyword-triggered skills for QuantumAgent when the task is extension, MCP, or
monorepo work — same content as [`.cursor/skills/`](../../../../.cursor/skills/).

Each entry is a **directory junction** (Windows) to the matching Cursor skill
folder. After clone on a new machine, recreate them from repo root:

```powershell
$dev = "apps/qa-ableton-mcp/skills/dev-cursor"
$cursor = ".cursor/skills"
foreach ($name in @("live-sdk-context","ableton-extension-dev","ableton-mcp-dev","quantumaudio-dev")) {
  $link = Join-Path $dev $name
  if (Test-Path $link) { Remove-Item $link -Force -Recurse }
  cmd /c mklink /J "$link" "$cursor\$name"
}
```

On macOS/Linux, use symlinks instead:

```bash
dev=apps/qa-ableton-mcp/skills/dev-cursor
cursor=.cursor/skills
for name in live-sdk-context ableton-extension-dev ableton-mcp-dev quantumaudio-dev; do
  ln -sfn "../../../../$cursor/$name" "$dev/$name"
done
```

Loaded when `dev-cursor` is listed in QuantumAgent `skills.directories`
(see `apps/quantum-agent/config/agents.json`).
