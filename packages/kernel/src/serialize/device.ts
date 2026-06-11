import * as ableton from "@ableton-extensions/sdk";
import type {
  DeviceAddress,
  SerializedDevice,
  SerializedDeviceChain,
  SerializedDeviceSummary,
  SerializedMixer,
  SerializedParam,
} from "@quantumaudio/ableton-mcp-schemas";
import {
  deviceType,
  getParamValueSafe,
  isDetailed,
  rackDepthLimit,
  type ResponseFormat,
} from "./common.js";

type Track = ableton.Track<"1.0.0">;
type Device = ableton.Device<"1.0.0">;
type DeviceParameter = ableton.DeviceParameter<"1.0.0">;
type TrackMixer = ableton.TrackMixer<"1.0.0">;
type ChainMixer = ableton.ChainMixer<"1.0.0">;

export function serializeParamMeta(
  p: DeviceParameter,
  format?: ResponseFormat,
): Omit<SerializedParam, "value"> {
  const meta: Omit<SerializedParam, "value"> = {
    name: p.name,
    min: p.min,
    max: p.max,
    isQuantized: p.isQuantized,
  };
  if (isDetailed(format)) {
    meta.defaultValue = p.defaultValue;
    meta.valueItems = p.valueItems;
  }
  return meta;
}

export async function serializeParamWithValue(
  p: DeviceParameter,
  format?: ResponseFormat,
): Promise<SerializedParam> {
  return { ...serializeParamMeta(p, format), value: await getParamValueSafe(p) };
}

export async function serializeMixer(mixer: TrackMixer | ChainMixer): Promise<SerializedMixer> {
  return {
    volume: await getParamValueSafe(mixer.volume),
    panning: await getParamValueSafe(mixer.panning),
    sends: await Promise.all(mixer.sends.map((s) => getParamValueSafe(s))),
  };
}

/** Full device detail incl. current parameter values and (depth-guarded) rack chains. */
export async function serializeDeviceFull(
  device: Device,
  addr: DeviceAddress,
  depth = 0,
  format?: ResponseFormat,
): Promise<SerializedDevice> {
  const parameters = await Promise.all(device.parameters.map((p) => serializeParamWithValue(p, format)));
  const out: SerializedDevice = {
    addr,
    name: device.name,
    type: deviceType(device),
    parameters,
  };
  const maxDepth = rackDepthLimit(format);
  if (device instanceof ableton.RackDevice && depth < maxDepth) {
    out.chains = await Promise.all(
      device.chains.map(async (chain, ci): Promise<SerializedDeviceChain> => {
        const chainOut: SerializedDeviceChain = {
          index: ci,
          mixer: await serializeMixer(chain.mixer),
          devices: [],
        };
        if (chain instanceof ableton.DrumChain) {
          chainOut.receivingNote = chain.receivingNote;
        }
        chainOut.devices = await Promise.all(
          chain.devices.map((d, di) =>
            serializeDeviceFull(
              d,
              { kind: "device", track: addr.track, index: addr.index, chain: [...(addr.chain ?? []), ci, di] },
              depth + 1,
              format,
            ),
          ),
        );
        return chainOut;
      }),
    );
  }
  return out;
}

/** Device rows for a track overview (names + addressing, no parameter values). */
export function serializeDeviceSummaries(track: Track, trackIndex: number): SerializedDeviceSummary[] {
  return track.devices.map((d, di) => ({
    index: di,
    name: d.name,
    type: deviceType(d),
    paramCount: d.parameters.length,
    addr: { kind: "device" as const, track: trackIndex, index: di },
  }));
}
