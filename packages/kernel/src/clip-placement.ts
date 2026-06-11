/** Session vs Arrangement clip coverage — helps agents avoid "notes exist but piano roll is empty". */

import type { SerializedClipPlacement } from "@quantumaudio/ableton-mcp-schemas";

export type ClipPlacement = SerializedClipPlacement;
export type ClipPlacementStatus = ClipPlacement["status"];

export interface TrackPlacementInput {
  name: string;
  index: number;
  type: string;
  clipPlacement?: ClipPlacement;
}

export function clipPlacementFromSlots(
  sessionSlots: { hasClip: boolean; clip: { noteCount?: number } | null }[],
  arrangementClipCount: number,
): ClipPlacement {
  const sessionFilledSlots = sessionSlots.filter((s) => s.hasClip).length;
  let sessionNoteCount = 0;
  for (const s of sessionSlots) {
    if (s.clip && typeof s.clip.noteCount === "number") sessionNoteCount += s.clip.noteCount;
  }

  let status: ClipPlacementStatus = "empty";
  if (sessionFilledSlots > 0 && arrangementClipCount > 0) status = "both";
  else if (sessionFilledSlots > 0) status = "session_only";
  else if (arrangementClipCount > 0) status = "arrangement_only";

  return { sessionFilledSlots, sessionNoteCount, arrangementClipCount, status };
}

/** True when enough MIDI tracks use the Arrangement timeline that session-only clips are likely invisible to the user. */
export function isArrangementHeavySet(tracks: TrackPlacementInput[]): boolean {
  const midi = tracks.filter((t) => t.type === "midi");
  if (midi.length === 0) return false;
  const withArrangement = midi.filter((t) => (t.clipPlacement?.arrangementClipCount ?? 0) > 0).length;
  return withArrangement >= Math.max(2, Math.ceil(midi.length * 0.4));
}

export function buildPerceiveHints(tracks: TrackPlacementInput[]): string[] {
  if (!isArrangementHeavySet(tracks)) return [];

  const hints: string[] = [];
  for (const t of tracks) {
    if (t.type !== "midi") continue;
    const p = t.clipPlacement;
    if (!p || p.status !== "session_only" || p.sessionFilledSlots === 0) continue;
    hints.push(
      `Track "${t.name}" (index ${t.index}): ${p.sessionFilledSlots} Session clip(s), ${p.sessionNoteCount} notes — not visible in Arrangement piano roll. ` +
        `Create with track.createMidiClip(startBeat, length) in run_code, or duplicate Session clips onto the timeline. search_knowledge for the Ableton SDK quickstart (Session vs Arrangement section).`,
    );
  }
  return hints;
}
