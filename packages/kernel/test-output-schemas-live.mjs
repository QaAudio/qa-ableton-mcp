// Live output-schema gate — validates every kernel handler payload against the shared Zod schemas.
// Requires Live + Developer Mode + kernel on ws://127.0.0.1:17890
//   npm run ableton-mcp:kernel:dev
//   npm run build:libs   (schemas imported from @quantumaudio/ableton-mcp-schemas dist)
import WebSocket from "ws";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getContextOutputSchema,
  getTrackOutputSchema,
  getDeviceOutputSchema,
  getClipNotesOutputSchema,
  getSelectionOutputSchema,
  renderAudioOutputSchema,
  findClipOutputSchema,
  getDrumRackMapOutputSchema,
  remapClipNotesOutputSchema,
} from "@quantumaudio/ableton-mcp-schemas";

const URL = "ws://127.0.0.1:17890";
const CAPTURE = process.argv.includes("--capture");
const CAPTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../apps/qa-ableton-mcp/src/output-schemas.live-captures.json",
);

const SCHEMA_CASES = [
  ["get_context", { responseFormat: "concise" }, getContextOutputSchema],
  ["get_context", { responseFormat: "detailed" }, getContextOutputSchema],
  ["get_selection", {}, getSelectionOutputSchema],
];

const ws = new WebSocket(URL);
let nextId = 1;
const pending = new Map();
const captures = {};

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function validate(label, schema, result) {
  const parsed = schema.safeParse(result);
  if (parsed.success) {
    console.log(`✅ ${label}`);
    return true;
  }
  console.log(`❌ ${label}`);
  console.log(JSON.stringify(parsed.error.issues, null, 2));
  console.log("raw:", JSON.stringify(result, null, 2).slice(0, 2000));
  return false;
}

const ENSURE_AGENT_TRACK = `
const song = context.application.song;
let track = song.tracks.find(t => t.name === "Agent Test");
if (!track) {
  track = await song.createMidiTrack();
  track.name = "Agent Test";
}
const slot = track.clipSlots[0];
if (!slot.clip) {
  const clip = await slot.createMidiClip(4);
  clip.name = "Hello Notes";
  clip.notes = [{ pitch: 60, startTime: 0, duration: 1, velocity: 100 }];
}
let drumIdx = track.devices.findIndex(d => d.name.includes("Drum Rack") || d.constructor.className === "DrumRackDevice");
if (drumIdx < 0) {
  await track.insertDevice("Drum Rack", 0);
  drumIdx = 0;
}
const arr = await track.createMidiClip(32, 4);
arr.name = "Schema Live Drums";
arr.notes = [{ pitch: 36, startTime: 0, duration: 0.5, velocity: 100 }, { pitch: 54, startTime: 1, duration: 0.5, velocity: 90 }];
return { trackIndex: song.tracks.indexOf(track), drumIdx };
`;

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error));
  else p.resolve(msg);
});

ws.on("open", async () => {
  let ok = true;
  try {
    console.log("→ connected to", URL, "\n");

    const setup = (await call("run_code", { code: ENSURE_AGENT_TRACK })).result;
    const trackIndex = setup.trackIndex;
    const drumIdx = setup.drumIdx;

    const ctx = (await call("get_context", { responseFormat: "concise" })).result;
    const agent = ctx.tracks.find((t) => t.index === trackIndex) ?? ctx.tracks[trackIndex];

    for (const [method, params, schema] of SCHEMA_CASES) {
      const resp = await call(method, params);
      const key = `${method}:${JSON.stringify(params)}`;
      if (CAPTURE) captures[key] = resp.result;
      if (!validate(key, schema, resp.result)) ok = false;
    }

    const trackAddr = agent?.addr ?? { kind: "track", index: trackIndex };
    for (const [method, params, schema, key] of [
      ["get_track", { addr: trackAddr, responseFormat: "concise" }, getTrackOutputSchema, "get_track:concise"],
      ["get_track", { addr: trackAddr, responseFormat: "detailed" }, getTrackOutputSchema, "get_track:detailed"],
      ["get_track", { addr: trackAddr, responseFormat: "detailed", includeDevices: false }, getTrackOutputSchema, "get_track:detailed:noDevices"],
      ["get_device", { addr: { kind: "device", track: trackIndex, index: drumIdx }, responseFormat: "detailed" }, getDeviceOutputSchema, "get_device:drumRack"],
    ]) {
      const resp = await call(method, params);
      if (CAPTURE) captures[key] = resp.result;
      if (!validate(key, schema, resp.result)) ok = false;
    }

    const occupied = agent?.clipSlots?.find((s) => s.hasClip) ?? { slot: 0 };
    const clipSlotAddr = { kind: "clipSlot", track: trackIndex, slot: occupied.slot };
    for (const [method, params, schema, key] of [
      ["get_clip_notes", { addr: clipSlotAddr }, getClipNotesOutputSchema, "get_clip_notes:slot"],
      ["get_clip_notes", { addr: clipSlotAddr, includePitchSummary: true }, getClipNotesOutputSchema, "get_clip_notes:pitchSummary"],
      ["get_clip_notes", { addr: clipSlotAddr, responseFormat: "detailed" }, getClipNotesOutputSchema, "get_clip_notes:detailed"],
    ]) {
      const resp = await call(method, params);
      if (CAPTURE) captures[key] = resp.result;
      if (!validate(key, schema, resp.result)) ok = false;
    }

    const found = (await call("find_clip", { track: trackIndex, name: "Schema Live Drums", view: "arrangement", includePitchSummary: true })).result;
    if (CAPTURE) captures["find_clip"] = found;
    if (!validate("find_clip", findClipOutputSchema, found)) ok = false;

    const drumMap = (await call("get_drum_rack_map", { addr: { kind: "device", track: trackIndex, index: drumIdx } })).result;
    if (CAPTURE) captures["get_drum_rack_map"] = drumMap;
    if (!validate("get_drum_rack_map", getDrumRackMapOutputSchema, drumMap)) ok = false;

    const remap = (await call("remap_clip_notes", {
      scope: "clip",
      addr: found.addr,
      pitchMap: [{ from: 54, to: 48 }],
    })).result;
    if (CAPTURE) captures["remap_clip_notes"] = remap;
    if (!validate("remap_clip_notes", remapClipNotesOutputSchema, remap)) ok = false;

    const audioTrack = ctx.tracks.find((t) => t.type === "audio");
    if (audioTrack) {
      const rendered = (await call("render_audio", { addr: audioTrack.addr, startBeat: 0, endBeat: 1 })).result;
      if (CAPTURE) captures["render_audio"] = rendered;
      if (!validate("render_audio", renderAudioOutputSchema, rendered)) ok = false;
    } else {
      console.log("⏭ render_audio skipped (no audio track in set)");
    }

    if (CAPTURE) {
      writeFileSync(CAPTURE_PATH, JSON.stringify(captures, null, 2));
      console.log(`\nwrote captures → ${CAPTURE_PATH}`);
    }

    console.log(`\n${ok ? "PASSED" : "FAILED"} output-schema live gate`);
    ws.close();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error("fatal:", e);
    ws.close();
    process.exit(1);
  }
});

ws.on("error", (e) => {
  console.error("WebSocket error — is the kernel running? npm run ableton-mcp:kernel:dev");
  console.error(e.message);
  process.exit(1);
});
