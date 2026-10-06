import { fallbackBindEntries } from '../../core/fallbackEntries.ts'
import { entriesReady } from '../../core/bindIdentity.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import { projectedPageError, rootOf } from '../../../page/selection/selection.ts'
import {
  BASE_SLOTS,
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
} from '../../../gpu/draw/draw.ts'
import { visLayerPipelineIndex } from '../../visibility/pipelines.ts'
import { screenErrorColor } from '../../../diagnostic/colors.ts'
import { UNIFORM_STRIDE } from '../../blend/uniforms.ts'
import { PAGES_GREEN, clusterRgb, linearColor } from '../helpers.ts'
import { surfaceSide } from '../../../page/surface.ts'
import { windingCw } from '../render/winding.ts'
import type { WebgpuPagesCore } from '../runtime.ts'

/** The layout's selection roots, ranked by `rootOfPacked`. */
type Roots = Parameters<typeof windingCw>[0]

/** Layer 0's pipelines by half and face mode: the three untested ones, then their Hi-Z-tested
 *  twins. */
const VIS_SLOTS = [
  'visPipelineBack',
  'visPipelineNone',
  'visPipelineFront',
  'visHizRestBack',
  'visHizRestNone',
  'visHizRestFront',
] as const

export function pipelineFor(rt: WebgpuPagesCore, rec: PageRec, rank: number) {
  const side = surfaceSide(rec.material)
  if (side === 'double') return rt.gpu.pipelineNone
  return windingCw(rt.layout.selectionRoots, rank) ? rt.gpu.pipelineBackCw : rt.gpu.pipelineBack
}

/** Rank of a cluster's face mode in a layer set: back, none, front, inverted back, inverted front.
 *  The same order `LAYER_CULLS` builds. */
const visCullSlot = (rec: PageRec, rootRank: number, roots: Roots) => {
  const side = surfaceSide(rec.material)
  if (side === 'double') return 1
  const cw = windingCw(roots, rootRank)
  if (side === 'back') return cw ? 4 : 2
  return cw ? 3 : 0
}

/** Pipeline of an indirect slot: layer 0 keeps its own, each later layer has the same states plus
 *  its depth bias. A slot's face rank is its bin's face mode: a cutout slot draws with its face
 *  mode's pipeline, an opaque one with that pipeline's twin (`drawVis`). */
export function visSlotPipeline(rt: WebgpuPagesCore, slot: number) {
  const { vis } = rt
  const layer = Math.floor(slot / BASE_SLOTS),
    within = slot % BASE_SLOTS,
    rest = within >= HALF_SLOTS,
    cull = within % CULL_BINS
  if (layer === 0) return vis[VIS_SLOTS[(rest ? CULL_BINS : 0) + cull]]
  return vis.visLayerPipelines[visLayerPipelineIndex(layer, rest, cull)]
}

/** Pipeline of a cluster drawn WITHOUT indirect compaction. That path does not know the tested
 *  half: without compaction there is no partition, and the image fits in one pass. */
export function visPipelineFor(rt: WebgpuPagesCore, rec: PageRec, rank: number) {
  const { vis } = rt,
    roots = rt.layout.selectionRoots
  const layer = Math.min(rec.depthLayer, vis.drawLayerSlots - 1)
  if (layer > 0)
    return vis.visLayerPipelines[visLayerPipelineIndex(layer, false, visCullSlot(rec, rank, roots))]
  const side = surfaceSide(rec.material),
    cw = windingCw(roots, rank)
  if (side === 'double') return vis.visPipelineNone
  if (side === 'back') return cw ? vis.visPipelineFrontCw : vis.visPipelineFront
  return cw ? vis.visPipelineBackCw : vis.visPipelineBack
}

export const visBin = (rec: PageRec, rootRank: number, roots: Roots): 0 | 1 | 2 => {
  const side = surfaceSide(rec.material)
  if (side === 'double') return BIN_NONE
  // Indirect pipelines share ccw front faces; a reflection swaps which side
  // must be culled instead of requiring three more draw slots.
  return (side === 'back') !== windingCw(roots, rootRank) ? BIN_FRONT : BIN_BACK
}

/** Voids every fallback group when the layout or a resource their shared entries name changed
 *  identity. Read once before the fallback pass serves a group. */
export function voidStaleFallbackGroups(rt: WebgpuPagesCore) {
  const { gpu } = rt,
    identity = gpu.fallbackIdentity
  identity.entries[0] ??= fallbackBindEntries(rt)
  if (identity.entriesMoved(gpu.bindGroupLayout)) gpu.bindGroups.clear()
}

/** Position identity is the cache key; the fallback entry list governs every shared resource.
 *  A replaced position therefore gets its own group, independently of family invalidation. */
export function bindGroupFor(rt: WebgpuPagesCore, device: GPUDevice, position: GPUBuffer) {
  const { gpu } = rt
  let id = gpu.positionIds.get(position)
  if (!id) {
    id = gpu.nextPositionId++
    gpu.positionIds.set(position, id)
  }
  let group = gpu.bindGroups.get(id)
  // Readiness is read on the shared list, built once: a miss while a resource is absent allocates
  // nothing, and the item list below differs from it only by the position it is given.
  if (
    !group &&
    gpu.bindGroupLayout &&
    entriesReady((gpu.fallbackIdentity.entries[0] ??= fallbackBindEntries(rt)))
  ) {
    group = device.createBindGroup({
      layout: gpu.bindGroupLayout,
      entries: fallbackBindEntries(rt, { position }),
    })
    gpu.bindGroups.set(id, group)
  }
  return group
}

/** The fallback draw's uniforms, one `UNIFORM_STRIDE` block per draw, `bytes` in all. */
export const fallbackUniform = (device: GPUDevice, bytes: number) =>
  device.createBuffer({
    label: 'Trillion3D fallback uniforms',
    size: bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

export function ensureUniform(rt: WebgpuPagesCore, device: GPUDevice, draws: number) {
  const { gpu } = rt
  const bytes = Math.max(1, draws, rt.setup.cap) * UNIFORM_STRIDE
  if (!gpu.uniformBuffer || gpu.uniformBuffer.size < bytes) {
    gpu.uniformBuffer?.destroy()
    gpu.uniformBuffer = fallbackUniform(device, bytes)
  }
  if (gpu.uniformPacked.byteLength < bytes) gpu.uniformPacked = new Float32Array(bytes / 4)
}

export function pageRgb(rt: WebgpuPagesCore, rec: PageRec, rank: number): [number, number, number] {
  const { run } = rt
  if (run.diagnostic === 'beauty') return linearColor(rec.material)
  if (run.diagnostic === 'pages') return PAGES_GREEN
  if (run.diagnostic === 'lod')
    return rec.role === 'coarse' ? [0.95, 0.42, 0.05] : [0.04, 0.51, 0.94]
  if (run.diagnostic === 'visibility') return PAGES_GREEN
  if (run.diagnostic === 'screen-error')
    return run.lastCamera
      ? screenErrorColor(
          projectedPageError(
            rec,
            rootOf(rt.layout.selectionRoots, rank).world,
            run.gate.cam,
            rt.setup.viewport,
          ),
          run.diagnosticPixelError,
        )
      : [0, 1, 0.12]
  let rgb = rt.gpu.clusterRgbCache.get(rec.clusterId)
  if (!rgb) {
    rgb = clusterRgb(rec.clusterId)
    rt.gpu.clusterRgbCache.set(rec.clusterId, rgb)
  }
  return rgb
}
