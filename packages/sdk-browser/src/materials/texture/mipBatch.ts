import { previewLevelSize } from '../../../../sdk-core/src/texture/previewLevels.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { sharedGpuDevice } from '../../gpu/core/sessionHandle.ts'
import { uniformSlots, type UniformSlots } from '../../session/memory/pools.ts'
import { mipLevelCountFor } from './tiles.ts'
import { heldBuffers } from '../../gpu/core/heldBuffers.ts'
import { TEXTURE_MIPS_PASS } from './mipsPass.ts'
import {
  chainGroups,
  LEVEL_BYTES,
  type ChainGroups,
  type ChainPlace,
  type MipChain,
} from './mipGroups.ts'

const PASS: GPUComputePassDescriptor = { label: TEXTURE_MIPS_PASS }

/** Words a chain's level block holds (`packBlocks`): the source level's extent. */
const BLOCK_WORDS = LEVEL_BYTES / 4

/**
 * The buffer of the batches — their uniforms —, kept per device and label and grown as needed
 * (`heldBuffers.grow`). Creating then destroying one at every texture forced waiting for the end
 * of the device's work before releasing it — a full round trip of the GPU queue per texture; one
 * that lives as long as the device rewrites itself in queue order, waiting for nothing.
 */
const batchBuffers = heldBuffers()

/** Generates the mip chains of 2D textures: every channel the mean of the four texels, colours
 * in linear light. A batch is one uniform write and one compute pass, in `encoder` when given —
 * which its owner submits before any other batch rewrites the held uniforms —, else in a submit of
 * its own: level by level across the chains. Commands are submitted without being awaited: the
 * device queue runs them in order, therefore before any copy that will read a level. */
export function generateMaterialMips(
  device: GPUDevice,
  chains: MipChain[],
  encoder?: GPUCommandEncoder,
) {
  const places: ChainPlace[] = []
  let blocks = 0
  for (const chain of chains) {
    const levels = mipLevelCountFor(chain.width, chain.height)
    // A single level reduces nothing; it takes the batch only for its turn.
    if (levels === 1 && !chain.turn) continue
    places.push({ chain, levels, first: blocks })
    blocks += levels
  }
  if (!places.length) return
  const shared = sharedGpuDevice(device)
  const slots = uniformSlots(device.limits, blocks, BLOCK_WORDS)
  const packed = packBlocks(places, blocks, slots)
  const uniforms = batchBuffers.grow(
    shared,
    'Trillion3D texture mips uniforms',
    packed.byteLength,
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  )
  device.queue.writeBuffer(uniforms, 0, packed)
  const groups = places.map((place) =>
    chainGroups(device, shared, place, { uniforms, stride: slots.stride }),
  )
  const own = encoder ?? device.createCommandEncoder()
  const pass = own.beginComputePass(PASS)
  encodeByLevel(pass, groups)
  pass.end()
  if (!encoder) device.queue.submit([own.finish()])
}

/**
 * The batch's uniform words. A chain's block `first + level` holds its level's reduction: the
 * extent of the source level, so as not to read off the image. Written word by word: nothing
 * allocated a level.
 */
function packBlocks(places: readonly ChainPlace[], blocks: number, slots: UniformSlots) {
  const words = slots.strideWords
  const packed = new Uint32Array(blocks * words)
  for (const { chain, levels, first } of places)
    for (let level = 0; level < levels; level++) {
      const at = (first + level) * words,
        [width, height] = previewLevelSize(chain.width, chain.height, Math.max(0, level - 1))
      packed[at] = width
      packed[at + 1] = height
    }
  return packed
}

const dispatch = (pass: GPUComputePassEncoder, [w, h]: readonly number[]) =>
  pass.dispatchWorkgroups(ceilDiv(w, 8), ceilDiv(h, 8))

/** The chains' dispatches, level by level: level `k` of every chain that has it, which reads level
 *  `k − 1`, a pipeline set once per run of chains that share it. Each chain sees its own dispatches
 *  in the order it had alone. */
function encodeByLevel(pass: GPUComputePassEncoder, chains: readonly ChainGroups[]) {
  let top = 0
  for (const { levels } of chains) top = Math.max(top, levels)
  // Level 0 of the raw texels that ask a turn, before any level reads it.
  for (const { turn, sizes } of chains)
    if (turn?.pipeline) {
      pass.setPipeline(turn.pipeline)
      pass.setBindGroup(0, turn.group)
      dispatch(pass, sizes[0])
    }
  for (let level = 1; level < top; level++) {
    let set: GPUComputePipeline | undefined
    for (const { levels, reduce, sizes, pipeline } of chains) {
      if (level >= levels || !pipeline) continue
      if (pipeline !== set) pass.setPipeline((set = pipeline))
      pass.setBindGroup(0, reduce[level - 1])
      dispatch(pass, sizes[level])
    }
  }
}
