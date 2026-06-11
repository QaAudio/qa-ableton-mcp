import * as ableton from "@ableton-extensions/sdk";
import type {
  Address,
  SerializedAuxTrack,
  SerializedTrackFull,
  SerializedTrackOverview,
} from "@quantumaudio/ableton-mcp-schemas";
import type { Ctx } from "../protocol.js";
import { findTrackIndex } from "../address.js";
import { clipPlacementFromSlots } from "../clip-placement.js";
import { serializeClipFull, serializeClipSummary } from "./clip.js";
import { serializeDeviceFull, serializeDeviceSummaries, serializeMixer } from "./device.js";
import {
  CONCISE_MAX_ARRANGEMENT_CLIPS,
  deviceType,
  isDetailed,
  type OverviewOptions,
  type ReadOptions,
} from "./common.js";

type Track = ableton.Track<"1.0.0">;

export async function serializeTrackOverview(
  ctx: Ctx,
  track: Track,
  index: number,
  opts: OverviewOptions,
): Promise<SerializedTrackOverview> {
  const format = opts.responseFormat;
  const group = track.groupTrack ? findTrackIndex(ctx, track.groupTrack) : null;
  const clipSlots = track.clipSlots.map((slot, s) => {
    const c = slot.clip;
    return { slot: s, hasClip: !!c, clip: c ? serializeClipSummary(c, format) : null };
  });
  const devices =
    opts.includeDevices === false
      ? undefined
      : track.devices.map((d, di) => ({
          index: di,
          name: d.name,
          type: deviceType(d),
          paramCount: d.parameters.length,
          addr: { kind: "device" as const, track: index, index: di },
        }));
  const arrangementClipCount = track.arrangementClips.length;
  const clipPlacement = clipPlacementFromSlots(clipSlots, arrangementClipCount);
  const overview: SerializedTrackOverview = {
    addr: { kind: "track", index, name: track.name },
    index,
    name: track.name,
    type: track instanceof ableton.MidiTrack ? "midi" : track instanceof ableton.AudioTrack ? "audio" : "other",
    mute: track.mute,
    solo: track.solo,
    arm: track.arm,
    groupTrackIndex: group,
    mixer: await serializeMixer(track.mixer),
    clipSlots,
    arrangementClipCount,
    clipPlacement,
    devices,
  };
  if (isDetailed(format)) overview.mutedViaSolo = track.mutedViaSolo;
  return overview;
}

/** Light serialization for return/main tracks (no per-device addressing in WP1). */
export async function serializeAuxTrack(
  track: Track,
  addr: Extract<Address, { kind: "returnTrack" } | { kind: "mainTrack" }>,
): Promise<SerializedAuxTrack> {
  return {
    addr,
    name: track.name,
    mute: track.mute,
    solo: track.solo,
    mixer: await serializeMixer(track.mixer),
    deviceNames: track.devices.map((d) => d.name),
  };
}

export async function serializeTrackFull(
  ctx: Ctx,
  track: Track,
  index: number,
  opts: ReadOptions = {},
): Promise<SerializedTrackFull> {
  const format = opts.responseFormat;
  const detailed = isDetailed(format);
  const includeDevices = opts.includeDevices !== false;
  const overview = await serializeTrackOverview(ctx, track, index, {
    includeDevices,
    responseFormat: format,
  });
  const sessionClips = track.clipSlots.map((slot, s) => {
    const c = slot.clip;
    return {
      slot: s,
      clip: c ? (detailed ? serializeClipFull(c, format) : serializeClipSummary(c, format)) : null,
    };
  });
  const arrangementSource = track.arrangementClips;
  const arrangementSlice = detailed ? arrangementSource : arrangementSource.slice(0, CONCISE_MAX_ARRANGEMENT_CLIPS);
  const arrangementClips = arrangementSlice.map((c, i) => ({
    index: i,
    clip: detailed ? serializeClipFull(c, format) : serializeClipSummary(c, format),
  }));
  const arrangementTruncated =
    !detailed && arrangementSource.length > CONCISE_MAX_ARRANGEMENT_CLIPS
      ? { arrangementTruncated: true, totalArrangementClips: arrangementSource.length }
      : {};
  const takeLanes = detailed
    ? track.takeLanes.map((lane, i) => ({
        index: i,
        name: lane.name,
        clips: lane.clips.map((c) => serializeClipFull(c, format)),
      }))
    : undefined;
  const devices = includeDevices
    ? await Promise.all(
        track.devices.map((d, di) =>
          serializeDeviceFull(d, { kind: "device", track: index, index: di }, 0, format),
        ),
      )
    : serializeDeviceSummaries(track, index);
  return { ...overview, sessionClips, arrangementClips, ...arrangementTruncated, takeLanes, devices };
}
