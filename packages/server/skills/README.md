# qa-ableton-mcp skills

Canonical skill content for the Ableton MCP agent. Register with Cursor from repo root:

```bash
npm run ableton-mcp:register
```

The root [`SKILL.md`](SKILL.md) (`ableton-mcp`) is the Cursor umbrella index only. QuantumAgent loads subset directories from `apps/quantum-agent/config/` — not the skills root.

## Subsets

| Subset | Path | When to use |
|--------|------|-------------|
| **dev-cursor** | [`dev-cursor/SKILL.md`](dev-cursor/SKILL.md) | Developing QuantumAudio extensions — read-only MCP perception |
| **music-producer** | [`../../../docs/knowledge/skills/music-producer/SKILL.md`](../../../docs/knowledge/skills/music-producer/SKILL.md) | Music production tasks in Live — MIDI, mixing, sound design, playbooks (now in the shared knowledge base) |
