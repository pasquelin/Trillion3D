import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { DEPTH_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import { WATER_NORMALS_FORMAT, WATER_SPECULAR_FORMAT } from './waterLayout.ts'
import { WATER_DEPTH_FORMAT, WATER_MASK_FORMAT, WATER_SUN_FORMAT } from './waterSceneStages.ts'

/** The textures of the water pass at the size of the render targets: the copy of the scene at `1 / factor`,
 *  the water's depth at the size `depth`, the mask, the water's surface, and the separated sun when `separate`. */
export function waterTextures(
  device: GPUDevice,
  width: number,
  height: number,
  factor: number,
  depth: { width: number; height: number },
  separate: boolean,
) {
  const render = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const copy = { width: ceilDiv(width, factor), height: ceilDiv(height, factor) },
    full = { width, height }
  const texture = (label: string, format: GPUTextureFormat, usage: number, size = full) =>
    device.createTexture({ label: `Trillion3D water ${label}`, size, format, usage })
  return {
    sceneColor: texture('scene color', HDR_FORMAT, render, copy),
    sceneDepth: texture('scene depth', WATER_DEPTH_FORMAT, render, copy),
    waterDepth: texture(
      'depth',
      DEPTH_FORMAT,
      render | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
      depth,
    ),
    mask: texture('refraction mask', WATER_MASK_FORMAT, render),
    normals: texture('normals', WATER_NORMALS_FORMAT, render),
    specular: texture('specular', WATER_SPECULAR_FORMAT, render),
    sun: separate ? texture('sun', WATER_SUN_FORMAT, render) : undefined,
  }
}

/** The views of the water pass's textures. */
export const waterViews = (textures: ReturnType<typeof waterTextures>) => ({
  sceneColor: textures.sceneColor.createView(),
  sceneDepth: textures.sceneDepth.createView(),
  waterDepth: textures.waterDepth.createView({ aspect: 'depth-only' }),
  mask: textures.mask.createView(),
  normals: textures.normals.createView(),
  specular: textures.specular.createView(),
  sun: textures.sun?.createView(),
})

/** The tiles' buffers: a bit a tile, the list and the indirect draw's arguments (six vertices a tile). */
export function waterTileBuffers(device: GPUDevice, tilesAcross: number, tilesDown: number) {
  const buffer = (label: string, bytes: number, usage: number) =>
    device.createBuffer({ label: `Trillion3D water ${label}`, size: Math.max(bytes, 16), usage })
  const tiles = tilesAcross * tilesDown
  const tileMask = buffer(
    'tile mask',
    ceilDiv(tiles, 32) * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  )
  const tileList = buffer('tile list', tiles * 4, GPUBufferUsage.STORAGE)
  const tileArgs = buffer(
    'tile arguments',
    16,
    GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  )
  // The draw of a tile is six vertices; the instance count is the list's, counted each image.
  device.queue.writeBuffer(tileArgs, 0, new Uint32Array([6, 0, 0, 0]))
  return { tileMask, tileList, tileArgs }
}
