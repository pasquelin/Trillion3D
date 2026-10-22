import { BLOOM_LEVEL_COUNT } from '../../../../../sdk-core/src/contracts/bloomOptions.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { createDownsampleChain } from '../../filters/downsampleChain.ts'
import { createGaussianTargets } from '../../filters/gaussianStage.ts'
import { sizedImage } from '../../filters/sizedImage.ts'
import { createConvolutionTargets } from './convolution/convolutionTargets.ts'
import { createDirtMask } from './dirtMask.ts'

/** The bloom's images, shared by every bloom of a chain (`createBloomTargets`). */
export type BloomTargets = ReturnType<typeof createBloomTargets>

/**
 * THE IMAGES EVERY BLOOM OF A CHAIN DRAWS ON: the setup's, the levels under it, and the two
 * targets of each level's blur. The blooms of a chain run one after the other, each finished with
 * its images before the next begins — the glow the last one leaves is the only one the
 * composition reads —, so one set serves them all, as many blooms as the chain holds. Their
 * sizes follow the scene's half-size image; the images are made as the first bloom asks and kept
 * while the size holds. The convolution's images (`convolution`) and the dirt mask (`dirtMask`)
 * are made when a bloom draws one, and given back when none does.
 */
export function createBloomTargets(device: GPUDevice) {
  const chain = createDownsampleChain(device, BLOOM_PASS)
  const stages = Array.from({ length: BLOOM_LEVEL_COUNT }, () =>
    createGaussianTargets(device, HDR_FORMAT, BLOOM_PASS),
  )
  const convolution = createConvolutionTargets(device)
  const setup = sizedImage(
    device,
    BLOOM_PASS,
    HDR_FORMAT,
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  )
  const dirt = createDirtMask(device)
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
      setup.release()
      chain.dispose()
    },
    /** The images the convolutions draw through, given back by `freeConvolution`: no bloom draws
     *  one. */
    convolution,
    freeConvolution: convolution.dispose,
    /** The dirt mask on the device, made at the first picture a bloom shows; `freeDirt` gives it
     *  back when none does. */
    dirtMask: dirt,
    freeDirt: dirt.release,
    /** Bytes of every image. */
    get bytes() {
      let bytes = setup.bytes + chain.bytes + convolution.bytes + dirt.bytes
      for (let level = 0; level < BLOOM_LEVEL_COUNT; level++) bytes += stages[level].bytes
      return bytes
    },
    dispose() {
      setup.release()
      chain.dispose()
      for (let level = 0; level < BLOOM_LEVEL_COUNT; level++) stages[level].dispose()
      convolution.dispose()
      dirt.release()
    },
  }
}
