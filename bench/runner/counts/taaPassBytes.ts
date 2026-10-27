// What each temporal pass moves, in bytes a display pixel and a render pixel: the shipped targets'
// formats and sizes (`analysisBytesPerPixel`, `historyFormatsOf`), counted beside the fetches
// (`taaFetchCount.ts`) the cost model (`bench/dawn/model/passes.ts`) sums them with.
import type { TaaPass } from './taaFetchCount.ts'
import { FEATURE } from '../../../packages/sdk-browser/src/gpu/core/gpuCaps.ts'
import { texelBytesOf } from '../../../packages/sdk-browser/src/gpu/core/textureBytes.ts'
import { analysisBytesPerPixel } from '../../../packages/sdk-browser/src/post/taa/analysisTargets.ts'
import {
  frameSequenceOf,
  slotsOf,
} from '../../../packages/sdk-browser/src/post/taa/historyFrames.ts'
import {
  CLOSEST_FORMAT,
  MARKS_FORMAT,
} from '../../../packages/sdk-browser/src/post/taa/velocityWgsl.ts'
import {
  FLICKER_FORMAT,
  REPROJECTED_FORMAT,
} from '../../../packages/sdk-browser/src/post/taa/reprojectWgsl.ts'
import { THIN_GEOMETRY_FORMAT } from '../../../packages/sdk-browser/src/post/taa/thinGeometryWgsl.ts'
import { REJECTION_FORMAT } from '../../../packages/sdk-browser/src/post/taa/rejectionWgsl.ts'
import { FIELD_FORMAT } from '../../../packages/sdk-browser/src/post/taa/reprojectionFieldWgsl.ts'
import { sceneColorWords } from '../../../packages/sdk-browser/src/post/taa/colorSpaceWgsl.ts'
import { ANTI_ALIAS_MASK } from '../../../packages/sdk-browser/src/post/taa/storageForms.ts'
import { outputBytes } from '../../../packages/sdk-browser/src/post/taa/historyResolve.ts'
import { historyFormatsOf } from '../../../packages/sdk-browser/src/post/taa/historyShape.ts'
import { taaKnobs } from '../../../packages/sdk-browser/src/post/taa/levels.ts'
import { DEFAULT_TEMPORAL_AA_LEVEL } from '../../../packages/sdk-core/src/contracts/materialAbi.ts'

/** The storage textures per stage of the device the model counts: the limit of a desktop adapter, the shipped forms' (the mask and the
 *  luma as textures, a device at WebGPU's guaranteed four holds them as buffers). */
const TAA_STORAGE_TEXTURES = 8
/** TAA at the default level (`DEFAULT_TEMPORAL_AA_LEVEL`, the one `countTaaFetches` counts) on a
 *  device that stores the packed formats (`historyFormatsOf`), a still image:
 *  - a display pixel holds `TAA_HISTORY_PIXELS` history pixels (the level's percent of the display's
 *    size, squared), each `TAA_FRAME_BYTES` in a frame — its colour and its validity —, the last
 *    image's frame read and this image's written;
 *  - the half-size image (in the history's colour format) is written beside, a quarter of a texel a display
 *    pixel (`TAA_HALF_BYTES`);
 *  - where the history is larger than the display's, the resolve reads the history's colour again
 *    and writes the display's colour (`TAA_RESOLVE_BYTES`, `outputBytes`);
 *  - a render pixel's analysis targets (`analysisBytesPerPixel` of the frames a still image touches:
 *    the pair of the history that takes turns, none of the resurrection's) are written and read
 *    back, and its render inputs read once: colour, depth, identifier, the r32uint flags, and the
 *    responsiveness the blends carry (r8, `RESPONSIVE_FORMAT`) — bound only where a blend carries
 *    some, counted always: the model's frame does not say (`TAA_RENDER_BYTES`).
 *  Its fetches a display pixel are its shipped passes' (`countTaaFetches`), at the finest level: half
 *  the display per axis below it, else the display's. */
const TAA_KNOBS = taaKnobs(DEFAULT_TEMPORAL_AA_LEVEL)
const TAA_FORMATS = historyFormatsOf(new Set([FEATURE.textureTier1]), true, {
  maxStorageTexturesPerShaderStage: TAA_STORAGE_TEXTURES,
})
const TAA_HISTORY_PIXELS = (TAA_KNOBS.historyPercent / 100) ** 2,
  TAA_FRAME_BYTES = texelBytesOf(TAA_FORMATS.color) + texelBytesOf(TAA_FORMATS.validity),
  TAA_HALF_BYTES = texelBytesOf(TAA_FORMATS.color) / 4,
  TAA_RESOLVE_BYTES =
    TAA_HISTORY_PIXELS > 1
      ? TAA_HISTORY_PIXELS * texelBytesOf(TAA_FORMATS.color) + outputBytes(1, 1, TAA_FORMATS.color)
      : 0,
  TAA_INPUT_BYTES = 8 + 4 + 4 + 4 + 1
export const TAA_DISPLAY_BYTES =
    2 * TAA_HISTORY_PIXELS * TAA_FRAME_BYTES + TAA_HALF_BYTES + TAA_RESOLVE_BYTES,
  TAA_RENDER_BYTES =
    2 *
      analysisBytesPerPixel(
        frameSequenceOf(false, 0, 1),
        TAA_KNOBS.reprojectionField,
        TAA_KNOBS.antiAliasIterations > 0,
        TAA_FORMATS,
      ) +
    TAA_INPUT_BYTES
