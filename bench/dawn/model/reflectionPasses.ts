// The reflections' passes of the frame model (`passes.ts`): the depth pyramids, the screen trace,
// the scene trace, the denoise and the radiance pyramid, each a formula in what the frame holds — its
// `reflecting` share the pixels a lobe of which traces, at the finer blocks (`REFLECTION_TRACE_BLOCK`),
// a lower bound of a frame whose rough pixels read the field alone in the last pass. Pure.
import {
  REFLECTION_PASS,
  REFLECTION_RADIANCE_PASS,
  REFLECTION_TRACE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_DENOISE_PASS,
} from '../../../packages/sdk-browser/src/stage/passLabels.ts'
import { passKey } from '../report/summary.ts'
import * as K from './passConstants.ts'

export const REFLECTION_PASSES: K.PassModel[] = [
  {
    label: passKey(REFLECTION_PASS),
    formula:
      'nearest and finished-depth pyramid builds (9 plane reads a pixel and 4 reads, a write a coarser texel of two bounds)',
    work: (f) => ({ texels: K.hizNearestTexels(f.P), passes: 1 }),
    sources: [
      K.engine('reflections/frame.ts', 'encodeDepthPyramid'),
      K.engine('gpu/hiz/shader.ts', 'HIZ_SHADER'),
      { path: 'bench/runner/counts/frameBudgetRates.ts', symbol: 'hizNearestAccesses' },
    ],
  },
  {
    label: passKey(REFLECTION_TRACE_PASS),
    formula: `P flags classified, a reflecting pixel's roughness beside; P·reflecting/${K.TRACE_SHARE} lobe rays marched on the screen (a pixel of each block), each ${K.TRACE_LOADS} + ${K.MARCH_ITERATIONS} iterations × ${K.MARCH_FETCHES} + ${K.HIT_LOADS} loads and ${K.HIT_TAPS} filtered taps, ${K.GRID_BYTES} + ${K.RAY_BYTES} B written — 16 iterations on average, 35 at p99`,
    work: (f) => ({
      texels:
        f.P +
        ((f.P * f.reflecting) / K.TRACE_SHARE) *
          (K.TRACE_LOADS + K.MARCH_ITERATIONS * K.MARCH_FETCHES + K.HIT_LOADS),
      filtered: ((f.P * f.reflecting) / K.TRACE_SHARE) * K.HIT_TAPS,
      bytes: ((K.GRID_BYTES + K.RAY_BYTES) * f.P * f.reflecting) / K.TRACE_SHARE,
      passes: 1,
    }),
    sources: [
      K.engine('reflections/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('reflections/tiles.ts', 'REFLECTION_CLASSIFY_WGSL'),
      K.engine('gpu/hiz/screenMarch.ts', 'SCREEN_MARCH_WGSL'),
      K.engine('reflections/trace.ts', 'REFLECTION_TRACE_SHADER'),
    ],
  },
  {
    label: passKey(REFLECTION_SCENE_PASS),
    formula: `at most P·reflecting/${K.TRACE_SHARE} rays the screen left, each ${K.SCENE_LOADS} loads and its ${K.GRID_BYTES} B entry read, ${K.GRID_BYTES} B written; the proxy walk unmodelled: a lower bound`,
    work: (f) => ({
      texels: ((f.P * f.reflecting) / K.TRACE_SHARE) * K.SCENE_LOADS,
      bytes: (2 * K.GRID_BYTES * f.P * f.reflecting) / K.TRACE_SHARE,
      passes: 1,
    }),
    sources: [
      K.engine('reflections/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('reflections/proxy.ts', 'REFLECTION_PROXY_WGSL'),
      K.engine('reflections/trace.ts', 'REFLECTION_TRACE_SHADER'),
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
      K.engine('reflections/traceEncode.ts', 'encodeReflectionTrace'),
      K.engine('reflections/trace.ts', 'REFLECTION_TRACE_SHADER'),
    ],
  },
  {
    label: passKey(REFLECTION_RADIANCE_PASS),
    formula: `P texels read (${K.RADIANCE_BYTES} B each) and written as level 0, the coarser levels beside (Σ levels); ${K.RADIANCE_TAPS} filtered taps a texel of the odd levels over a ${K.RADIANCE_HALO.toFixed(2)}× halo`,
    work: (f) => ({
      texels: f.P,
      filtered: K.RADIANCE_TAPS * K.RADIANCE_HALO * K.oddLevelTexels(f.P),
      bytes: K.RADIANCE_BYTES * (2 * f.P + K.coarserTexels(f.P)),
      passes: 1,
    }),
    sources: [
      K.engine('reflections/frame.ts', 'encodeReflectionRadiance'),
      K.engine('reflections/radianceWgsl.ts', 'RADIANCE_SHADER'),
    ],
  },
]
