import type { Bloom } from '../../../../../sdk-core/src/world/effect/bloom.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { uniformBlock, type UniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { fullscreenDraw } from '../../filters/fullscreenDraw.ts'
import type { PostFrame } from '../../finish/finish.ts'
import type { createBloomPrograms } from './bloomPrograms.ts'
import type { BloomTargets } from './bloomTargets.ts'
import { BLOOM_SETUP, BLOOM_SETUP_BYTES } from './bloomWgsl.ts'

type BloomPrograms = Awaited<ReturnType<typeof createBloomPrograms>>
type BloomFilters = BloomPrograms['filters']

/**
 * THE BLOOM'S SETUP UNIFORM AND GROUP: the group reading the half-size image through the filters'
 * layout, and the uniform written — the words that changed — when the size, the threshold or the
 * layers move. Made at the first ask, kept while they hold.
 */
function createSetupGroup(device: GPUDevice, filters: BloomFilters) {
  const identity = createWebgpuBindIdentity()
  let block: UniformBlock | undefined, group: GPUBindGroup | undefined
  return {
    /** The setup's group over the half-size image `first` of `width × height` texels, its uniform
     *  written for the threshold and the layers. */
    group(first: GPUTextureView, width: number, height: number, threshold: number, layers: number) {
      block ??= uniformBlock(device, BLOOM_PASS, BLOOM_SETUP_BYTES)
      const { f } = block.words,
        at = BLOOM_SETUP.at
      f[at.outTexel] = 1 / width
      f[at.outTexel + 1] = 1 / height
      f[at.threshold] = threshold
      f[at.layers] = layers
      block.send()
      identity.next[0] = first
      identity.next[1] = block.buffer
      if (identity.moved()) {
        group = device.createBindGroup({
          layout: filters.layouts.down,
          entries: sequentialEntries([
            first,
            filters.clamped,
            { buffer: block.buffer, size: BLOOM_SETUP_BYTES },
          ]),
        })
      }
      return group!
    },
    release() {
      if (block) retire(device, block.buffer)
      block = group = undefined
      identity.clear()
    },
  }
}

/**
 * THE BLOOM'S SETUP: the half-size image brought through its local exposure and its threshold into
 * an image of its own, and the levels of the chain under it (`BloomTargets`).
 */
export function createBloomSetup(
  device: GPUDevice,
  programs: BloomPrograms,
  targets: BloomTargets,
) {
  const group = createSetupGroup(device, programs.filters)
  const draw = fullscreenDraw(BLOOM_PASS)
  return {
    /** Draws the setup of the half-size image of the scene's chain `post` shares, and the chain
     *  under it, the local exposure applied where `local`; returns the setup's image. */
    encode(encoder: GPUCommandEncoder, bloom: Bloom, post: PostFrame, local: boolean) {
      const { scene } = post,
        half = scene.size(0)
      const image = targets.setupView(half[0], half[1])
      const reads = group.group(scene.view(0)!, half[0], half[1], bloom.threshold, Number(local))
      draw(encoder, image, programs.setup, reads, post.layers)
      targets.chain.resize(half[0], half[1], BLOOM_LEVEL_COUNT)
      targets.chain.encode(encoder, image, BLOOM_LEVEL_COUNT)
      return image
    },
    release: group.release,
  }
}
