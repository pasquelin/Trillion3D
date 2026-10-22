import { CUBE_FACES } from './layout.ts'

/** Face `face` of a cube texture's top mip, one view each, as colour targets. */
export const cubeFaceTargets = (cube: GPUTexture) =>
  Array.from({ length: CUBE_FACES }, (_, face) =>
    cube.createView({
      dimension: '2d',
      baseMipLevel: 0,
      mipLevelCount: 1,
      baseArrayLayer: face,
      arrayLayerCount: 1,
    }),
  )

/** A cube texture, all its mips, as a cube. */
export const wholeCube = (texture: GPUTexture) => texture.createView({ dimension: 'cube' })

/** A cube texture's mip `mip` whole, as a cube. */
export const cubeMipView = (texture: GPUTexture, mip: number) =>
  texture.createView({ dimension: 'cube', baseMipLevel: mip, mipLevelCount: 1 })

/** A cube texture's mip `mip`, written one slice a face. */
export const storageMip = (texture: GPUTexture, mip: number) =>
  texture.createView({
    dimension: '2d-array',
    baseMipLevel: mip,
    mipLevelCount: 1,
    baseArrayLayer: 0,
    arrayLayerCount: CUBE_FACES,
  })

/** The group of a mip's filtering pass: its block, the cube it reads, the nearest sampler and the
 *  slices it writes. */
export const filterBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  block: GPUBufferBinding,
  source: GPUTextureView,
  sampler: GPUSampler,
  output: GPUTextureView,
) =>
  device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: block },
      { binding: 1, resource: source },
      { binding: 2, resource: sampler },
      { binding: 3, resource: output },
    ],
  })
