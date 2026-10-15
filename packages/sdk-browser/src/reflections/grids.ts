import { texelBytesOf } from '../gpu/core/textureBytes.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'

/**
 * THE GRIDS OF A SURFACE, a texel a pixel of the view (`trace.ts`), their texels laid out by
 * `texelWgsl.ts`. Three in `REFLECTION_GRID_FORMAT` — two that take turns as the history the temporal
 * accumulation reads and the one it writes, the trace writing first into the one that is not the
 * history, and the scratch the spatial reuse writes between them —, and the rays' directions in
 * `REFLECTION_RAY_FORMAT`, which the trace writes and the spatial reuse reads to weigh a neighbour's ray
 * on the pixel's own lobe.
 */
export const REFLECTION_GRID_FORMAT: GPUTextureFormat = 'rgba32uint'
/** A ray's direction on the octahedron, two 16-bit signed halves: within 0.003° of it. */
export const REFLECTION_RAY_FORMAT: GPUTextureFormat = 'r32uint'

/** The grids a surface holds in `REFLECTION_GRID_FORMAT`: the two of the history's turn about, and the
 *  scratch. */
const GRIDS = 3

/** Bytes of a surface's grids over a view of `width × height`: 3 · 16 + 4 = 52 a pixel. */
export const gridBytes = (width: number, height: number) =>
  width *
  height *
  (GRIDS * texelBytesOf(REFLECTION_GRID_FORMAT) + texelBytesOf(REFLECTION_RAY_FORMAT))

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
export function createReflectionGrids(device: GPUDevice, label: string, size: GPUExtent3D) {
  const textures = [
    ...Array.from({ length: GRIDS }, () =>
      createKernelTexture(device, label, size, REFLECTION_GRID_FORMAT),
    ),
    createKernelTexture(device, label, size, REFLECTION_RAY_FORMAT),
  ]
  const views = textures.map((texture) => texture.createView())
  return {
    textures,
    /** The turn about's two, `turn[parity]`, the scratch, and the rays. */
    turn: [views[0], views[1]] as const,
    scratch: views[2],
    rays: views[3],
    destroy() {
      for (const texture of textures) texture.destroy()
    },
  }
}
export type ReflectionGrids = ReturnType<typeof createReflectionGrids>
