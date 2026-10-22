import { retire } from '../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { createDownsampleChain } from '../../filters/downsampleChain.ts'
import { createGaussianTargets } from '../../filters/gaussianStage.ts'

/** The bloom's images, shared by every bloom of a chain (`createBloomTargets`). */
export type BloomTargets = ReturnType<typeof createBloomTargets>

/**
 * THE IMAGES EVERY BLOOM OF A CHAIN DRAWS ON: the setup's, the levels under it, and the two
 * targets of each level's blur. The blooms of a chain run one after the other, each finished with
 * its images before the next begins — the glow the last one leaves is the only one the
 * composition reads —, so one set serves them all, as many blooms as the chain holds. Their
 * sizes follow the scene's half-size image; the images are made as the first bloom asks and kept
 * while the size holds.
 */
export function createBloomTargets(device: GPUDevice) {
  const chain = createDownsampleChain(device, BLOOM_PASS)
  const stages = Array.from({ length: BLOOM_LEVEL_COUNT }, () =>
    createGaussianTargets(device, HDR_FORMAT, BLOOM_PASS),
  )
  let setup: { texture: GPUTexture; view: GPUTextureView; size: readonly number[] } | undefined
  const freeSetup = () => {
    if (setup) retire(device, setup.texture)
    setup = undefined
  }
  return {
    /** The chain under the setup's image: the levels 1 to 5. */
    chain,
    /** The two targets of each level's blur, finest first. */
    stages,
    /** The image the setup writes, a half-size image of `width × height` texels, made again when
     *  the size moves. */
    setupView(width: number, height: number) {
      if (setup && (setup.size[0] !== width || setup.size[1] !== height)) freeSetup()
      if (!setup) {
        const texture = device.createTexture({
          label: BLOOM_PASS,
          size: { width, height },
          format: HDR_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        setup = { texture, view: texture.createView(), size: [width, height] }
      }
      return setup.view
    },
    /** The setup's image and the chain under it, given back: a bloom that needs neither. */
    freeSetup() {
      if (!setup && !chain.bytes) return
      freeSetup()
      chain.dispose()
    },
    /** Bytes of every image. */
    get bytes() {
      let bytes = (setup ? madeTextureBytes(setup.texture) : 0) + chain.bytes
      for (let level = 0; level < BLOOM_LEVEL_COUNT; level++) bytes += stages[level].bytes
      return bytes
    },
    dispose() {
      freeSetup()
      chain.dispose()
      for (let level = 0; level < BLOOM_LEVEL_COUNT; level++) stages[level].dispose()
    },
  }
}
