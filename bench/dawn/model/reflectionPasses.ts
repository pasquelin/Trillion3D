// The reflections' passes of the frame model (`passes.ts`): the depth pyramids, the screen trace,
// the scene trace and the denoise, each a formula in what the frame holds — its
// `reflecting` share the pixels a lobe of which traces, at the default level's blocks (`REFLECTION_LEVEL_KNOBS`),
// a lower bound of a frame whose rough pixels read the field alone in the last pass. Pure.
import {
  REFLECTION_PASS,
  REFLECTION_TRACE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_DENOISE_PASS,
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
    formula: `at most P·reflecting/${K.TRACE_SHARE} rays the screen left, each ${K.SCENE_LOADS} loads and its ${K.GRID_BYTES} B entry read, ${K.GRID_BYTES} B written; the march's steps and the cache read unmodelled: a lower bound`,
    work: (f) => ({
      texels: ((f.P * f.reflecting) / K.TRACE_SHARE) * K.SCENE_LOADS,
      bytes: (2 * K.GRID_BYTES * f.P * f.reflecting) / K.TRACE_SHARE,
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
    label: passKey(REFLECTION_DENOISE_PASS),
    formula: `P·reflecting/${K.TRACE_SHARE} grid texels reused (${K.SPATIAL_LOADS} loads) and accumulated (${K.TEMPORAL_LOADS} loads), ${K.GRID_BYTES} B written twice; P·reflecting traced pixels widened from the grid (${K.BILATERAL_LOADS} loads at most), ${K.TARGET_BYTES} B written; the field the untraced pixels read unmodelled`,
    work: (f) => ({
      texels:
        ((f.P * f.reflecting) / K.TRACE_SHARE) * (K.SPATIAL_LOADS + K.TEMPORAL_LOADS) +
        f.P * f.reflecting * K.BILATERAL_LOADS,
      bytes:
        (2 * K.GRID_BYTES * f.P * f.reflecting) / K.TRACE_SHARE +
        K.TARGET_BYTES * f.P * f.reflecting,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/reflections/trace/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('lighting/reflections/trace/trace.ts', 'reflectionTraceShader'),
    ],
  },
]