/**
 * Each temporal pass's bytes, a share of `TAA_DISPLAY_BYTES` a display pixel and of
 * `TAA_RENDER_BYTES` a render pixel: every analysis target written by the pass that writes it and
 * read once by the pass that reads it (`analysisTargets.ts`), each render input read by the pass
 * that reads it:
 * - the nearest velocity (dilate velocity) reads the depth, the identifiers, the flags and the
 *   responsiveness, and writes the closest depth, the marks, the jacobian's layer, the boundary and
 *   the occluder word;
 * - the reprojection (decimate history) reads the closest depth, the marks, the occluder word, the
 *   flicker history, the shading histories and the thin geometry's coverage history, and writes the reprojection word, the flicker history
 *   reprojected, the shading history's layer and the field vector's layer;
 * - before the translucency, the flicker luma's measure and the material coverage's each write
 *   their layer of the measures (`MEASURE_LAYERS`);
 * - the thin geometry detection reads the coverage and writes its word, which its weight relaxation
 *   reads, writing the mask's and the coverage history's layers;
 * - the shading rejection, whose entry begins with the flicker measure, reads the colour, the
 *   reprojection word, the flicker history reprojected, the flicker luma, the shading history's
 *   layer and the thin geometry's mask, and writes the flicker history, the rejection, the scene
 *   colour, the LDR luma and the shading histories; the measure's error and count pass in registers;
 * - the spatial anti-aliaser reads the LDR luma and writes its offset;
 * - the history update reads the rejection, the scene colour, the offset, the field's vector and
 *   jacobian and the boundary, at render resolution, and a display pixel's history frame read and
 *   written, and the half-size image written;
 * - the history's resolve reads the history again and writes the display's (`TAA_RESOLVE_BYTES`);
 * - the display layers' resolve, none where no filtering blend is in the frame.
 */
const TAA_GUIDE = texelBytesOf(TAA_FORMATS.guide),
  TAA_FIELD = texelBytesOf(FIELD_FORMAT),
  TAA_SCENE_COLOR = 4 * sceneColorWords(TAA_FORMATS.color),
  TAA_LUMA = 1,
  TAA_OFFSET = texelBytesOf(TAA_FORMATS.antiAlias),
  TAA_MASK = TAA_KNOBS.antiAliasIterations > 0 ? ANTI_ALIAS_MASK.texelBytes[TAA_FORMATS.mask] : 0,
  TAA_SLOTS = slotsOf(frameSequenceOf(false, 0, 1)) * TAA_GUIDE,
  TAA_OCCLUDER = 4,
  TAA_MEASURE = texelBytesOf(TAA_FORMATS.measure)
export const TAA_PASS_BYTES: Record<TaaPass, { display: number; render: number }> = {
  measureFlickeringLuma: { display: 0, render: TAA_MEASURE },
  measureThinCoverage: { display: 0, render: TAA_MEASURE },
  dilateVelocity: {
    display: 0,
    render:
      4 +
      4 +
      4 +
      1 +
      texelBytesOf(CLOSEST_FORMAT) +
      texelBytesOf(MARKS_FORMAT) +
      TAA_FIELD +
      TAA_FIELD +
      TAA_OCCLUDER,
  },
  decimateHistory: {
    display: 0,
    render:
      texelBytesOf(CLOSEST_FORMAT) +
      texelBytesOf(MARKS_FORMAT) +
      TAA_OCCLUDER +
      texelBytesOf(FLICKER_FORMAT) +
      TAA_SLOTS +
      texelBytesOf(REPROJECTED_FORMAT) +
      texelBytesOf(FLICKER_FORMAT) +
      TAA_GUIDE +
      TAA_FIELD +
      TAA_MEASURE,
  },
  detectThinGeometry: { display: 0, render: texelBytesOf(THIN_GEOMETRY_FORMAT) + TAA_MEASURE },
  relaxThinGeometry: {
    display: 0,
    render: texelBytesOf(THIN_GEOMETRY_FORMAT) + 2 * TAA_MEASURE,
  },
  rejectShading: {
    display: 0,
    render:
      8 +
      texelBytesOf(REPROJECTED_FORMAT) +
      texelBytesOf(FLICKER_FORMAT) +
      TAA_MEASURE +
      texelBytesOf(FLICKER_FORMAT) +
      TAA_GUIDE +
      texelBytesOf(REJECTION_FORMAT) +
      TAA_SCENE_COLOR +
      TAA_LUMA +
      TAA_SLOTS +
      TAA_MEASURE +
      TAA_MASK,
  },
  spatialAntiAliasing: { display: 0, render: TAA_LUMA + TAA_OFFSET + TAA_MASK },
  updateHistory: {
    display: 2 * TAA_HISTORY_PIXELS * TAA_FRAME_BYTES + TAA_HALF_BYTES,
    render:
      texelBytesOf(REJECTION_FORMAT) +
      TAA_SCENE_COLOR +
      TAA_OFFSET +
      TAA_FIELD +
      TAA_FIELD +
      TAA_FIELD,
  },
  resolveHistory: { display: TAA_RESOLVE_BYTES, render: 0 },
  resolveDisplayLayers: { display: 0, render: 0 },
}
