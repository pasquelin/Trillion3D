// The work of each GPU pass of a WebGPU frame, as a formula in what the frame holds: P pixels drawn
// (the render size), D display pixels, the covered share of P, T triangles and R clusters drawn,
// N placements the cut walks, L shadowed lights projected and the share of P they reach, the
// reflecting share of P. Each constant is the shipped code's, cited by the symbol that holds
// it (`sources`), and each formula is written from the constants its work counts. Compulsory work
// only: a data-dependent walk (a shadow ray's march past its first sample, a reflection ray's
// steps) is counted at its least, so what a pass takes above its floor (`floor.ts`) holds those
// walks. Pure.
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { PRIMITIVE_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/cameraRanges.ts'
import {
  VSM_TRACE_RAYS_SUN,
  VSM_TRACE_STEPS_SUN,
} from '../../../packages/sdk-browser/src/vsm/constants.ts'
import {
  REFLECTION_PASS,
  REFLECTION_RADIANCE_PASS,
} from '../../../packages/sdk-browser/src/stage/passLabels.ts'
import { passKey } from '../summary.ts'
import * as K from './passConstants.ts'

export type { Frame } from './passConstants.ts'

export const PASSES: K.PassModel[] = [
  {
    label: 'DAG selection',
    formula: `(N + R)·${PRIMITIVE_BYTES} B rows; ${K.DAG_FIXED_DISPATCHES} + ${K.DAG_LEVEL_DISPATCHES}·${K.DAG_LEVELS} levels dependent dispatches`,
    work: (f) => ({
      bytes: (f.N + f.R) * PRIMITIVE_BYTES,
      passes: 1,
      dispatches: K.DAG_FIXED_DISPATCHES + K.DAG_LEVEL_DISPATCHES * K.DAG_LEVELS,
    }),
    sources: [
      K.engine('gpu/dag/encode.ts', 'encodeDagKernels'),
      K.engine('gpu/dag/cameraRanges.ts', 'PRIMITIVE_BYTES'),
    ],
  },
  {
    label: 'partition',
    formula: `R·(${K.PARTITION_ROW} B row + ${K.PARTITION_COUNTS} B counts); 2 dispatches`,
    work: (f) => ({ bytes: f.R * (K.PARTITION_ROW + K.PARTITION_COUNTS), passes: 2 }),
    sources: [K.engine('webgpu/pages/render/encodeVis.ts', 'encodeVis')],
  },
  {
    label: 'visibility primary',
    formula: `T triangles; P·cover fragments; ${K.VISIBILITY_BYTES} B a pixel (r32uint id + depth32float)`,
    work: (f) => ({
      triangles: f.T,
      fragments: f.P * f.cover,
      bytes: K.VISIBILITY_BYTES * f.P,
      passes: 1,
    }),
    sources: [
      K.engine('webgpu/visibility/pipelines.ts', 'VIS_TARGETS'),
      K.engine('webgpu/visibility/pipelines.ts', 'VIS_DEPTH'),
    ],
  },
  {
    label: 'HiZ',
    formula:
      "the culling layer's build: 2P + 5·Σ coarser levels texels, 4 B each (the nearest layer and the finished depth's farthest are built in the reflections' pass)",
    work: (f) => ({ texels: K.hizCullTexels(f.P), bytes: 4 * K.hizCullTexels(f.P), passes: 1 }),
    sources: [
      K.engine('gpu/hiz/levelSizes.ts', 'hizLevelSizes'),
      { path: 'bench/runner/counts/frameBudgetRates.ts', symbol: 'hizCullAccesses' },
    ],
  },
  {
    label: 'material cache and tiles',
    formula: `P identifiers read (${K.TILE_ID_BYTES} B), 32×32 tiles listed`,
    work: (f) => ({ texels: f.P, bytes: K.TILE_ID_BYTES * f.P, passes: 1 }),
    sources: [K.engine('visibility/shader/materialTilesWgsl.ts', 'MATERIAL_TILES_SHADER')],
  },
  {
    label: 'material surfaces v1',
    formula: `P·cover·(4 B id + ${K.SURFACE_BYTES} B surfaces); ${K.SURFACE_FETCHES} fetches (id, 3 indices, 3×3 attributes)`,
    work: (f) => ({
      bytes: f.P * f.cover * (4 + K.SURFACE_BYTES),
      texels: K.SURFACE_FETCHES * f.P * f.cover,
      pixelsMrt4: f.P * f.cover,
      passes: 1,
    }),
    sources: [
      { path: 'docs/ENGINE.md', symbol: 'Material surfaces' },
      K.engine('visibility/shader/receiverTargetWgsl.ts', 'RECEIVER_TARGET_BYTES'),
    ],
  },
  {
    label: 'vsm.marking',
    formula: `P/${K.MARK_STRIDE} pixels (a stride of 2 each way) × (depth 4 + normal 8 + flags 1 B, a light-grid cell) + page marks`,
    work: (f) => ({ bytes: (K.MARK_BYTES * f.P) / K.MARK_STRIDE, texels: f.P, passes: 1 }),
    sources: [
      K.engine('webgpu/pages/render/vsm/vsmEncode.ts', 'encodeVsmFrame'),
      { path: 'docs/SHADOWS.md', symbol: 'One frame' },
    ],
  },
  {
    label: 'vsm.projection',
    formula: `P·cover·(${K.PROJECTION_BYTES} B + ${K.SCREEN_RAY} fetches) + P·cover·reach·L·(1 ray of ${VSM_TRACE_STEPS_SUN + 1} samples × ${K.SAMPLE_FETCHES} fetches) at least; up to ${VSM_TRACE_RAYS_SUN} rays; 4 B a pixel a layer of ${K.LIGHTS_A_LAYER} lights`,
    work: (f) => {
      const lit = f.P * f.cover
      const samples = lit * f.reach * f.L * (VSM_TRACE_STEPS_SUN + 1) * K.SAMPLE_FETCHES
      return {
        texels: lit * K.SCREEN_RAY + samples,
        bytes: lit * K.PROJECTION_BYTES + 4 * f.P * ceilDiv(f.L, K.LIGHTS_A_LAYER),
        passes: 1,
      }
    },
    sources: [
      K.engine('vsm/constants.ts', 'VSM_TRACE_STEPS_SUN'),
      K.engine('vsm/constants.ts', 'VSM_TRACE_RAYS_SUN'),
      K.engine('vsm/projectionWgsl.ts', 'vsmProjectionTiles'),
    ],
  },
  {
    label: 'deferred lighting',
    formula: `P·cover·(${K.LIGHTING_READ} B read + ${K.LIGHTING_WRITE} B written + ${K.LIGHTING_FETCHES} + ${K.FOOTPRINT} footprint fetches)`,
    work: (f) => ({
      bytes: f.P * f.cover * (K.LIGHTING_READ + K.LIGHTING_WRITE),
      texels: f.P * f.cover * (K.LIGHTING_FETCHES + K.FOOTPRINT),
      fragments: f.P,
      passes: 1,
    }),
    sources: [
      K.engine('lighting/deferred/surfaceWgsl.ts', 'LIGHT_SURFACE_ENTRY'),
      K.engine('lighting/direct/shadowWgsl.ts', 'directShadowWgsl'),
    ],
  },
  {
    label: passKey(REFLECTION_PASS),
    formula: `nearest and finished-depth pyramid builds (9 plane reads a pixel and 4 reads, a write a coarser texel of two bounds); P texels classified; P·reflecting·(${K.TRACE_LOADS} + ${K.MARCH_ITERATIONS} iterations × ${K.MARCH_FETCHES} + ${K.HIT_LOADS} loads, ${K.HIT_TAPS} filtered taps, ${K.TRACE_BYTES} B written) — 16 iterations on average, 35 at p99`,
    work: (f) => ({
      texels:
        K.hizNearestTexels(f.P) +
        f.P +
        f.P * f.reflecting * (K.TRACE_LOADS + K.MARCH_ITERATIONS * K.MARCH_FETCHES + K.HIT_LOADS),
      filtered: f.P * f.reflecting * K.HIT_TAPS,
      bytes: K.TRACE_BYTES * f.P * f.reflecting,
      passes: 1,
    }),
    sources: [
      K.engine('reflections/frame.ts', 'encodeReflections'),
      K.engine('reflections/march.ts', 'REFLECTION_MARCH_WGSL'),
      K.engine('reflections/trace.ts', 'TRACE_SHADER'),
      K.engine('gpu/hiz/shader.ts', 'HIZ_SHADER'),
      { path: 'bench/runner/counts/frameBudgetRates.ts', symbol: 'hizNearestAccesses' },
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
      K.engine('reflections/radiance.ts', 'RADIANCE_SHADER'),
    ],
  },
  {
    label: 'temporal antialiasing',
    formula: `D·(${K.taaFetches({ P: 0, D: 1 })} fetches at half the display per axis + ${2 * K.TAA_TARGET_BYTES} B targets written and read back) + P·${K.TAA_INPUT_BYTES} B`,
    work: (f) => ({
      texels: f.D * K.taaFetches(f),
      bytes: 2 * K.TAA_TARGET_BYTES * f.D + K.TAA_INPUT_BYTES * f.P,
      passes: 1,
    }),
    sources: [
      K.engine('taa/resolve.ts', 'resolveTargetUsage'),
      { path: 'bench/runner/counts/taaFetchCount.ts', symbol: 'countTaaFetches' },
    ],
  },
  {
    label: 'HDR composition + present',
    formula: `D·(${K.COMPOSE_READ} B read + ${K.COMPOSE_WRITE} B written)`,
    work: (f) => ({ bytes: (K.COMPOSE_READ + K.COMPOSE_WRITE) * f.D, texels: f.D, passes: 1 }),
    sources: [{ path: 'docs/ENGINE.md', symbol: 'Material surfaces' }],
  },
]
