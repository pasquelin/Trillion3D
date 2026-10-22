import { retire } from '../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { createDownsampleChain } from '../../filters/downsampleChain.ts'
import { createGaussianTargets } from '../../filters/gaussianStage.ts'
import { createConvolutionTargets } from './convolution/convolutionTargets.ts'
import { createGlowFinish } from './glowFinish.ts'

/** The bloom's images, shared by every bloom of a chain (`createBloomTargets`). */
export type BloomTargets = ReturnType<typeof createBloomTargets>

/** The image the setup writes, a half-size image made again when its size moves. */
function createSetupImage(device: GPUDevice) {
  let held: { texture: GPUTexture; view: GPUTextureView; size: readonly number[] } | undefined
  const free = () => {
    if (held) retire(device, held.texture)
    held = undefined
  }
  return {
    view(width: number, height: number) {
      if (held && (held.size[0] !== width || held.size[1] !== height)) free()
      if (!held) {
        const texture = device.createTexture({
          label: BLOOM_PASS,
          size: { width, height },
          format: HDR_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        held = { texture, view: texture.createView(), size: [width, height] }
      }
      return held.view
    },
    get bytes() {
      return held ? madeTextureBytes(held.texture) : 0
    },
    free,
  }
}

/**
 * THE IMAGES EVERY BLOOM OF A CHAIN DRAWS ON: the setup's, the levels under it, and the two
 * targets of each level's blur. The blooms of a chain run one after the other, each finished with
 * its images before the next begins — the glow the last one leaves is the only one the
 * composition reads —, so one set serves them all, as many blooms as the chain holds. Their
 * sizes follow the scene's half-size image; the images are made as the first bloom asks and kept
 * while the size holds. The convolution's images (`convolution`) and the finished glow
 * (`glowFinish`) are made when a bloom draws one, and given back when none does.
 */
export function createBloomTargets(device: GPUDevice) {
  const chain = createDownsampleChain(device, BLOOM_PASS)
  const stages = Array.from({ length: BLOOM_LEVEL_COUNT }, () =>
    createGaussianTargets(device, HDR_FORMAT, BLOOM_PASS),
  )
  const convolution = createConvolutionTargets(device)
  const setup = createSetupImage(device)
  let finish: ReturnType<typeof createGlowFinish> | undefined
  return {
    /** The chain under the setup's image: the levels 1 to 5. */
    chain,
    /** The two targets of each level's blur, finest first. */
    stages,
    /** The image the setup writes, a half-size image of `width × height` texels, made again when
     *  the size moves. */
    setupView: setup.view,
    /** The setup's image and the chain under it, given back: a bloom that needs neither. */
    freeSetup() {
      if (!setup.bytes && !chain.bytes) return
      setup.free()
      chain.dispose()
    },
    /** The images the convolutions draw through, given back by `freeConvolution`: no bloom draws
     *  one. */
    convolution,
    freeConvolution: convolution.dispose,
    /** The pass that finishes a glow: the dirt mask and the light the image gives up, made at the
     *  first ask, and given back by `freeFinish`. */
    glowFinish() {
      return (finish ??= createGlowFinish(device))
    },
    freeFinish() {
      finish?.dispose()
      finish = undefined
    },
    /** Bytes of every image. */
    get bytes() {
      let bytes = setup.bytes + chain.bytes + convolution.bytes + (finish?.bytes ?? 0)
      for (let level = 0; level < BLOOM_LEVEL_COUNT; level++) bytes += stages[level].bytes
      return bytes
    },
    dispose() {
      setup.free()
      chain.dispose()
      for (let level = 0; level < BLOOM_LEVEL_COUNT; level++) stages[level].dispose()
      convolution.dispose()
      finish?.dispose()
    },
  }
}
