// The work of each GPU pass of a WebGPU frame, as a formula in what the frame holds: P pixels drawn
// (the render size), D display pixels, the covered share of P, T triangles and R clusters drawn,
// N placements the cut walks, L shadowed lights projected and the share of P they reach, the
// reflecting share of P. Each constant is the shipped code's, cited by the symbol that holds
// it (`sources`), and each formula is written from the constants its work counts. Compulsory work
// only: a data-dependent walk (a shadow ray's march past its first sample, a reflection ray's
// steps) is counted at its least, so what a pass takes above its floor (`floor.ts`) holds those
// walks. Pure.

import { FRAME_ROW_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'
import { MATRIX_VALUES } from '../../../packages/math/src/batch/strides.ts'
import { CLUSTER_INFO_BYTES } from '../../../packages/sdk-browser/src/geometry/dag/info/clusterInfoLayout.ts'
import { PLACEMENT_INFO_BYTES } from '../../../packages/sdk-browser/src/geometry/dag/info/placementInfoLayout.ts'
import { VISIBLE_RECORD_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.ts'
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/types.ts'
import { SHADOW_RULES } from '../../../packages/sdk-core/src/contracts/shadowOptions.ts'
import * as K from './passConstants.ts'
import { TAA_PASS_BYTES } from '../../runner/counts/taaPassBytes.ts'
import type { TaaPass } from '../../runner/counts/taaFetchCount.ts'
import { LIGHTING_PASSES } from './lightingPasses.ts'
import { REFLECTION_PASSES } from './reflectionPasses.ts'

/** The rays a pixel of a sun traces and the samples each takes past its first, at their defaults. */
const TRACE_RAYS = SHADOW_RULES.shadowRayCountDirectional.default
const TRACE_STEPS = SHADOW_RULES.shadowSamplesPerRayDirectional.default

/** Bytes of a placement's frame words (`FRAME_ROW_WORDS`). */
const ROW_BYTES = FRAME_ROW_WORDS * 4
/** Bytes the binning moves a visible cluster, compulsory work only: its record in the list, its
 *  cluster's and its placement's records and its root's world (doubles, two words a value), the
 *  decoded record written and read by the bins, and its instance word. */
const BINNING_BYTES =
  VISIBLE_RECORD_WORDS * 4 +
  CLUSTER_INFO_BYTES +
  PLACEMENT_INFO_BYTES +
  MATRIX_VALUES * 8 +
  2 * PAGE_INFO_STRIDE +
  4

/** The temporal passes, each its compute pass under its label (`TAA_*_PASS`, without the engine's
 *  prefix, as the bench names a pass): their bytes (`TAA_PASS_BYTES`) and fetches
 *  (`taaPassFetches`), which sum to the temporal pass's. The display layers' resolve runs only where
 *  a filtering blend is in the frame: none in the model's. */
const TAA_PASSES: ReadonlyArray<readonly [TaaPass, string]> = [
  ['measureFlickeringLuma', 'temporal measure flickering luma'],
  ['measureThinCoverage', 'temporal measure thin geometry coverage'],
  ['dilateVelocity', 'temporal dilate velocity'],
  ['decimateHistory', 'temporal decimate history'],
  ['detectThinGeometry', 'temporal detect thin geometry'],
  ['relaxThinGeometry', 'temporal thin geometry weight relaxation'],
  ['rejectShading', 'temporal reject shading'],
  ['spatialAntiAliasing', 'temporal spatial anti-aliasing'],
  ['updateHistory', 'temporal update history'],
  ['resolveHistory', 'temporal resolve history'],
  ['resolveDisplayLayers', 'temporal resolve display layers'],
]

export const PASSES: K.PassModel[] = [
  {
    label: 'DAG selection',
    formula: `(N + R)·${ROW_BYTES} B rows; ${K.DAG_FIXED_DISPATCHES} + ${K.DAG_LEVEL_DISPATCHES}·${K.DAG_LEVELS} levels dependent dispatches`,
    work: (f) => ({
      bytes: (f.N + f.R) * ROW_BYTES,
      passes: 1,
      dispatches: K.DAG_FIXED_DISPATCHES + K.DAG_LEVEL_DISPATCHES * K.DAG_LEVELS,
    }),
    sources: [
      K.engine('geometry/dag/encode.ts', 'encodeDagKernels'),
      K.engine('geometry/dag/types.ts', 'FRAME_ROW_WORDS'),
    ],
  },
  {
    label: 'raster binning',
    formula: `R·${BINNING_BYTES} B (record, cluster, placement, world, decoded record twice, instance); ${K.BINNING_DISPATCHES} dependent dispatches a raster pass`,
    work: (f) => ({
      bytes: f.R * BINNING_BYTES,
      passes: 2,
      dispatches: K.BINNING_DISPATCHES * 2,
    }),
    sources: [
      K.engine('visibility/bins/bins.ts', 'createGpuBins'),
      K.engine('visibility/decode/decode.ts', 'createGpuDecode'),
    ],
  },
  {
    label: 'visibility primary',
    formula: `T triangles; P·cover fragments; ${K.VISIBILITY_BYTES} B a pixel (u32 depth key + u32 id); the export writes ${K.SHADING_MASK_BYTES} B a pixel (shading mask)`,
    work: (f) => ({
      triangles: f.T,
      fragments: f.P * f.cover,
      bytes: (K.VISIBILITY_BYTES + K.SHADING_MASK_BYTES) * f.P,
      passes: 1,
    }),
    sources: [
      K.engine('visibility/raster/pixelWgsl.ts', 'visWriteWgsl'),
      K.engine('visibility/passes/pipelines.ts', 'VIS_DEPTH'),
    ],
  },
  {
    label: 'HiZ',
    formula:
      "the culling layer's build: 2P + 5·Σ coarser levels texels, 4 B each (the nearest layer and the finished depth's farthest are built in the reflections' pass)",
    work: (f) => ({ texels: K.hizCullTexels(f.P), bytes: 4 * K.hizCullTexels(f.P), passes: 1 }),
    sources: [
      K.engine('visibility/hiz/gpu/levelSizes.ts', 'hizLevelSizes'),
      { path: 'bench/runner/counts/frameBudgetRates.ts', symbol: 'hizCullAccesses' },
    ],
  },
  {
    label: 'material surfaces v1',
    formula: `the surfaces cleared: P·${K.SURFACE_BYTES} B`,
    work: (f) => ({ bytes: K.SURFACE_BYTES * f.P, passes: 1 }),
    sources: [K.engine('materials/surface/surfaceOutputs.ts', 'SURFACE_OUTPUTS')],
  },
  {
    label: 'material bins and shading',
    formula: `2P shading masks read (the export wrote them) and P·cover pixel words written then read (${K.BIN_WORD_BYTES} B each); P·cover·(4 B id + ${K.SURFACE_BYTES} B surfaces); ${K.SURFACE_FETCHES} fetches (id, 3 indices, 3×3 attributes)`,
    work: (f) => ({
      bytes:
        K.BIN_WORD_BYTES * (2 * f.P + 2 * f.P * f.cover) + f.P * f.cover * (4 + K.SURFACE_BYTES),
      texels: 2 * f.P + K.SURFACE_FETCHES * f.P * f.cover,
      passes: 1,
    }),
    sources: [
      K.engine('visibility/shader/shadeBinKernelsWgsl.ts', 'SHADE_BINS_SHADER'),
      K.engine('visibility/shader/shadeBinKernelsWgsl.ts', 'SHADE_BINS_SUBGROUP_SHADER'),
      { path: 'docs/ENGINE.md', symbol: 'Material surfaces' },
      K.engine('materials/surface/surfaceBuffer.ts', 'SURFACE_BYTES_PER_PIXEL'),
    ],
  },
  {
    label: 'vsm.marking',
    formula: `P/${K.MARK_STRIDE} pixels (a stride of 2 each way) × (depth 4 + normal 8 + flags 4 B, a light-grid cell) + page marks`,
    work: (f) => ({ bytes: (K.MARK_BYTES * f.P) / K.MARK_STRIDE, texels: f.P, passes: 1 }),
    sources: [
      K.engine('lighting/shadows/vsm/frame/vsmEncode.ts', 'encodeVsmFrame'),
      { path: 'docs/SHADOWS.md', symbol: 'One frame' },
    ],
  },
  {
    label: 'vsm.projection',
    formula: `P·cover·(${K.PROJECTION_BYTES} B + ${K.SCREEN_RAY} fetches) + P·cover·reach·L·(1 ray of ${TRACE_STEPS + 1} samples × ${K.SAMPLE_FETCHES} fetches) at least; up to ${TRACE_RAYS} rays; 8 B a pixel for the local lights' mask (16 lights of 4 bits)`,
    work: (f) => {
      const lit = f.P * f.cover
      const samples = lit * f.reach * f.L * (TRACE_STEPS + 1) * K.SAMPLE_FETCHES
      return {
        texels: lit * K.SCREEN_RAY + samples,
        bytes: lit * K.PROJECTION_BYTES + 8 * f.P,
        passes: 1,
      }
    },
    sources: [
      K.core('contracts/shadowMapOptions.ts', 'SHADOW_MAP_RULES'),
      K.engine('lighting/shadows/vsm/projection/projectionWgsl.ts', 'vsmProjectionGroups'),
    ],
  },
  ...LIGHTING_PASSES,
  ...REFLECTION_PASSES,
  ...TAA_PASSES.map(([pass, label]): K.PassModel => ({
    label,
    formula: `D·(${TAA_PASS_BYTES[pass].display} B + its fetches) + P·${TAA_PASS_BYTES[pass].render} B`,
    work: (f) => ({
      texels: f.D * K.taaPassFetches(f, pass),
      bytes: TAA_PASS_BYTES[pass].display * f.D + TAA_PASS_BYTES[pass].render * f.P,
      passes: TAA_PASS_BYTES[pass].display + TAA_PASS_BYTES[pass].render > 0 ? 1 : 0,
    }),
    sources: [
      K.engine('post/taa/analysisTargets.ts', 'analysisBytesPerPixel'),
      K.engine('post/taa/historyTargets.ts', 'taaTargetBytes'),
      { path: 'bench/runner/counts/taaFetchCount.ts', symbol: 'countTaaFetches' },
    ],
  })),
  {
    label: 'HDR composition + present',
    formula: `D·(${K.COMPOSE_READ} B read + ${K.COMPOSE_WRITE} B written)`,
    work: (f) => ({ bytes: (K.COMPOSE_READ + K.COMPOSE_WRITE) * f.D, texels: f.D, passes: 1 }),
    sources: [{ path: 'docs/ENGINE.md', symbol: 'Material surfaces' }],
  },
]
