// The reflections' passes of the frame model (`passes.ts`): the depth pyramids, the screen trace,
// the scene trace and the denoise, each a formula in what the frame holds — its
// `reflecting` share the pixels a lobe of which traces, at the default level's blocks (`REFLECTION_LEVEL_KNOBS`),
// a lower bound of a frame whose rough pixels read the field alone in the last pass. Pure.
import {
  REFLECTION_PASS,
  REFLECTION_TRACE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_CLEAR_PASS,
  REFLECTION_RESOLVE_PASS,
  REFLECTION_TEMPORAL_PASS,
  REFLECTION_BILATERAL_PASS,
  REFLECTION_KEEP_DEPTH_PASS,
} from '../../../packages/sdk-browser/src/diagnostic/stage/passLabels.ts'
import { passKey } from '../report/summary.ts'
import * as K from './passConstants.ts'

export const REFLECTION_PASSES: K.PassModel[] = [
  {
    label: passKey(REFLECTION_PASS),
    formula:
      'nearest and finished-depth pyramid builds (9 plane reads a pixel and 4 reads, a write a coarser texel of two bounds)',
    work: (f) => ({ texels: K.hizNearestTexels(f.P), passes: 1 }),
    sources: [
      K.engine('lighting/reflections/frame.ts', 'encodeDepthPyramid'),
      K.engine('visibility/hiz/gpu/shader.ts', 'HIZ_SHADER'),
      { path: 'bench/runner/counts/frameBudgetRates.ts', symbol: 'hizNearestAccesses' },
    ],
  },
  {
    label: passKey(REFLECTION_TRACE_PASS),
    formula: `P flags classified, a reflecting pixel's roughness beside; P·reflecting/${K.TRACE_SHARE} lobe rays marched on the screen (a pixel of each block), each ${K.TRACE_LOADS} + ${K.MARCH_ITERATIONS} iterations × ${K.MARCH_FETCHES} + ${K.HIT_LOADS} loads, ${K.GRID_BYTES} + ${K.RAY_BYTES} B written — 16 iterations on average, 35 at p99`,
    work: (f) => ({
      texels:
        f.P +
        ((f.P * f.reflecting) / K.TRACE_SHARE) *
          (K.TRACE_LOADS + K.MARCH_ITERATIONS * K.MARCH_FETCHES + K.HIT_LOADS),
      bytes: ((K.GRID_BYTES + K.RAY_BYTES) * f.P * f.reflecting) / K.TRACE_SHARE,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/tiles.ts', 'REFLECTION_CLASSIFY_WGSL'),
      K.engine('visibility/hiz/gpu/screenMarch.ts', 'SCREEN_MARCH_WGSL'),
      K.engine('lighting/reflections/trace/trace.ts', 'reflectionTraceShader'),
    ],
  },
  {
    label: passKey(REFLECTION_SCENE_PASS),
    formula: `at most P·reflecting/${K.TRACE_SHARE} rays the screen left, each ${K.SCENE_LOADS} loads and its ${K.PENDING_BYTES} B entry read, ${K.GRID_BYTES} B written; the march's steps and the cache read unmodelled: a lower bound`,
    work: (f) => ({
      texels: ((f.P * f.reflecting) / K.TRACE_SHARE) * K.SCENE_LOADS,
      bytes: ((K.PENDING_BYTES + K.GRID_BYTES) * f.P * f.reflecting) / K.TRACE_SHARE,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/sceneTrace.ts', 'REFLECTION_SCENE_TRACE_WGSL'),
      K.engine('lighting/surfaceCache/hitWgsl.ts', 'surfaceHitWgsl'),
      K.engine('lighting/reflections/trace/trace.ts', 'reflectionTraceShader'),
    ],
  },
  {
    label: passKey(REFLECTION_CLEAR_PASS),
    formula: `the untraced pixels' flags, depth, normal and lobes read for the coat, a resolved texel and a history texel emptied and the target's layer 0 set (${K.GRID_BYTES} + ${K.HISTORY_BYTES} + ${K.TARGET_BYTES} B); unmodelled: a lower bound of the reads`,
    work: (f) => ({
      bytes: (K.GRID_BYTES + K.HISTORY_BYTES + K.TARGET_BYTES) * f.P * (1 - f.reflecting),
      passes: 1,
    }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/bilateralWgsl.ts', 'REFLECTION_BILATERAL_WGSL'),
    ],
  },
  {
    label: passKey(REFLECTION_RESOLVE_PASS),
    formula: `P·reflecting/${K.TRACE_SHARE} grid texels reused (${K.SPATIAL_LOADS} loads), ${K.GRID_BYTES} B written`,
    work: (f) => ({
      texels: ((f.P * f.reflecting) / K.TRACE_SHARE) * K.SPATIAL_LOADS,
      bytes: (K.GRID_BYTES * f.P * f.reflecting) / K.TRACE_SHARE,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/resolveWgsl.ts', 'REFLECTION_RESOLVE_WGSL'),
    ],
  },
  {
    label: passKey(REFLECTION_TEMPORAL_PASS),
    formula: `P·reflecting/${K.TRACE_SHARE} grid texels accumulated (${K.TEMPORAL_LOADS} loads), ${K.HISTORY_BYTES} B written`,
    work: (f) => ({
      texels: ((f.P * f.reflecting) / K.TRACE_SHARE) * K.TEMPORAL_LOADS,
      bytes: (K.HISTORY_BYTES * f.P * f.reflecting) / K.TRACE_SHARE,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/temporalWgsl.ts', 'REFLECTION_TEMPORAL_WGSL'),
    ],
  },
  {
    label: passKey(REFLECTION_BILATERAL_PASS),
    formula: `P·reflecting traced pixels widened from the grid (${K.BILATERAL_LOADS} loads at most), ${K.TARGET_BYTES} B written (the coat's layer only for a coated pixel: a lower bound)`,
    work: (f) => ({
      texels: f.P * f.reflecting * K.BILATERAL_LOADS,
      bytes: K.TARGET_BYTES * f.P * f.reflecting,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/bilateralWgsl.ts', 'REFLECTION_BILATERAL_WGSL'),
    ],
  },
  {
    label: passKey(REFLECTION_KEEP_DEPTH_PASS),
    formula: 'the opaque depth of every pixel copied to the next image\'s history (one read, 4 B written)',
    work: (f) => ({ texels: f.P, bytes: 4 * f.P, passes: 1 }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/past.ts', 'reflectionPastWgsl'),
    ],
  },
]
