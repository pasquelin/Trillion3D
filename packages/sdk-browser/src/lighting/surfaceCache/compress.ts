import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { CapturePage } from '../../../../sdk-core/src/lighting/surfaceCache/captures.ts'
import { SURFACE_CACHE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { computeBufferEntry } from '../../gpu/core/computeBindings.ts'
import { BLOCK_FEATURES } from '../../materials/texture/blockFormats.ts'
import type { SurfaceAtlases } from './atlases.ts'
import { createKernel } from './kernel.ts'
import { CLEAR_BLOCKS_WGSL, CLEAR_GROUP } from './compressWgsl.ts'
import { BLOCK, BLOCK_LAYERS, CAPTURE_PARAMS, stagingOf } from './layout.ts'

/**
 * THE COMPRESSED ATLAS, ON THE HOST. A block-compressed texture is no storage texture, and WebGPU has
 * no view of it in another format to write through: the blocks are made in a storage buffer by the
 * encoders (`compressWgsl.ts`) and copied in, a copy of the rectangle of each page for each layer
 * (`copyBlockPages`). The copy is a command of the encoder, outside the compute pass: it is encoded after
 * the pass that wrote the blocks, and the atlas it writes is read by the passes after it.
 *
 * Block-compressed copies (https://www.w3.org/TR/webgpu/#texel-copies): the texture's origin and the
 * copy's size are whole blocks (4 texels), the buffer offset a multiple of a block's 16 bytes and the
 * row stride of the buffer a multiple of 256 — `stagingOf` lays every section so; the texture needs
 * `COPY_DST` and the device the feature `texture-compression-bc`
 * (https://www.w3.org/TR/webgpu/#texture-compression-bc).
 */

/** Whether the atlas is kept compressed, and why not where it is not: `mode` is
 *  `surfaceCacheCompress`. Mode 0 never compresses; mode 1 writes the atlas through a view of another
 *  format, which a device cannot do on this API, and compresses nothing; mode 2 compresses by copy where
 *  the device has the block formats. */
export function atlasCompression(
  device: Pick<GPUDevice, 'features'>,
  mode: number,
): { compressed: boolean; why: string | null } {
  if (mode === 0) return { compressed: false, why: 'surfaceCacheCompress is 0' }
  if (mode === 1)
    return {
      compressed: false,
      why: 'surfaceCacheCompress 1 writes the atlas through a view of another format, which WebGPU cannot do (2 compresses by copy)',
    }
  if (!device.features.has(BLOCK_FEATURES.bc7))
    return { compressed: false, why: `the device lacks ${BLOCK_FEATURES.bc7}` }
  return { compressed: true, why: null }
}

/**
 * Copies the blocks the encoders wrote for `pages` from the staging buffer into the compressed layers of
 * `atlases`, on `encoder`: for each layer, the blocks of each page's rectangle of the capture atlas to
 * the page's rectangle of the atlas. Nothing for an atlas that is not compressed.
 */
export function copyBlockPages(
  encoder: GPUCommandEncoder,
  atlases: SurfaceAtlases,
  pages: readonly CapturePage[],
) {
  const { blocks, captureSide } = atlases
  if (!blocks) return
  const { rowBytes, layerBytes } = stagingOf(captureSide)
  BLOCK_LAYERS.forEach((layer, section) => {
    for (const { captureRect: from, atlasRect: to } of pages)
      encoder.copyBufferToTexture(
        {
          buffer: blocks.staging,
          offset:
            section * layerBytes +
            (from.minY / BLOCK.texels) * rowBytes +
            (from.minX / BLOCK.texels) * BLOCK.bytes,
          bytesPerRow: rowBytes,
        },
        { texture: blocks.textures[layer], origin: [to.minX, to.minY] },
        [from.maxX - from.minX, from.maxY - from.minY],
      )
  })
}

/** The program that clears the compressed layers, on `device`, and the copies that carry its blocks over
 *  the atlas. */
export function createBlockClear(device: GPUDevice) {
  const label = 'Trillion3D surface cache clear blocks'
  const kernel = createKernel(
    device,
    'clear blocks',
    CLEAR_BLOCKS_WGSL,
    ['clearBlocks'],
    [computeBufferEntry(7, 'storage')],
    { parameterBytes: CAPTURE_PARAMS.words * 4 },
  )
  const params = device.createBuffer({
    label: `${label} parameters`,
    size: CAPTURE_PARAMS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(CAPTURE_PARAMS.words)
  return {
    /** Whether the program is compiled. */
    get ready() {
      return kernel.ready
    },
    /**
     * Clears the compressed layers of `atlases` on `encoder`: the block of a cleared texel written in
     * every block of the staging buffer, in a compute pass, then copied over the atlas, a square of the
     * capture atlas's size at a time (the last of a row or a column cut to the atlas's edge).
     */
    encode(encoder: GPUCommandEncoder, atlases: SurfaceAtlases) {
      const { blocks, captureSide, side } = atlases
      if (!blocks || !kernel.ready) return
      const { across, rowBytes, layerBytes } = stagingOf(captureSide)
      words[CAPTURE_PARAMS.at.captureSide] = captureSide
      device.queue.writeBuffer(params, 0, words)
      const group = kernel.group([blocks.staging], () => [
        { binding: 0, resource: { buffer: params } },
        { binding: 7, resource: { buffer: blocks.staging } },
      ])
      const pass = encoder.beginComputePass({ label: SURFACE_CACHE_PASS })
      pass.setPipeline(kernel.pipeline('clearBlocks'))
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(ceilDiv(across, CLEAR_GROUP), ceilDiv(across, CLEAR_GROUP))
      pass.end()
      BLOCK_LAYERS.forEach((layer, section) => {
        for (let y = 0; y < side; y += captureSide)
          for (let x = 0; x < side; x += captureSide)
            encoder.copyBufferToTexture(
              { buffer: blocks.staging, offset: section * layerBytes, bytesPerRow: rowBytes },
              { texture: blocks.textures[layer], origin: [x, y] },
              [Math.min(captureSide, side - x), Math.min(captureSide, side - y)],
            )
      })
    },
    dispose() {
      params.destroy()
    },
  }
}
