/**
 * Serialization of live SDK objects into the shared wire format. Shapes are
 * typed against `@quantumaudio/ableton-mcp-schemas` (type-only — nothing from
 * that package is bundled), so drift from the MCP outputSchemas fails `tsc`.
 */

export {
  isDetailed,
  type OverviewOptions,
  type ReadOptions,
  type ResponseFormat,
} from "./common.js";
export { coerceClipColor, serializeClipFull, serializeClipSummary } from "./clip.js";
export {
  serializeDeviceFull,
  serializeParamMeta,
  serializeParamWithValue,
} from "./device.js";
export { serializeTrackFull, serializeTrackOverview } from "./track.js";
export { serializeSongOverview } from "./song.js";
