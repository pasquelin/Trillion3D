import { splitDouble } from '../../../../math/src/float/splitDouble.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  clipmapMipResolution,
  GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS as MAX,
  GLOBAL_DISTANCE_FIELD_MIP_PROPAGATION_STEPS as MIP_STEPS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { ALLOCATE_ENTRIES } from './allocateWgsl.ts'
import { ARGS_WORDS, CLIP_BLOCK, CLIP_BLOCK_BYTES } from './clipmapBlock.ts'
import { writeClipmapBlock, writePackedClipmap, writeUpdateBounds } from './clipmapUniforms.ts'
import { COMPOSE_ENTRY } from './composeWgsl.ts'
import { COVERAGE_ENTRY } from './coverageWgsl.ts'
import { OBJECT_GRID_ENTRY } from './objectGridWgsl.ts'
import { CULL_BLOCK, CULL_ENTRIES, OBJECT_COUNTS } from './cullWgsl.ts'
import type { GlobalGroups } from './globalGroups.ts'
import type { GlobalPipelines, StageKey } from './globalPipelines.ts'
import { UPDATE_BOUND_CAPACITY, type GlobalResources } from './globalResources.ts'
import { MIP_BLOCK, MIP_BLOCK_BYTES, MIP_ENTRIES } from './mipWgsl.ts'
import { CACHE_FULL, CACHE_STATIC } from './objectTracker.ts'
import type { Vec3 } from './regionBounds.ts'
import type { ClipmapPlan, RegionPlan } from './updateRegions.ts'

const RESET_PASS: GPUComputePassDescriptor = { label: 'Trillion3D global distance field reset' }
const STATIC_PASS: GPUComputePassDescriptor = {
  label: 'Trillion3D global distance field update, static',
}
const MOVABLE_PASS: GPUComputePassDescriptor = {
  label: 'Trillion3D global distance field update, movable',
}

/**
 * ONE FRAME OF THE GLOBAL DISTANCE FIELD'S UPDATE, encoded. Given the plan of the clipmaps
 * (`updateRegions.ts`), it writes the blocks, regions and records the passes read, then for each
 * cache — the static meshes first, then the movable ones over them — one compute pass whose
 * dispatches follow the stages in the order of the reference: the placements culled to the clipmaps,
 * the update regions turned into page tiles and culling cells, the placements culled to the cells,
 * the pages allocated, the free pages returned, the pages composited, their coverage written and flagged
 * (while a ray is marched through the field) and their object grid composited (while a pass reads it),
 * and, for the last cache, the coarse mip propagated. When the plan says the field begins again, the
 * page tables are filled with no page and the free list made first.
 */

/** What an update is encoded from. */
export interface UpdateContext {
  readonly device: GPUDevice
  readonly res: GlobalResources
  readonly pipelines: GlobalPipelines
  readonly groups: GlobalGroups
  readonly scene: GPUBindGroup
  readonly settings: GlobalDistanceFieldSettings
  readonly plan: RegionPlan
  /** The camera, centimetres. */
  readonly origin: Vec3
  /** The placements the scene holds. */
  readonly objects: number
  /** Whether the clipmaps flag the meshes not all streamed in. */
  readonly watch: boolean
  /** Whether rays are marched through the field: the pages composed have their coverage written and flagged
   *  where only two-sided meshes reach them (`coverageWgsl.ts`). */
  readonly traced: boolean
  /** Whether a pass reads the object grid: the pages composed have their object grid composited
   *  (`objectGridWgsl.ts`). */
  readonly grid: boolean
  /** Encodes, once the static cache's pass is, the copy of the flags the pass raised. */
  readonly afterStatic?: (encoder: GPUCommandEncoder) => void
}

const blockOffset = (cache: number, rank: number) => (cache * MAX + rank) * CLIP_BLOCK_BYTES
const stage = (ctx: UpdateContext, key: StageKey, entry: string) => ctx.pipelines.stage(key, entry)

/** Writes everything one cache's passes read, for its active clipmaps. */
function writeInputs(ctx: UpdateContext, cache: number, active: readonly ClipmapPlan[]) {
  const { device, res, settings } = ctx
  const block = new Float32Array(CLIP_BLOCK.words)
  const blockInts = new Uint32Array(block.buffer)
  const packed = new Float32Array(MAX * 12)
  const packedInts = new Uint32Array(packed.buffer)
  const separately = settings.globalDistanceFieldCacheMostlyStaticSeparately
  active.forEach((plan, rank) => {
    const boundsBase = (cache * MAX + rank) * UPDATE_BOUND_CAPACITY
    writeClipmapBlock(block, blockInts, 0, {
      settings,
      plan,
      rank,
      maxPages: res.maxPages,
      objectStride: res.objectStride,
      boundsBase,
      parent: separately && cache === CACHE_FULL,
    })
    device.queue.writeBuffer(res.blocks, blockOffset(cache, rank), block)
    const regions = new Float32Array(plan.updates.length * 8)
    writeUpdateBounds(regions, plan)
    device.queue.writeBuffer(res.bounds, boundsBase * 32, regions)
    writePackedClipmap(
      packed,
      packedInts,
      rank * 12,
      settings,
      plan,
      ctx.origin,
      ctx.watch && cache !== CACHE_FULL && plan.index < 2,
    )
  })
  device.queue.writeBuffer(res.packed, cache * MAX * 48, packed)
  writeCullBlock(ctx, cache, active.length)
}

