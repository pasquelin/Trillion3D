import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts'
import { uniformStride } from '../residency/pools.ts'
import { levelSize, mipLevelCountFor } from './tiles.ts'
import { coveragePipelines, LEVEL_BIN_BYTES, pickGroup } from './coverageMips.ts'
import { heldBuffers } from '../gpu/core/heldBuffers.ts'
import { TEXTURE_MIPS_PASS } from './mipsPass.ts'
import {
  chainGroups,
  levelViews,
  type ChainGroups,
  type ChainPlace,
  type MipChain,
} from './mipGroups.ts'

export { levelViews }
export type { MipChain }

type Place = ChainPlace & { cutoff: number }

/** A batch's picks (`COVERAGE_CHOOSE_WGSL`): their group, the uniform stride, the first pick
 *  block, and the levels of each cutting chain, the most first. */
type Picks = { group: GPUBindGroup; stride: number; base: number; levels: number[] }

/**
 * The buffers of the batches — their uniforms, the coverage bins —, kept per device and label and
 * grown as needed (`heldBuffers.grow`). Creating then destroying one at every texture forced
 * waiting for the end of the device's work before releasing it — a full round trip of the GPU
 * queue per texture; one that lives as long as the device rewrites itself in queue order, waiting
 * for nothing.
 */
const batchBuffers = heldBuffers()
const held = (device: GPUDevice, label: string, size: number, usage: number) =>
  batchBuffers.grow(device, label, size, usage | GPUBufferUsage.COPY_DST)

/** Generates the mip chains of 2D textures: averaged colour, median alpha so that threshold
 * coverage survives every level, scaled to keep level 0's share at the cutoff when there is one.
 * A batch is one uniform write, one bin clear and one compute pass, in `encoder` when given —
 * which its owner submits before any other batch rewrites the held uniforms —, else in a submit of
 * its own: level by level across the chains, a level's counts, then its picks — one dispatch for
 * every chain that cuts —, then its reductions, each chain's bins its own. Commands are submitted
 * without being awaited: the device queue runs them in order, therefore before any copy that will
 * read a level. */
export function generateMaterialMips(
  device: GPUDevice,
  chains: MipChain[],
  encoder?: GPUCommandEncoder,
) {
  const places: Place[] = []
  let blocks = 0,
    binBytes = 0
  for (const chain of chains) {
    const levels = mipLevelCountFor(chain.width, chain.height),
      cutoff = chain.cutoff ?? 0
    if (levels === 1) continue
    places.push({ chain, levels, first: blocks, bins: cutoff ? binBytes : undefined, cutoff })
    blocks += levels
    if (cutoff) binBytes += levels * LEVEL_BIN_BYTES
  }
  if (!places.length) return
  const shared = sharedGpuDevice(device)
  const stride = uniformStride(device.limits)
  const cut = places.filter(({ cutoff }) => cutoff).sort((a, b) => b.levels - a.levels)
  const packed = packBlocks(places, blocks, stride, cut)
  const { UNIFORM, STORAGE } = GPUBufferUsage
  const uniforms = held(
    shared,
    'Trillion3D texture mips uniforms',
    packed.byteLength,
    UNIFORM | STORAGE,
  )
  device.queue.writeBuffer(uniforms, 0, packed)
  // The bins of every chain that cuts, one region each; a plain chain binds the first level's and
  // never reads it.
  const bins = held(
    shared,
    'Trillion3D coverage bins',
    Math.max(binBytes, LEVEL_BIN_BYTES),
    STORAGE,
  )
  const groups = places.map((place) =>
    chainGroups(device, shared, place, { uniforms, stride, bins }),
  )
  const levels = cut.map((place) => place.levels)
  const picks: Picks | undefined = cut.length
    ? { group: pickGroup(device, uniforms, bins), stride, base: blocks, levels }
    : undefined
  const own = encoder ?? device.createCommandEncoder()
  if (binBytes) own.clearBuffer(bins, 0, binBytes)
  const pass = own.beginComputePass({ label: TEXTURE_MIPS_PASS })
  encodeByLevel(device, pass, groups, picks)
  pass.end()
  if (!encoder) device.queue.submit([own.finish()])
}

/**
 * The batch's uniform words. A chain's block `first + level` holds its level's reduction: the
 * extent of the source level, so as not to read off the image, the cutoff and the chain's first
 * bin word; then level 0's extent and the level, for the counts and the `t` the reduction reads.
 * Its block `first` is level 0's own count. When a chain cuts, the pick blocks follow, one a level
 * — the level, the table's first word, the words a block, the chains reaching the level —, then
 * the table: each cutting chain's first block and levels, in `cut`'s order. Written word by word:
 * nothing allocated a level.
 */
