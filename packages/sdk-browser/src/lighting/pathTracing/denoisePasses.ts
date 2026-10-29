import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { DenoiseGpu } from './denoiseGpu.ts'
import type { DenoiseKernel } from './denoisePipelines.ts'

/** The fields of the uniform every denoiser kernel reads (`DnParams`), the ones a pass leaves out being 0. */
export interface DenoiseParams {
  mip?: number
  patchId?: number
  patchCount?: number
  metric?: number
  flags?: number
  iteration?: number
  kappa?: number
  eta?: number
  alpha?: number
  cutoff?: number
}

/** A resource a pass binds, by the binding it takes. */
export interface DenoiseBinding {
  readonly binding: number
  readonly resource: GPUBindingResource
}

/** The views of a texture a pass binds: one level of its chain, or a layer of one level, or the layers of one level (or all). */
export const levelView = (texture: GPUTexture, level: number) =>
  texture.createView({ baseMipLevel: level, mipLevelCount: 1 })
export const layerView = (texture: GPUTexture, layer: number, level: number) =>
  texture.createView({
    dimension: '2d',
    baseArrayLayer: layer,
    arrayLayerCount: 1,
    baseMipLevel: level,
    mipLevelCount: 1,
  })
export const arrayView = (texture: GPUTexture, level?: number) =>
  texture.createView({
    dimension: '2d-array',
    ...(level !== undefined && { baseMipLevel: level, mipLevelCount: 1 }),
  })

/**
 * THE DENOISER'S DISPATCHES of one image, in one compute pass: each (`run`) takes the next slot of the parameters' buffer, binds the slot and the kernel's resources, and dispatches over the
 * `width` by `height` (by `depth`) pixels in groups of 8 by 8. The parameters are written to the buffer once, at `finish`, before the commands run.
 */
export class DenoisePasses {
  private slot = 0
  private pass: GPUComputePassEncoder | undefined
  private readonly device: GPUDevice
  private readonly encoder: GPUCommandEncoder
  private readonly dgpu: DenoiseGpu
  private readonly exposure: number

  constructor(device: GPUDevice, encoder: GPUCommandEncoder, dgpu: DenoiseGpu, exposure: number) {
    this.device = device
    this.encoder = encoder
    this.dgpu = dgpu
    this.exposure = exposure
  }

  run(
    kernel: DenoiseKernel,
    params: DenoiseParams,
    entries: readonly DenoiseBinding[],
    width: number,
    height: number,
    depth = 1,
  ) {
    if (this.slot >= this.dgpu.slots)
      throw new RangeError('the denoiser ran out of parameter slots')
    const at = this.slot++ * this.dgpu.slotBytes
    const ints = new Uint32Array(this.dgpu.words, at, 16)
    const floats = new Float32Array(this.dgpu.words, at, 16)
    const [sizeX, sizeY] = this.dgpu.size
    ints.set([
      sizeX,
      sizeY,
      params.mip ?? 0,
      params.patchId ?? 0,
      params.patchCount ?? 1,
      params.metric ?? 0,
      params.flags ?? 0,
      params.iteration ?? 0,
    ])
    floats.set(
      [this.exposure, params.kappa ?? 0, params.eta ?? 0, params.alpha ?? 0, params.cutoff ?? 0],
      8,
    )
    const pipeline = kernel.pipeline.get()
    if (!pipeline) return
    const pass = (this.pass ??= this.encoder.beginComputePass({
      label: 'Trillion3D path tracer denoiser',
    }))
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      this.device.createBindGroup({
        layout: kernel.layout,
        entries: [
          { binding: 0, resource: { buffer: this.dgpu.params, offset: at, size: 64 } },
          ...entries,
        ],
      }),
    )
    pass.dispatchWorkgroups(ceilDiv(width, 8), ceilDiv(height, 8), depth)
  }

  /** Ends the pass and writes the parameters the dispatches read. */
  finish() {
    if (!this.pass) return
    this.pass.end()
    this.device.queue.writeBuffer(
      this.dgpu.params,
      0,
      this.dgpu.words,
      0,
      this.slot * this.dgpu.slotBytes,
    )
  }
}
