// Behavioral E2E for find_clip, get_drum_rack_map, remap_clip_notes.
// Requires Live + Developer Mode + kernel on ws://127.0.0.1:17890
//   npm run ableton-mcp:kernel:dev
import WebSocket from "ws";

const URL = "ws://127.0.0.1:17890";
const ws = new WebSocket(URL);
let nextId = 1;
const pending = new Map();

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
}

const SETUP = `
const song = context.application.song;
let track = song.tracks.find(t => t.name === "Agent Test");
if (!track) {
  track = await song.createMidiTrack();
  track.name = "Agent Test";
}
const arrClip = await track.createMidiClip(16, 4);
arrClip.name = "MCP Test Drums";
arrClip.notes = [
  { pitch: 36, startTime: 0, duration: 0.5, velocity: 100 },
  { pitch: 54, startTime: 1, duration: 0.5, velocity: 90 },
  { pitch: 54, startTime: 2, duration: 0.5, velocity: 80 },
];
let drumIdx = track.devices.findIndex(d => d.name.includes("Drum Rack") || d.constructor.className === "DrumRackDevice");
if (drumIdx < 0) {
  await track.insertDevice("Drum Rack", 0);
  drumIdx = 0;
}
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
  try {
    console.log("→ connected to", URL, "\n");

    const setup = (await call("run_code", { code: SETUP })).result;
    const trackIndex = setup.trackIndex;
    const drumIdx = setup.drumIdx;
    check("setup Agent Test track + clip + drum rack", Number.isInteger(trackIndex), `track=${trackIndex}`);

    const found = (await call("find_clip", {
      track: trackIndex,
      name: "MCP Test Drums",
      view: "arrangement",
      includePitchSummary: true,
    })).result;
    check("find_clip returns arrangement addr", found.addr?.kind === "arrangementClip", JSON.stringify(found.addr));
    check("find_clip pitchSummary includes 54", found.pitchSummary?.pitches?.includes(54), JSON.stringify(found.pitchSummary?.pitches));

    const drumMap = (await call("get_drum_rack_map", {
      addr: { kind: "device", track: trackIndex, index: drumIdx },
    })).result;
    check("get_drum_rack_map type DrumRack", drumMap.type === "DrumRack", drumMap.name);
    check("get_drum_rack_map pads have receivingNote", drumMap.pads?.some((p) => typeof p.receivingNote === "number"), `pads=${drumMap.pads?.length}`);

    const remap = (await call("remap_clip_notes", {
      scope: "clip",
      addr: found.addr,
      pitchMap: [{ from: 54, to: 48 }],
    })).result;
    check("remap_clip_notes remapped shaker hits", remap.totalNotesRemapped >= 2, `total=${remap.totalNotesRemapped}`);

    const notesAfter = (await call("get_clip_notes", {
      addr: found.addr,
      includePitchSummary: true,
    })).result;
    const has48 = notesAfter.pitchSummary?.pitches?.includes(48);
    const no54 = !notesAfter.pitchSummary?.pitches?.includes(54);
    check("get_clip_notes pitchSummary has 48 after remap", has48 && no54, JSON.stringify(notesAfter.pitchSummary?.pitches));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${failed.length ? "FAILED" : "PASSED"} (${results.length - failed.length}/${results.length})`);
    ws.close();
    process.exit(failed.length ? 1 : 0);
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
