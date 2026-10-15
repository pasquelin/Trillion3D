import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { REFLECTION_COUNTS, REFLECTION_SIDE } from './constants.ts'
import { createList, listBytes } from '../gpu/dispatch/list.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'

/**
 * THE GRIDS OF A SURFACE, a texel a block of `REFLECTION_TRACE_BLOCK`² pixels of the view (`trace.ts`,
 * `gridExtent`): the reference engine's reflections at its high quality, traced and denoised at a quarter
 * of the pixels and widened to every pixel last (`bilateralWgsl.ts`); their texels laid out by
 * `texelWgsl.ts`. Three in `REFLECTION_GRID_FORMAT` — two that take turns as the history the temporal
 * accumulation reads and the one it writes, the trace writing first into the one that is not the
 * history, and the scratch the spatial reuse writes between them —, and the rays' directions in
 * `REFLECTION_RAY_FORMAT`, which the trace writes and the spatial reuse reads to weigh a neighbour's ray
 * on the pixel's own lobe; the list of the tiles that reflect (`tiles.ts`): its head — the indirect
 * arguments of every kernel and the count —, then a tile a word; and the list of the rays the screen
 * left (`trace.ts`), the same head — the scene stage's indirect arguments and the count —, then a ray
 * of `REFLECTION_PENDING_WORDS` words, the trace's `vec4u` (`../gpu/dispatch/list.ts`).
 */
export const REFLECTION_GRID_FORMAT: GPUTextureFormat = 'rgba32uint'
/** A ray's direction on the octahedron, two 16-bit signed halves: within 0.003° of it. */
export const REFLECTION_RAY_FORMAT: GPUTextureFormat = 'r32uint'

/** The grids a surface holds in `REFLECTION_GRID_FORMAT`: the two of the history's turn about, and the
 *  scratch. */
const GRIDS = 3

/** Words of a ray the screen left (`trace.ts`): its pixel, its two lobes' rests, bounds and hits. */
const REFLECTION_PENDING_WORDS = 4

/** The grid over a view of `width × height` pixels: a texel a block. */
export const gridExtent = (width: number, height: number): [number, number] => [
  ceilDiv(width, REFLECTION_COUNTS.REFLECTION_TRACE_BLOCK),
  ceilDiv(height, REFLECTION_COUNTS.REFLECTION_TRACE_BLOCK),
]

/** The tiles of a grid `width × height` texels, a word each. */
const tilesOf = (width: number, height: number) =>
  ceilDiv(width, REFLECTION_SIDE) * ceilDiv(height, REFLECTION_SIDE)

/** Bytes of a surface's grids over a view of `width × height` pixels: 3 · 16 + 4 = 52 a texel, the
 *  tile list, and the list of the rays the screen left, 16 a texel at most. */
export const gridBytes = (width: number, height: number) => {
  const [w, h] = gridExtent(width, height)
  return (
    w * h * (GRIDS * texelBytesOf(REFLECTION_GRID_FORMAT) + texelBytesOf(REFLECTION_RAY_FORMAT)) +
    listBytes(tilesOf(w, h), 1) +
    listBytes(w * h, REFLECTION_PENDING_WORDS)
  )
}

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

/** A surface's grids over a view of `pixels`, each written by one kernel and read by the next. */
export function createReflectionGrids(device: GPUDevice, label: string, pixels: [number, number]) {
  const size = gridExtent(pixels[0], pixels[1])
  const textures = [
    ...Array.from({ length: GRIDS }, () =>
      createKernelTexture(device, label, size, REFLECTION_GRID_FORMAT),
    ),
    createKernelTexture(device, label, size, REFLECTION_RAY_FORMAT),
  ]
  const views = textures.map((texture) => texture.createView())
  const [width, height] = size
  const tiles = createList(device, 'Trillion3D reflection tiles', tilesOf(width, height), 1)
  const pending = createList(
    device,
    'Trillion3D reflection rays left',
    width * height,
    REFLECTION_PENDING_WORDS,
  )
  return {
    textures,
    /** The tiles that reflect, listed every image (`tiles.ts`). */
    tiles,
    /** The rays the screen left, listed every image (`trace.ts`). */
    pending,
    /** The turn about's two, `turn[parity]`, the scratch, and the rays. */
    turn: [views[0], views[1]] as const,
    scratch: views[2],
    rays: views[3],
    destroy() {
      for (const texture of textures) texture.destroy()
      tiles.destroy()
      pending.destroy()
    },
  }
}
export type ReflectionGrids = ReturnType<typeof createReflectionGrids>
