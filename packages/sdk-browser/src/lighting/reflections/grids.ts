import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { createList, listBytes, resetList } from '../../gpu/dispatch/list.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'

/**
 * THE TEXTURES OF A SURFACE'S REFLECTIONS, sized on the targets' whole extent — the render
 * resolution's buffer, a render scale drawing within it, so a scale change reallocates nothing —
 * whole for what every pixel resolves and accumulates, and for what the rays write — a texel a pixel, the
 * grid's extent the one block of one pixel can fill, the level's block (`reflectionBlock`) narrowing what is used of
 * it, so a level change reallocates nothing —; their texels laid out by
 * `texelWgsl.ts`, two words each in `REFLECTION_GRID_FORMAT`.
 *
 * - THE GRID, a texel a block of the level's pixels a side (`ReflectionView.grid`; here `pixels` texels at most), the tracing
 *   buffers: the fresh texels the trace writes (`fresh`, a ray's radiance and hit), and the rays (`rays`), the layers of one array
 *   texture of `REFLECTION_RAY_FORMAT` (`REFLECTION_RAY_LAYERS`) which the ray generation writes (`generateRays`, `trace/trace.ts`)
 *   and every later kernel reads: the depth of the pixel the texel casts from this image, an `f32`'s bits, negative where the texel
 *   casts none (the clear of an unused tracing tile writes -1), which the resolve reads in place of the neighbour's surface; then the
 *   ray's direction, two halves in a word and the third beside the cone angle in the next — the cone angle the inverse of the ray's pdf,
 *   negative for a pixel of a first-person object —, which the stages trace and the resolve weighs a neighbour's ray on the pixel's own lobe by.
 * - THE HISTORY, a texel a pixel in `REFLECTION_HISTORY_FORMAT`: two that take turns as the one the temporal accumulation reads and the
 *   one it writes (`history`, ping-ponged so no kernel reads what it writes). The resolved pixels the
 *   accumulation reads are the view's, one for both surfaces,
 *   which resolve in turn (`createScreenReflection`).
 * - THE LISTS (`../../gpu/dispatch/list.ts`), each its head — the indirect arguments of the kernels over it
 *   and the count — then its entries, four: the tracing tiles
 *   (`tracing`, `REFLECTION_SIDE`² texels where a pixel traces) and the others (`clearTracing`), the
 *   resolve tiles (`resolve`, `REFLECTION_SIDE`² pixels where one traces) and the others (`clear`), a
 *   word each; and the rays the screen missed (`pending`, `trace/trace.ts`), a ray of
 *   `REFLECTION_PENDING_WORDS` words, the trace's `vec2u`, which the scene stage runs over.
 */
export const REFLECTION_GRID_FORMAT: GPUTextureFormat = 'rg32uint'
/** A texel's ray, in the layers of one array texture (`REFLECTION_RAY_LAYERS`): the traced pixel's depth, then the direction and the cone
 *  angle as the reference stores its ray, four half floats in two words. One array, not a half-float texture beside a depth: the
 *  stages that read the ray bind it as the one storage texture they read and write, none of the sampled textures a stage holds
 *  being left for it (and a half-float texture reads as storage only where the device grants the tier-1 formats). */
export const REFLECTION_RAY_FORMAT: GPUTextureFormat = 'r32uint'
/** The layers of the ray texture: the depth, the direction's first two halves, its third half with the cone angle. */
const REFLECTION_RAY_LAYERS = 3
/** A history texel (`historyPack`): its radiance and depth, its luminance's second moment and its
 *  count, four words. */
export const REFLECTION_HISTORY_FORMAT: GPUTextureFormat = 'rgba32uint'

/** The depth the view keeps of its last image (`depthBytes`): the opaque surface's device depth, a texel a pixel, which a screen hit's place in
 *  that image is told from another surface by (`past.ts`). */
export const REFLECTION_DEPTH_FORMAT: GPUTextureFormat = 'r32float'

/** Bytes of the depth the view keeps at `width × height` (`REFLECTION_DEPTH_FORMAT`). */
export const depthBytes = (width: number, height: number) =>
  width * height * texelBytesOf(REFLECTION_DEPTH_FORMAT)

/** Words of a ray the screen missed (`trace/trace.ts`): its texel and the distance its miss reached. */
const REFLECTION_PENDING_WORDS = 2

/** Bytes of a ray the screen missed, an entry of the list of the rays it left. */
export const REFLECTION_PENDING_BYTES = REFLECTION_PENDING_WORDS * 4

/** The grid's texels along `pixels` pixels, a texel a block of `block` pixels a side: what a view uses of it. */
export const gridSide = (pixels: number, block: number) => ceilDiv(pixels, block)

