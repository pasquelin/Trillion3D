import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { texelBytesOf } from '../gpu/core/textureBytes.ts'

/**
 * THE HALF-RESOLUTION GRIDS OF A SURFACE, a texel a 2×2 block of the view's pixels (`traceHalf.ts`), in
 * `HALF_FORMAT`, their texels laid out by `texelWgsl.ts`. Three a surface: two that take turns as the
 * history the temporal accumulation reads and the one it writes — the trace writing first into the one
 * that is not the history —, and the scratch between them.
 */
export const HALF_FORMAT: GPUTextureFormat = 'rgba32uint'

/** The grids a surface holds: the two of the history's turn about, and the scratch. */
const GRIDS = 3

/** The half grid over a view of `width × height`: a texel a 2×2 block, the last row and column
 *  covering the odd pixel. */
export const halfExtent = (width: number, height: number): [number, number] => [
  ceilDiv(width, 2),
  ceilDiv(height, 2),
]

/** Bytes of a surface's half grids over a view of `width × height`. */
export const halfBytes = (width: number, height: number) => {
  const [w, h] = halfExtent(width, height)
  return GRIDS * w * h * texelBytesOf(HALF_FORMAT)
}

/** A surface's half grids of `size` texels (`GRIDS`), each written by one kernel and read by the next. */
export function createHalfGrids(device: GPUDevice, label: string, size: GPUExtent3D) {
  const textures = Array.from({ length: GRIDS }, () =>
    device.createTexture({
      label,
      size,
      format: HALF_FORMAT,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    }),
  )
  const views = textures.map((texture) => texture.createView())
  return {
    textures,
    /** Its width in texels: what tells a grid of a texel from the view's (`frontLayer.ts`). */
    width: textures[0].width,
    /** The turn about's two, `turn[parity]`, then the scratch. */
    turn: [views[0], views[1]] as const,
    scratch: views[2],
    destroy() {
      for (const texture of textures) texture.destroy()
    },
  }
}
export type HalfGrids = ReturnType<typeof createHalfGrids>
