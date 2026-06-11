import * as ableton from "@ableton-extensions/sdk";
import type { SerializedClip } from "@quantumaudio/ableton-mcp-schemas";
import { CONCISE_MAX_NOTES, clipType, isDetailed, type ResponseFormat } from "./common.js";

type Clip = ableton.Clip<"1.0.0">;

/** Live may return clip.color as string; MCP schemas expect a number. */
export function coerceClipColor(color: unknown): number | undefined {
  if (typeof color === "number" && Number.isFinite(color)) return color;
  if (typeof color === "string") {
    const n = Number(color);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function warpModeName(w: number): string {
  const name = (ableton.WarpMode as unknown as Record<number, string>)[w];
  return name ?? String(w);
}

/** Cheap, sync clip summary (note count is a sync getter, so it is included). */
export function serializeClipSummary(clip: Clip, format?: ResponseFormat): SerializedClip {
  const detailed = isDetailed(format);
  const base: SerializedClip = {
    name: clip.name,
    type: clipType(clip),
    startTime: clip.startTime,
    endTime: clip.endTime,
    duration: clip.duration,
    looping: clip.looping,
    muted: clip.muted,
  };
  if (detailed) {
    base.loopStart = clip.loopStart;
    base.loopEnd = clip.loopEnd;
    const color = coerceClipColor(clip.color);
    if (color !== undefined) base.color = color;
  }
  if (clip instanceof ableton.MidiClip) {
    return { ...base, noteCount: clip.notes.length };
  }
  if (clip instanceof ableton.AudioClip) {
    const audio: SerializedClip = {
      ...base,
      warping: clip.warping,
      warpMode: warpModeName(clip.warpMode),
    };
    if (detailed) audio.filePath = clip.filePath;
    return audio;
  }
  return base;
}

/** Full clip detail: summary + MIDI notes, or audio warp markers. */
export function serializeClipFull(clip: Clip, format?: ResponseFormat): SerializedClip {
  const summary = serializeClipSummary(clip, format);
  if (clip instanceof ableton.MidiClip) {
    const notes = clip.notes;
    if (!isDetailed(format) && notes.length > CONCISE_MAX_NOTES) {
      return {
        ...summary,
        notes: notes.slice(0, CONCISE_MAX_NOTES),
        notesTruncated: true,
        totalNoteCount: notes.length,
      };
    }
    return { ...summary, notes };
  }
  if (clip instanceof ableton.AudioClip) {
    if (!isDetailed(format)) return summary;
    return { ...summary, warpMarkers: clip.warpMarkers };
  }
  return summary;
}
