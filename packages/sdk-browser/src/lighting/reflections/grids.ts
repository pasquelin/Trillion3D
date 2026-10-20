import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { REFLECTION_COUNTS, REFLECTION_SIDE } from './constants.ts'
import { createList, listBytes, resetList } from '../../gpu/dispatch/list.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'

/**
 * THE TEXTURES OF A SURFACE'S REFLECTIONS, sized on the targets' whole extent — the render
 * resolution's buffer, a render scale drawing within it, so a scale change reallocates nothing —
 * divided by the downsample factor for what the rays write, whole for what every pixel resolves and
 * accumulates; their texels laid out by
 * `texelWgsl.ts`, two words each in `REFLECTION_GRID_FORMAT`.
 *
 * - THE GRID, a texel a block of `REFLECTION_TRACE_BLOCK` pixels a side (`gridExtent`), the tracing
 *   buffers: the fresh texels the trace writes (`fresh`, a ray's radiance and hit), the partial
 *   answers of the rays the screen left (`partial`), and the ray words in `REFLECTION_RAY_FORMAT`
 *   (`rayPack`): the block's pixel that traces this image,
 *   which the classification picks (`tiles.ts`), and the ray's direction, which the screen stage writes
 *   beside it and the resolve reads to weigh a neighbour's ray on the pixel's own lobe; and the ray's
 *   data (`rayData`): the traced pixel's depth and the
 *   ray's pdf, which the screen stage writes and the resolve reads in place of the neighbour's
 *   surface.
 * - THE HISTORY, a texel a pixel in `REFLECTION_HISTORY_FORMAT`: two that take turns as the one the temporal accumulation reads and the
 *   one it writes (`history`, ping-ponged so no kernel reads what it writes). The resolved pixels the
 *   accumulation reads are the view's, one for both surfaces,
 *   which resolve in turn (`createScreenReflection`).
 * - THE LISTS (`../../gpu/dispatch/list.ts`), each its head — the indirect arguments of the kernels over it
 *   and the count — then its entries, four: the tracing tiles
 *   (`tracing`, `REFLECTION_SIDE`² texels where a pixel traces) and the others (`clearTracing`), the
 *   resolve tiles (`resolve`, `REFLECTION_SIDE`² pixels where one traces) and the others (`clear`), a
 *   word each; and the rays the screen left (`pending`, `trace/trace.ts`), a ray of
 *   `REFLECTION_PENDING_WORDS` words, the trace's `vec4u`, which the scene stage runs over.
 */
export const REFLECTION_GRID_FORMAT: GPUTextureFormat = 'rg32uint'
/** A texel's ray word (`rayPack`): its block's traced pixel and its ray's direction on the octahedron,
 *  13 bits an axis: within 0.02° of it. */
export const REFLECTION_RAY_FORMAT: GPUTextureFormat = 'r32uint'
/** A history texel (`historyPack`): its radiance and depth, its luminance's second moment and its
 *  count, four words. */
export const REFLECTION_HISTORY_FORMAT: GPUTextureFormat = 'rgba32uint'

/** Words of a ray the screen left (`trace/trace.ts`): its texel, its rest, bound and hit. */
const REFLECTION_PENDING_WORDS = 4

/** The grid's texels along `pixels` pixels: a texel a block of `REFLECTION_TRACE_BLOCK` pixels a
 *  side. */
export const gridSide = (pixels: number) =>
  ceilDiv(pixels, REFLECTION_COUNTS.REFLECTION_TRACE_BLOCK)

/** The grid over a view of `width × height` pixels (`gridSide`). */
export const gridExtent = (width: number, height: number): [number, number] => [
  gridSide(width),
  gridSide(height),
]

/** The tiles of `width × height` texels or pixels, a word each. */
const tilesOf = (width: number, height: number) =>
  ceilDiv(width, REFLECTION_SIDE) * ceilDiv(height, REFLECTION_SIDE)

