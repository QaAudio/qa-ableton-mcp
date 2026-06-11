export const ADDR_HINT =
  "Use a valid addr from ableton_scan_context. Shapes: {kind:'track',index:0}, " +
  "{kind:'device',track:0,index:1}, {kind:'clipSlot',track:0,slot:1}, " +
  "{kind:'arrangementClip',track:0,index:0}. Drum Rack: device addr (type DrumRack), not bare track index.";

/**
 * Steer MCP output-schema validation failures (kernel payload vs declared outputSchema).
 */
export function steerOutputSchemaMismatch(issues: string): string {
  return (
    "Structured output validation failed — kernel payload did not match the declared MCP outputSchema.\n\n" +
    "Issues:\n" +
    issues +
    "\n\nNext: use responseFormat:'concise' (default), set includeDevices:false on scan_track/scan_context, " +
    "or read narrower objects (read_clip_notes per clip, read_device for one device). " +
    "Raw payload is in the tool text below; report persistent mismatches as a schema bug."
  );
}

/**
 * Steer MCP input validation (-32602) failures — schema rejects before the kernel runs.
 */
export function steerInputValidationError(toolName: string, detail: string): string {
  const lower = detail.toLowerCase();
  const base = `Invalid arguments for tool ${toolName}: ${detail}`;

  if (lower.includes('"addr"') && (lower.includes("undefined") || lower.includes("expected object"))) {
    return (
      `${base}\n\nNext: wrap parameters in addr — e.g. read_drum_rack_map requires ` +
      `{addr:{kind:'device',track:N,index:D}} from scan_context devices[] (DrumRack), not track:N. ` +
      `${ADDR_HINT} Fix args and retry this tool.`
    );
  }

  if (lower.includes("address") || lower.includes("addr")) {
    return `${base}\n\nNext: ${ADDR_HINT} Fix args and retry ${toolName}.`;
  }

  return `${base}\n\nNext: read this tool's input schema, fix arguments, and retry. Use run_code only for mutations.`;
}

/**
 * Append a concrete next action to kernel/MCP error bodies so agents can recover
 * without guessing. Specced in docs/phases/phase-0/04-harden-core-tools.md §B.
 */
export function steerKernelError(
  error: string,
  phase?: string,
  opts?: { truncated?: boolean },
): string {
  if (opts?.truncated) {
    return (
      `${error}\n\nNext: retry with responseFormat:'concise' (default), set includeDevices:false on scan_track/scan_context, ` +
      `or read narrower objects (read_clip_notes, read_device).`
    );
  }

  const lower = error.toLowerCase();

  if (phase === "transpile") {
    return (
      `${error}\n\nNext: fix TypeScript syntax/types. search_knowledge for the Ableton SDK quickstart and ` +
      `cheatsheet — no import statements; bindings are context, ableton, log, withinTransaction, sleep, signal, ui.`
    );
  }

  if (phase === "timeout") {
    return (
      `${error}\n\nNext: split into smaller run_code batches, wrap long work in ui.progress, ` +
      `or raise timeoutMs (max 120000). Avoid synchronous infinite loops — they cannot be interrupted.`
    );
  }

  if (lower.includes("not a midi track")) {
    return `${error}\n\nNext: pick a track with type "midi" from ableton_scan_context, or create one with run_code: await song.createMidiTrack(). search_knowledge for the Ableton SDK recipes.`;
  }

  if (lower.includes("not a drum rack")) {
    return `${error}\n\nNext: pass a device addr whose type is DrumRack from ableton_scan_context, or insert one with ableton_run_code (track.insertDevice('Drum Rack', 0)).`;
  }

  if (lower.includes("multiple midi clips named")) {
    return (
      `${error}\n\nNext: rename clips for uniqueness, pass view:'session' or view:'arrangement', or use addr from scan_track. ` +
      `search_knowledge for the Ableton SDK quickstart (Session vs Arrangement).`
    );
  }

  if (lower.includes("no midi clip named")) {
    return `${error}\n\nNext: verify the exact clip name via ableton_scan_track or ableton_find_clip.`;
  }

  if (lower.includes("pitchmap")) {
    return `${error}\n\nNext: pitchMap must be [{from,to},…] with unique from pitches 0–127. Build from ableton_read_drum_rack_map receivingNote values.`;
  }

  if (lower.includes("no clip in slot") || lower.includes("run_code first")) {
    return `${error}\n\nNext: create a clip with run_code (track.clipSlots[i].createMidiClip(length) or track.createMidiClip(start, length)), or pick an occupied slot from scan_context clipSlots.`;
  }

  if (lower.includes("notes[") && lower.includes("must be")) {
    return `${error}\n\nNext: fix the notes array — pitch 0–127, startTime ≥ 0, duration > 0 (beats). search_knowledge for NoteDescription in the Ableton SDK cheatsheet.`;
  }

  if (
    lower.includes("requires a track address") ||
    lower.includes("requires a device address") ||
    lower.includes("no clip at the given address") ||
    lower.includes("did not resolve") ||
    lower.includes("address")
  ) {
    return `${error}\n\nNext: ${ADDR_HINT}`;
  }

  if (lower.includes("render_audio requires an audio track")) {
    return `${error}\n\nNext: pass an audio track addr {kind:'track',index:N} from ableton_scan_context.`;
  }

  if (lower.includes("kernel not reachable") || lower.includes("connection closed")) {
    return (
      `${error}\n\nNext: open Live (Extensions → Developer Mode), then from repo root run ` +
      `npm run ableton-mcp:kernel:dev and reload MCP servers.`
    );
  }

  if (phase === "runtime") {
    return (
      `${error}\n\nNext: check the error message, correlate with the Ableton SDK recipes and cheatsheet (search_knowledge), ` +
      `confirm destructive edits with ui.confirm before retrying run_code.`
    );
  }

  return error;
}
