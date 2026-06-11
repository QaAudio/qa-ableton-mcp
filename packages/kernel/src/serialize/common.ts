import * as ableton from "@ableton-extensions/sdk";
import type { RepresentationId } from "@quantumaudio/music-ir";
import type { ClipKind, DeviceType } from "@quantumaudio/ableton-mcp-schemas";

type Clip = ableton.Clip<"1.0.0">;
type Device = ableton.Device<"1.0.0">;
type DeviceParameter = ableton.DeviceParameter<"1.0.0">;

export const MAX_RACK_DEPTH = 2;
export const CONCISE_MAX_NOTES = 128;
export const CONCISE_MAX_ARRANGEMENT_CLIPS = 32;

/** getValue() can hang on some Live builds — bound each read so overview tools stay responsive. */
const PARAM_VALUE_TIMEOUT_MS = 3000;

/** concise (default) vs detailed — filtered here before the wire. Live e2e: TODOLLIST.md */
export type ResponseFormat = "concise" | "detailed";

export interface OverviewOptions {
  includeReturns?: boolean;
  includeMain?: boolean;
  includeDevices?: boolean;
  responseFormat?: ResponseFormat;
  representations?: RepresentationId[];
}

export interface ReadOptions {
  responseFormat?: ResponseFormat;
  /** When false, omit full device parameter trees (get_track only). Default true. */
  includeDevices?: boolean;
  representations?: RepresentationId[];
}

export function isDetailed(format?: ResponseFormat): boolean {
  return format === "detailed";
}

export function rackDepthLimit(format?: ResponseFormat): number {
  return isDetailed(format) ? MAX_RACK_DEPTH : 0;
}

export async function getParamValueSafe(p: DeviceParameter): Promise<number | null> {
  try {
    return await Promise.race([
      p.getValue(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("getValue timed out")), PARAM_VALUE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  }
}

export function deviceType(d: Device): DeviceType {
  if (d instanceof ableton.Simpler) return "Simpler";
  if (d instanceof ableton.DrumRack) return "DrumRack";
  if (d instanceof ableton.RackDevice) return "RackDevice";
  return "Device";
}

export function clipType(c: Clip): ClipKind {
  if (c instanceof ableton.MidiClip) return "midi";
  if (c instanceof ableton.AudioClip) return "audio";
  return "clip";
}