/** The block of the culling of the placements to a cache's clipmaps. */
function writeCullBlock(ctx: UpdateContext, cache: number, clipmaps: number) {
  const words = new Float32Array(CULL_BLOCK.words)
  const ints = new Uint32Array(words.buffer)
  const at = CULL_BLOCK.at
  const separately = ctx.settings.globalDistanceFieldCacheMostlyStaticSeparately
  ints[at.acceptMobility] = !separately ? 2 : cache === CACHE_FULL ? 1 : 0
  ints[at.clipmaps] = clipmaps
  ints[at.objectStride] = ctx.res.objectStride
  ints[at.packedBase] = cache * MAX
  ctx.origin.forEach((c, k) => {
    const [high, low] = splitDouble(-c)
    words[at.translationHigh + k] = high
    words[at.translationLow + k] = low
  })
  ctx.device.queue.writeBuffer(ctx.res.cullBlocks, cache * CLIP_BLOCK_BYTES, words)
}

/** The clears a cache's passes start from: the counters, the list of culled placements, the grids' headers. */
function clearCache(encoder: GPUCommandEncoder, ctx: UpdateContext, clipmaps: number) {
  const { res } = ctx
  encoder.clearBuffer(res.control, 4)
  if (res.objects) encoder.clearBuffer(res.objects, 0, OBJECT_COUNTS * 4)
  for (let rank = 0; rank < clipmaps; rank++)
    encoder.clearBuffer(res.cull, rank * res.sizes.cull * 4, 2 * res.sizes.cullGrid * 4)
}

/** The page tables and the free list made anew. */
function encodeReset(encoder: GPUCommandEncoder, ctx: UpdateContext, offset: number) {
  const pass = encoder.beginComputePass(RESET_PASS)
  pass.setPipeline(stage(ctx, 'fill', MIP_ENTRIES.fill))
  for (const { group, size } of ctx.groups.fill) {
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(ceilDiv(size[0], 4), ceilDiv(size[1], 4), ceilDiv(size[2], 4))
  }
  pass.setPipeline(stage(ctx, 'lists', ALLOCATE_ENTRIES.init))
  pass.setBindGroup(0, ctx.groups.lists.updates, [offset])
  dispatchRows(pass, ceilDiv(ctx.res.maxPages, WORKGROUP_THREADS))
  pass.end()
}

/** The stages from the placements' culling to the allocation of the pages. */
function encodeCulling(
  pass: GPUComputePassEncoder,
  ctx: UpdateContext,
  cache: number,
  count: number,
) {
  const { groups, res } = ctx
  const lists = (entry: string, ranks: number) => {
    pass.setPipeline(stage(ctx, 'lists', entry))
    for (let rank = 0; rank < ranks; rank++) {
      pass.setBindGroup(0, groups.lists.updates, [blockOffset(cache, rank)])
      pass.dispatchWorkgroups(1)
    }
  }
  if (ctx.objects > 0) {
    pass.setPipeline(stage(ctx, 'cull', CULL_ENTRIES.clipmap))
    pass.setBindGroup(0, ctx.scene)
    pass.setBindGroup(1, groups.cull, [cache * CLIP_BLOCK_BYTES])
    dispatchRows(pass, ceilDiv(ctx.objects, WORKGROUP_THREADS))
  }
  pass.setPipeline(stage(ctx, 'tiles', CULL_ENTRIES.tiles))
  for (let rank = 0; rank < count; rank++) {
    pass.setBindGroup(0, groups.tiles, [blockOffset(cache, rank)])
    pass.dispatchWorkgroups(res.sizes.cells, res.sizes.cells, res.sizes.cells)
  }
  lists(ALLOCATE_ENTRIES.updateArgs, count)
  if (ctx.objects > 0) {
    pass.setPipeline(stage(ctx, 'grid', CULL_ENTRIES.grid))
    pass.setBindGroup(0, ctx.scene)
    for (let rank = 0; rank < count; rank++) {
      pass.setBindGroup(1, groups.grid, [blockOffset(cache, rank)])
      pass.dispatchWorkgroupsIndirect(res.args, (rank * ARGS_WORDS + 3) * 4)
    }
  }
}