/** Bytes of one texel of the grids. */
const TEXEL = texelBytesOf(REFLECTION_GRID_FORMAT)

/** Bytes of the view's resolved pixels at `width × height`, one texel each (`createScreenReflection`). */
export const resolvedBytes = (width: number, height: number) => width * height * TEXEL

/** Bytes of a surface's textures over targets of `width × height` pixels: the grid's 3 · 8 + 4 = 28
 *  a texel, the history's 2 · 16 = 32 a pixel, the four tile lists, the list of the rays the screen
 *  left, 16 a texel at most, and the one head every image copies over theirs (`head`). */
export const gridBytes = (width: number, height: number) => {
  const [w, h] = gridExtent(width, height)
  return (
    w * h * (3 * TEXEL + texelBytesOf(REFLECTION_RAY_FORMAT)) +
    2 * width * height * texelBytesOf(REFLECTION_HISTORY_FORMAT) +
    2 * listBytes(tilesOf(w, h), 1) +
    2 * listBytes(tilesOf(width, height), 1) +
    listBytes(w * h, REFLECTION_PENDING_WORDS) +
    listBytes(0, 1)
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

/** A surface's textures and lists over targets of `pixels`, each written by one kernel and read by the
 *  next. */
export function createReflectionGrids(device: GPUDevice, label: string, pixels: [number, number]) {
  const size = gridExtent(pixels[0], pixels[1])
  const textures = [
    createKernelTexture(device, label, size, REFLECTION_GRID_FORMAT),
    createKernelTexture(device, label, size, REFLECTION_GRID_FORMAT),
    createKernelTexture(device, label, size, REFLECTION_RAY_FORMAT),
    createKernelTexture(device, label, size, REFLECTION_GRID_FORMAT),
    createKernelTexture(device, label, pixels, REFLECTION_HISTORY_FORMAT),
    createKernelTexture(device, label, pixels, REFLECTION_HISTORY_FORMAT),
  ]
  const views = textures.map((texture) => texture.createView())
  // Each list's head set to no workgroup, one deep, no entry; every image copies it again (`head`,
  // `encodeReflectionTrace`).
  const list = (name: string, entries: number, words = 1) => {
    const made = createList(device, `Trillion3D reflection ${name}`, entries, words)
    resetList(device, made)
    return made
  }
  /** A list's head as an image starts it — no workgroup, one deep, no entry —: copied over each
   *  list's whole head in one command an image (`encodeReflectionTrace`). */
  const head = device.createBuffer({
    label: `Trillion3D reflection ${label} list head`,
    size: listBytes(0, 1),
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  resetList(device, head)
  const lists = {
    /** The tiles of texels a pixel traces in, listed every image (`tiles.ts`), and the others. */
    tracing: list('tracing tiles', tilesOf(size[0], size[1])),
    clearTracing: list('unused tracing tiles', tilesOf(size[0], size[1])),
    /** The tiles of pixels a pixel traces in, listed every image (`tiles.ts`), and the others. */
    resolve: list('resolve tiles', tilesOf(pixels[0], pixels[1])),
    clear: list('clear tiles', tilesOf(pixels[0], pixels[1])),
    /** The rays the screen left, listed every image (`trace/trace.ts`). */
    pending: list('rays left', size[0] * size[1], REFLECTION_PENDING_WORDS),
  }
  return {
    textures,
    ...lists,
    /** Every list, the order an image clears them in. */
    lists: Object.values(lists),
    head,
    /** The pixels the textures were made for. */
    pixels,
    fresh: views[0],
    partial: views[1],
    rays: views[2],
    rayData: views[3],
    /** The history's turn about, `history[parity]`. */
    history: [views[4], views[5]] as const,
    destroy() {
      for (const texture of textures) texture.destroy()
      for (const made of Object.values(lists)) made.destroy()
      head.destroy()
    },
  }
}
export type ReflectionGrids = ReturnType<typeof createReflectionGrids>
