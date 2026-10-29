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

/** A cube texture's mip `mip`, written one slice a face; of an array of cubes, the cube `cube`. */
export const storageMip = (texture: GPUTexture, mip: number, cube = 0) =>
  texture.createView({
    dimension: '2d-array',
    baseMipLevel: mip,
    mipLevelCount: 1,
    baseArrayLayer: cube * CUBE_FACES,
    arrayLayerCount: CUBE_FACES,
  })

/** Cube `cube` of an array of cubes, all its mips, as a cube. */
export const cubeOfArray = (texture: GPUTexture, cube: number) =>
  texture.createView({
    dimension: 'cube',
    baseArrayLayer: cube * CUBE_FACES,
    arrayLayerCount: CUBE_FACES,
  })

/** An array of cubes, all its cubes and mips, as a cube array. */
export const wholeCubeArray = (texture: GPUTexture) =>
  texture.createView({ dimension: 'cube-array' })

/** The group of a mip's filtering pass: its block, the cube it reads, its sampler (bilinear for a mip, trilinear for the roughness filter) and the
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
