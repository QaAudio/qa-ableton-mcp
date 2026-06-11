import * as ableton from "@ableton-extensions/sdk";
import { basename } from "node:path";
import type { Ctx, HandlerResult } from "./protocol.js";
import { type Address, resolveAddress } from "./address.js";
import { kernelLog } from "./log.js";

function deviceType(d: ableton.Device<"1.0.0">): string {
  if (d instanceof ableton.Simpler) return "Simpler";
  if (d instanceof ableton.DrumRack) return "DrumRack";
  if (d instanceof ableton.RackDevice) return "RackDevice";
  return "Device";
}

function sampleLabelForChain(chain: ableton.Chain<"1.0.0">): string | undefined {
  const first = chain.devices[0];
  if (!(first instanceof ableton.Simpler)) return first?.name;
  const sample = first.sample;
  if (!sample?.filePath) return first.name;
  return basename(sample.filePath);
}

export type GetDrumRackMapParams = {
  addr: Extract<Address, { kind: "device" }>;
};

export async function getDrumRackMap(ctx: Ctx, params: GetDrumRackMapParams): Promise<HandlerResult> {
  const addr = params.addr;
  if (addr?.kind !== "device") throw new Error("get_drum_rack_map requires a device address");
  const obj = resolveAddress(ctx, addr);
  if (!(obj instanceof ableton.DrumRack)) {
    throw new Error(`Device "${obj instanceof ableton.Device ? obj.name : "?"}" is not a Drum Rack — pass a DrumRack device addr from get_context`);
  }

  const pads = obj.chains.map((chain, chainIndex) => {
    if (!(chain instanceof ableton.DrumChain)) {
      throw new Error(`Chain ${chainIndex} in Drum Rack "${obj.name}" is not a DrumChain`);
    }
    const devices = chain.devices.map((d) => ({ name: d.name, type: deviceType(d) }));
    const pad: Record<string, unknown> = {
      chainIndex,
      receivingNote: chain.receivingNote,
      devices,
    };
    const label = sampleLabelForChain(chain);
    if (label) pad.sampleLabel = label;
    return pad;
  });

  kernelLog.info("get_drum_rack_map", `"${obj.name}" — ${pads.length} pad(s)`);
  return {
    result: {
      addr,
      name: obj.name,
      type: "DrumRack" as const,
      pads,
    },
  };
}