/** The grid's extent over a view of `width × height` pixels: a texel a pixel, whatever the block. */
const gridExtent = (width: number, height: number): [number, number] => [width, height]

/** The tiles of `width × height` texels or pixels, a word each. */
const tilesOf = (width: number, height: number) =>
  ceilDiv(width, REFLECTION_SIDE) * ceilDiv(height, REFLECTION_SIDE)

/** Bytes of one texel of the grids (`REFLECTION_GRID_FORMAT`). */
export const REFLECTION_GRID_TEXEL_BYTES = texelBytesOf(REFLECTION_GRID_FORMAT)

/** Bytes of the texture a ray is written in, a texel each: the traced pixel's depth, the direction and the cone angle (`REFLECTION_RAY_LAYERS`
 *  layers of `REFLECTION_RAY_FORMAT`). */
export const REFLECTION_RAY_BYTES = REFLECTION_RAY_LAYERS * texelBytesOf(REFLECTION_RAY_FORMAT)

/** Bytes of one history texel (`REFLECTION_HISTORY_FORMAT`). */
export const REFLECTION_HISTORY_TEXEL_BYTES = texelBytesOf(REFLECTION_HISTORY_FORMAT)

/** Bytes of the view's resolved pixels at `width × height`, one texel each (`createScreenReflection`). */
export const resolvedBytes = (width: number, height: number) =>
  width * height * REFLECTION_GRID_TEXEL_BYTES

/** Bytes of a surface's textures over targets of `width × height` pixels: the grid's 8 + 3 · 4 = 20
 *  a texel, a pixel's, the history's 2 · 16 = 32 a pixel, the four tile lists, the list of the rays the screen
 *  missed, 8 a texel at most. */
export const gridBytes = (width: number, height: number) => {
  const [w, h] = gridExtent(width, height)
  return (
    w * h * (REFLECTION_GRID_TEXEL_BYTES + REFLECTION_RAY_BYTES) +
    2 * width * height * REFLECTION_HISTORY_TEXEL_BYTES +
    2 * listBytes(tilesOf(w, h), 1) +
    2 * listBytes(tilesOf(width, height), 1) +
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

/** A surface's textures and lists over targets of `pixels`, each written by one kernel and read by the
 *  next. */
export function createReflectionGrids(device: GPUDevice, label: string, pixels: [number, number]) {
  const size = gridExtent(pixels[0], pixels[1])
  const textures = [
    createKernelTexture(device, label, size, REFLECTION_GRID_FORMAT),
    createKernelTexture(device, label, [...size, REFLECTION_RAY_LAYERS], REFLECTION_RAY_FORMAT),
    createKernelTexture(device, label, pixels, REFLECTION_HISTORY_FORMAT),
    createKernelTexture(device, label, pixels, REFLECTION_HISTORY_FORMAT),
  ]
  const views = textures.map((texture) => texture.createView())
  // Each list's head set to no workgroup, one deep, no entry; every image sets it again (`resetListIn`, `encodeReflectionTrace`).
  const list = (name: string, entries: number, words = 1) => {
    const made = createList(device, `Trillion3D reflection ${name}`, entries, words)
    resetList(device, made)
    return made
  }
  const lists = {
    /** The tiles of texels a pixel traces in, listed every image (`tiles.ts`), and the others. */
    tracing: list('tracing tiles', tilesOf(size[0], size[1])),
    clearTracing: list('unused tracing tiles', tilesOf(size[0], size[1])),
    /** The tiles of pixels a pixel traces in, listed every image (`tiles.ts`), and the others. */
    resolve: list('resolve tiles', tilesOf(pixels[0], pixels[1])),
    clear: list('clear tiles', tilesOf(pixels[0], pixels[1])),
    /** The rays the screen missed, listed every image (`trace/trace.ts`). */
    pending: list('rays missed', size[0] * size[1], REFLECTION_PENDING_WORDS),
  }
  return {
    textures,
    ...lists,
    /** Every list, the order an image clears them in. */
    lists: Object.values(lists),
    /** The pixels the textures were made for. */
    pixels,
    fresh: views[0],
    /** The rays, an array view of `REFLECTION_RAY_LAYERS` layers. */
    rays: views[1],
    /** The history's turn about, `history[parity]`. */
    history: [views[2], views[3]] as const,
    destroy() {
      for (const texture of textures) texture.destroy()
      for (const made of Object.values(lists)) made.destroy()
    },
  }
}
export type ReflectionGrids = ReturnType<typeof createReflectionGrids>