function packBlocks(places: readonly Place[], blocks: number, stride: number, cut: Place[]) {
  const words = stride / 4,
    top = cut.length ? cut[0].levels : 0,
    table = (blocks + top) * words
  const packed = new Uint32Array(cut.length ? table + 2 * cut.length : blocks * words)
  for (const { chain, levels, first, cutoff, bins = 0 } of places)
    for (let level = 0; level < levels; level++) {
      const at = (first + level) * words,
        [width, height] = levelSize(chain.width, chain.height, Math.max(0, level - 1))
      packed[at] = width
      packed[at + 1] = height
      packed[at + 2] = cutoff
      packed[at + 3] = bins / 4
      packed[at + 4] = chain.width
      packed[at + 5] = chain.height
      packed[at + 6] = level
    }
  for (let level = 1, reach = cut.length; level < top; level++) {
    const at = (blocks + level) * words
    // The cutting chains reaching the level: the first ones, the most levels first.
    while (cut[reach - 1].levels <= level) reach--
    packed[at] = level
    packed[at + 1] = table
    packed[at + 2] = words
    packed[at + 3] = reach
  }
  cut.forEach(({ first, levels }, n) => {
    packed[table + 2 * n] = first
    packed[table + 2 * n + 1] = levels
  })
  return packed
}

const dispatch = (pass: GPUComputePassEncoder, [w, h]: readonly number[]) =>
  pass.dispatchWorkgroups(ceilDiv(w, 8), ceilDiv(h, 8))

/** The cutting chains that reach `level`: the first ones, the most levels first. */
const reaching = (levels: readonly number[], level: number) => {
  let n = 0
  while (n < levels.length && levels[n] > level) n++
  return n
}

/** The chains' dispatches, level by level: level `k` of every chain that has it — the counts of
 *  each that cuts (level 0's own first, at level 1), one pick dispatch for them all, then the
 *  reductions, which read the pick's `t` and level `k − 1` —, a pipeline set once per run of
 *  chains that share it. Each chain sees its own dispatches in the order it had alone. */
function encodeByLevel(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  chains: readonly ChainGroups[],
  picks?: Picks,
) {
  let top = 0
  for (const { levels } of chains) top = Math.max(top, levels)
  const coverage = picks ? coveragePipelines(device) : undefined
  for (let level = 1; level < top; level++) {
    const cutting = picks ? reaching(picks.levels, level) : 0
    if (coverage && picks && cutting) {
      pass.setPipeline(coverage.count)
      for (const { levels, counts, sizes } of chains) {
        if (!counts || level >= levels) continue
        if (level === 1) {
          pass.setBindGroup(0, counts[0])
          dispatch(pass, sizes[0])
        }
        pass.setBindGroup(0, counts[level])
        dispatch(pass, sizes[level])
      }
      pass.setPipeline(coverage.pick)
      pass.setBindGroup(0, picks.group, [(picks.base + level) * picks.stride])
      // A group a cutting chain.
      dispatchRows(pass, cutting)
    }
    let set: GPUComputePipeline | undefined
    for (const { levels, reduce, sizes, pipeline } of chains) {
      if (level >= levels) continue
      if (pipeline !== set) pass.setPipeline((set = pipeline))
      pass.setBindGroup(0, reduce[level - 1])
      dispatch(pass, sizes[level])
    }
  }
}

/** The uniform of a chain of `count` reductions over a `width × height` image — block `index`
 *  holds source level `index`'s size, then the image's — and a bind group per reduction, `group`
 *  given its block. A frame source keeps both; its owner admits the buffer before construction,
 *  and a group that throws releases it. */
export function reductionGroups(
  device: GPUDevice,
  label: string,
  [width, height]: readonly [number, number],
  count: number,
  group: (index: number, extent: GPUBufferBinding) => GPUBindGroup,
) {
  const stride = uniformStride(device.limits)
  const uniforms = device.createBuffer({
    label,
    size: Math.max(1, count) * stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  try {
    const packed = new Uint32Array(uniforms.size / 4)
    const groups = Array.from({ length: count }, (_, index) => {
      packed.set([...levelSize(width, height, index), width, height], (index * stride) / 4)
      return group(index, { buffer: uniforms, offset: index * stride, size: 16 })
    })
    device.queue.writeBuffer(uniforms, 0, packed)
    return { uniforms, groups }
  } catch (error) {
    uniforms.destroy()
    throw error
  }
}