/** The stages from the allocation of the pages to their composition. */
function encodeComposition(
  pass: GPUComputePassEncoder,
  ctx: UpdateContext,
  cache: number,
  count: number,
) {
  const { groups, res } = ctx
  const own = cache === CACHE_STATIC ? groups.static : groups.full
  pass.setPipeline(stage(ctx, 'allocate', ALLOCATE_ENTRIES.allocate))
  pass.setBindGroup(0, ctx.scene)
  for (let rank = 0; rank < count; rank++) {
    pass.setBindGroup(1, own.allocate, [blockOffset(cache, rank)])
    pass.dispatchWorkgroupsIndirect(res.args, rank * ARGS_WORDS * 4)
  }
  pass.setPipeline(stage(ctx, 'lists', ALLOCATE_ENTRIES.returnArgs))
  pass.setBindGroup(0, groups.lists.returned, [blockOffset(cache, 0)])
  pass.dispatchWorkgroups(1)
  pass.setPipeline(stage(ctx, 'lists', ALLOCATE_ENTRIES.returnPages))
  pass.setBindGroup(0, groups.lists.idle, [blockOffset(cache, 0)])
  pass.dispatchWorkgroupsIndirect(res.returnArgs, 9 * 4)
  pass.setPipeline(stage(ctx, 'lists', ALLOCATE_ENTRIES.composeArgs))
  for (let rank = 0; rank < count; rank++) {
    pass.setBindGroup(0, groups.lists.updates, [blockOffset(cache, rank)])
    pass.dispatchWorkgroups(1)
  }
  if (ctx.objects === 0) return
  pass.setPipeline(stage(ctx, 'compose', COMPOSE_ENTRY))
  pass.setBindGroup(0, ctx.scene)
  for (let rank = 0; rank < count; rank++) {
    pass.setBindGroup(1, own.compose, [blockOffset(cache, rank)])
    pass.dispatchWorkgroupsIndirect(res.args, (rank * ARGS_WORDS + 6) * 4)
  }
  for (const [key, entry, bound, wanted] of [
    ['coverage', COVERAGE_ENTRY, own.coverage, ctx.traced],
    ['objectGrid', OBJECT_GRID_ENTRY, own.objectGrid, ctx.grid],
  ] as const) {
    if (!wanted) continue
    pass.setPipeline(stage(ctx, key, entry))
    pass.setBindGroup(0, ctx.scene)
    for (let rank = 0; rank < count; rank++) {
      pass.setBindGroup(1, bound, [blockOffset(cache, rank)])
      pass.dispatchWorkgroupsIndirect(res.args, (rank * ARGS_WORDS + 12) * 4)
    }
  }
}

/** The coarse mip of the clipmaps: five propagations, the first from the pages. */
function encodeMips(
  pass: GPUComputePassEncoder,
  ctx: UpdateContext,
  active: readonly ClipmapPlan[],
) {
  const { settings, res, groups } = ctx
  const size = clipmapMipResolution(settings)
  const factor = settings.globalDistanceFieldMipFactor
  const words = new Float32Array(MIP_BLOCK.words)
  const ints = new Uint32Array(words.buffer)
  const at = MIP_BLOCK.at
  for (const plan of active)
    for (const readPages of [0, 1]) {
      ints[at.resolution] = size
      ints[at.clipmap] = plan.index
      ints[at.offsetZ] = plan.index * size
      ints[at.pagesAlong] = res.pages
      plan.scroll.forEach((s, k) => (words[at.scroll + k] = s / (2 * plan.extent)))
      words[at.invResolution] = 1 / size
      ints[at.readPages] = readPages
      words[at.scale] = 1 / factor
      words[at.bias] = 0.5 - 0.5 / factor
      ctx.device.queue.writeBuffer(
        res.mipBlocks,
        (plan.index * 2 + readPages) * MIP_BLOCK_BYTES,
        words,
      )
    }
  pass.setPipeline(stage(ctx, 'mip', MIP_ENTRIES.propagate))
  for (let step = 0; step < MIP_STEPS; step++) {
    for (const plan of active) {
      pass.setBindGroup(0, step % 2 === 0 ? groups.mip.intoMip : groups.mip.intoTemp, [
        (plan.index * 2 + (step === 0 ? 1 : 0)) * MIP_BLOCK_BYTES,
      ])
      pass.dispatchWorkgroups(ceilDiv(size, 4), ceilDiv(size, 4), ceilDiv(size, 4))
    }
  }
}

/**
 * Encodes the frame's update on `encoder`: the passes of the caches that have regions to composite.
 * Returns whether any pass was encoded.
 */
export function encodeGlobalUpdate(encoder: GPUCommandEncoder, ctx: UpdateContext) {
  const separately = ctx.settings.globalDistanceFieldCacheMostlyStaticSeparately
  const caches = (separately ? [CACHE_STATIC, CACHE_FULL] : [CACHE_FULL]).map((cache) => ({
    cache,
    active: ctx.plan.caches[cache].filter((plan) => plan.updates.length > 0),
  }))
  const first = caches.find(({ active }) => active.length > 0)
  if (!first) return false
  if (ctx.plan.reset) encodeReset(encoder, ctx, blockOffset(first.cache, 0))
  for (const { cache, active } of caches) {
    if (!active.length) continue
    writeInputs(ctx, cache, active)
    clearCache(encoder, ctx, active.length)
    const pass = encoder.beginComputePass(cache === CACHE_STATIC ? STATIC_PASS : MOVABLE_PASS)
    encodeCulling(pass, ctx, cache, active.length)
    encodeComposition(pass, ctx, cache, active.length)
    if (cache === CACHE_FULL) encodeMips(pass, ctx, active)
    pass.end()
    if (cache === CACHE_STATIC) ctx.afterStatic?.(encoder)
  }
  return true
}
