import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { REFLECTION_SIDE, REFLECTION_TILE_HEAD, REFLECTION_TILE_ROW } from './constants.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'

/**
 * THE GRIDS OF A SURFACE, a texel a pixel of the view (`trace.ts`), their texels laid out by
 * `texelWgsl.ts`. Three in `REFLECTION_GRID_FORMAT` — two that take turns as the history the temporal
 * accumulation reads and the one it writes, the trace writing first into the one that is not the
 * history, and the scratch the spatial reuse writes between them —, and the rays' directions in
 * `REFLECTION_RAY_FORMAT`, which the trace writes and the spatial reuse reads to weigh a neighbour's ray
 * on the pixel's own lobe; and the list of the tiles that reflect (`tiles.ts`): its head — the indirect
 * arguments of every kernel and the count —, then a tile a word.
 */
export const REFLECTION_GRID_FORMAT: GPUTextureFormat = 'rgba32uint'
/** A ray's direction on the octahedron, two 16-bit signed halves: within 0.003° of it. */
export const REFLECTION_RAY_FORMAT: GPUTextureFormat = 'r32uint'

/** The grids a surface holds in `REFLECTION_GRID_FORMAT`: the two of the history's turn about, and the
 *  scratch. */
const GRIDS = 3

/** The head a list starts each image with: a row of tiles, no row yet, one, no tile. */
const RESET = new Uint32Array([REFLECTION_TILE_ROW, 0, 1, 0])
/** Bytes of a surface's tile list over a view of `width × height`: the head and a word a tile. */
const tileListBytes = (width: number, height: number) =>
  (REFLECTION_TILE_HEAD + ceilDiv(width, REFLECTION_SIDE) * ceilDiv(height, REFLECTION_SIDE)) * 4

/** Bytes of a surface's grids over a view of `width × height`: 3 · 16 + 4 = 52 a pixel, and the tile
 *  list. */
export const gridBytes = (width: number, height: number) =>
  width *
    height *
    (GRIDS * texelBytesOf(REFLECTION_GRID_FORMAT) + texelBytesOf(REFLECTION_RAY_FORMAT)) +
  tileListBytes(width, height)

/** The list's head set for an image: no tile yet, so no row to dispatch. */
export const resetTileList = (device: GPUDevice, list: GPUBuffer) =>
  device.queue.writeBuffer(list, 0, RESET)

/** A texture of the reflections' kernels, `format` at `size`: written by one as storage, read by the
 *  next. */
export const createKernelTexture = (
  device: GPUDevice,
  label: string,
  size: GPUExtent3D,
  format: GPUTextureFormat,
) =>
  device.createTexture({
    label,
    size,
    format,
    usage: loadOnlyUsage(),
  })

/** A surface's grids of `size` pixels, each written by one kernel and read by the next. */
export function createReflectionGrids(device: GPUDevice, label: string, size: [number, number]) {
  const textures = [
    ...Array.from({ length: GRIDS }, () =>
      createKernelTexture(device, label, size, REFLECTION_GRID_FORMAT),
    ),
    createKernelTexture(device, label, size, REFLECTION_RAY_FORMAT),
  ]
  const views = textures.map((texture) => texture.createView())
  const [width, height] = size as [number, number]
  const tiles = device.createBuffer({
    label: 'Trillion3D reflection tiles',
    size: tileListBytes(width, height),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  return {
    textures,
    /** The tiles that reflect, listed every image (`tiles.ts`). */
    tiles,
    /** The turn about's two, `turn[parity]`, the scratch, and the rays. */
    turn: [views[0], views[1]] as const,
    scratch: views[2],
    rays: views[3],
    destroy() {
      for (const texture of textures) texture.destroy()
      tiles.destroy()
    },
  }
}
export type ReflectionGrids = ReturnType<typeof createReflectionGrids>
