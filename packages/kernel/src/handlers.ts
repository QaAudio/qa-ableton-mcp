import * as ableton from "@ableton-extensions/sdk";
import { type Handler } from "./protocol.js";
import { type Address, resolveAddress, findTrackIndex } from "./address.js";
import {
  serializeSongOverview,
  serializeTrackFull,
  serializeDeviceFull,
  serializeClipFull,
  type OverviewOptions,
  type ReadOptions,
  type ResponseFormat,
} from "./serialize/index.js";
import { getSelection } from "./selection.js";
import { runCode } from "./run.js";
import { findClip, remapClipNotes, buildPitchSummary, type FindClipParams, type RemapClipNotesParams } from "./clips.js";
import { getDrumRackMap, type GetDrumRackMapParams } from "./drum-rack.js";
import { kernelLog, formatAddr } from "./log.js";
import {
  attachClipRepresentations,
  attachStructureRepresentations,
  findDrumPadMap,
  musicalContextFromSong,
  parseRepresentationIds,
  songContext,
  structureTracksFromOverview,
  structureTracksFromTrackFull,
} from "./representations.js";

function readOpts(params: Record<string, unknown>): ReadOptions {
  const fmt = params.responseFormat;
  return {
    responseFormat: fmt === "detailed" ? "detailed" : "concise",
    representations: parseRepresentationIds(params.representations),
  };
}

function trackReadOpts(params: Record<string, unknown>): ReadOptions {
  const fmt = params.responseFormat;
  return {
    responseFormat: fmt === "detailed" ? "detailed" : "concise",
    includeDevices: params.includeDevices as boolean | undefined,
    representations: parseRepresentationIds(params.representations),
  };
}

function overviewOpts(params: Record<string, unknown>): OverviewOptions {
  const fmt = params.responseFormat;
  return {
    includeReturns: params.includeReturns as boolean | undefined,
    includeMain: params.includeMain as boolean | undefined,
    includeDevices: params.includeDevices as boolean | undefined,
    responseFormat: (fmt === "detailed" ? "detailed" : "concise") as ResponseFormat,
    representations: parseRepresentationIds(params.representations),
  };
}
export const handlers: Record<string, Handler> = {
  async get_context(ctx, params) {
    const opts = overviewOpts(params);
    const result = await serializeSongOverview(ctx, opts);
    if (opts.representations?.length) {
      attachStructureRepresentations(result, structureTracksFromOverview(result), songContext(ctx), opts.representations);
    }
    kernelLog.debug("get_context", `tempo=${result.tempo} tracks=${result.trackCount} fmt=${opts.responseFormat ?? "concise"}`);
    return { result };
  },

  async get_track(ctx, params) {
    const addr = params.addr as Address;
    kernelLog.debug("get_track", formatAddr(addr));
    const obj = resolveAddress(ctx, addr);
    if (!(obj instanceof ableton.Track)) throw new Error("get_track requires a track address");
    const index = addr.kind === "track" ? addr.index : (findTrackIndex(ctx, obj) ?? 0);
    const opts = trackReadOpts(params);
    const result = await serializeTrackFull(ctx, obj, index, opts);
    if (opts.representations?.length) {
      attachStructureRepresentations(result, structureTracksFromTrackFull(result), songContext(ctx), opts.representations);
    }
    return { result };
  },

  async get_device(ctx, params) {
    const addr = params.addr as Address;
    if (addr?.kind !== "device") throw new Error("get_device requires a device address");
    const obj = resolveAddress(ctx, addr);
    if (!(obj instanceof ableton.Device)) throw new Error("address did not resolve to a device");
    return { result: await serializeDeviceFull(obj, addr, 0, readOpts(params).responseFormat) };
  },

  get_clip_notes(ctx, params) {
    const addr = params.addr as Address;
    const obj = resolveAddress(ctx, addr);
    let clip: ableton.Clip<"1.0.0"> | null = null;
    if (obj instanceof ableton.ClipSlot) clip = obj.clip;
    else if (obj instanceof ableton.Clip) clip = obj;
    if (!clip) throw new Error("no clip at the given address");
    const opts = readOpts(params);
    const result = serializeClipFull(clip, opts.responseFormat);
    if (params.includePitchSummary && clip instanceof ableton.MidiClip) {
      result.pitchSummary = buildPitchSummary(clip.notes);
    }
    if (clip instanceof ableton.MidiClip && opts.representations?.length) {
      const trackIndex = addr.kind === "clipSlot" || addr.kind === "arrangementClip" ? addr.track : null;
      const track = trackIndex !== null ? ctx.application.song.tracks[trackIndex] : undefined;
      const mctx = musicalContextFromSong(ctx.application.song, {
        clipLengthBeats: clip.duration,
        clipName: clip.name,
        drumPadMap: track ? findDrumPadMap(track) : undefined,
      });
      attachClipRepresentations(result, clip.notes, mctx, opts.representations);
    }
    return { result };
  },

  get_selection() {
    return { result: { selection: getSelection() } };
  },

  async render_audio(ctx, params) {
    const obj = resolveAddress(ctx, params.addr as Address);
    if (!(obj instanceof ableton.AudioTrack)) {
      throw new Error("render_audio requires an audio track address");
    }
    const startBeat = Number(params.startBeat);
    const endBeat = Number(params.endBeat);
    kernelLog.info("render_audio", `track=${formatAddr(params.addr)} beats ${startBeat}–${endBeat}`);
    const wavPath = await ctx.resources.renderPreFxAudio(obj, startBeat, endBeat);
    kernelLog.info("render_audio", `wrote ${wavPath}`);
    return { result: { wavPath } };
  },

  async find_clip(ctx, params) {
    const opts = readOpts(params);
    return findClip(ctx, { ...(params as unknown as FindClipParams), representations: opts.representations });
  },

  async get_drum_rack_map(ctx, params) {
    return getDrumRackMap(ctx, params as unknown as GetDrumRackMapParams);
  },

  async remap_clip_notes(ctx, params) {
    return remapClipNotes(ctx, params as unknown as RemapClipNotesParams);
  },

  run_code(ctx, params) {
    const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
    return runCode(ctx, String(params.code ?? ""), { timeoutMs });
  },
};
