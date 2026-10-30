import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { LIT_BOUNCE_VECS } from './hitLighting/constants.ts'
import { createList, listBytes, resetList } from '../../gpu/dispatch/list.ts'
import { loadOnlyUsage } from '../../gpu/core/loadOnlyTarget.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { foldWindow, type KeepingWindow } from '../../gpu/core/idleKeep.ts'

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
 *   negative for a pixel of a first-person object —, which the stages trace and the resolve weighs a neighbour's ray on the pixel's own lobe by; then
 *   the furthest the ray goes in metres, an `f32`'s bits, zero for the view's longest ray, negative where it reads the radiance cache past it.
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
/** The layers of the ray texture: the depth, the direction's first two halves, its third half with the cone angle, the furthest the ray goes. */
const REFLECTION_RAY_LAYERS = 4
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
export const tilesOf = (width: number, height: number) =>
  ceilDiv(width, REFLECTION_SIDE) * ceilDiv(height, REFLECTION_SIDE)

/** Bytes of one texel of the grids (`REFLECTION_GRID_FORMAT`). */
export const REFLECTION_GRID_TEXEL_BYTES = texelBytesOf(REFLECTION_GRID_FORMAT)

/** Bytes of the texture a ray is written in, a texel each: the traced pixel's depth, the direction, the cone angle and the furthest the ray goes (`REFLECTION_RAY_LAYERS`
 *  layers of `REFLECTION_RAY_FORMAT`). */
export const REFLECTION_RAY_BYTES = REFLECTION_RAY_LAYERS * texelBytesOf(REFLECTION_RAY_FORMAT)

/** Bytes of one history texel (`REFLECTION_HISTORY_FORMAT`). */
export const REFLECTION_HISTORY_TEXEL_BYTES = texelBytesOf(REFLECTION_HISTORY_FORMAT)

/** Bytes of the view's resolved pixels at `width × height`, one texel each (`createScreenReflection`). */
export const resolvedBytes = (width: number, height: number) =>
  width * height * REFLECTION_GRID_TEXEL_BYTES

/** Bytes of a surface's textures over targets of `width × height` pixels: the grid's 8 + 3 · 4 = 20
 *  a texel, a pixel's, the history's 2 · 16 = 32 a pixel, the four tile lists, the list of the rays the screen
 *  missed, 8 a texel at most, and with `meshes` the list of the rays the meshes' fields stage traces, 4 a texel at most. */
export const gridBytes = (width: number, height: number, meshes = false) => {
  const [w, h] = gridExtent(width, height)
  return (
    w * h * (REFLECTION_GRID_TEXEL_BYTES + REFLECTION_RAY_BYTES) +
    2 * width * height * REFLECTION_HISTORY_TEXEL_BYTES +
    2 * listBytes(tilesOf(w, h), 1) +
    2 * listBytes(tilesOf(width, height), 1) +
    listBytes(w * h, REFLECTION_PENDING_WORDS) +
    (meshes ? listBytes(w * h, 1) : 0)
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

/** What the images of a keeping window asked of the hit lighting's state: the grid's extent and the vertices of a path. */
interface LitAsk {
  width: number
  height: number
  vertices: number
}
const NO_LIT_ASK: LitAsk = { width: 0, height: 0, vertices: 1 }
const mostLitAsked = (a: LitAsk, b: LitAsk): LitAsk => ({
  width: Math.max(a.width, b.width),
  height: Math.max(a.height, b.height),
  vertices: Math.max(a.vertices, b.vertices),
})

/** The words of a grid texel's record in the hits' buffer (`sceneTraceHardware.ts`): the found and whole bits with the steps of the walk, the distance, the normal (two 16-bit octahedral coordinates) and the object, and, where the hit lighting runs (`lit`), the key of the hit's material (`REFLECTION_HIT_MATERIAL_WORD`). */
export const reflectionHitWords = (lit: boolean) => (lit ? 5 : 4)

/** The words of a trace in the hit lighting's radiance buffer (`litWgsl.ts`): two `vec4u` for its first vertex, and for each vertex after it (`vertices`, the most a path holds: its reflection bounces over its refraction stretches) `LIT_BOUNCE_VECS` more. */
const litRadianceWords = (vertices: number) => 8 + (vertices - 1) * LIT_BOUNCE_VECS * 4

/** The texels of the grid along `pixels` pixels at the blocks of pixels `block` and `frontBlock` of the two surfaces along that axis: the grid's extent of the image (`ReflectionView.grid`), a block of pixels a texel, the finer of the two. */
export const usedAxis = (pixels: number, block: number, frontBlock: number) =>
  gridSide(pixels, Math.min(block, frontBlock))

/** The bytes of the largest buffer the hit lighting binds for a grid of `grid` texels and paths of `vertices` vertices: the first pass's radiance (`litRadianceWords` words a trace), which the device must bind whole. */
export const litBindingBytes = (grid: readonly [number, number], vertices = 1) =>
  grid[0] * grid[1] * litRadianceWords(vertices) * 4

/** Whether the hit lighting's buffers for a grid of `grid` texels and paths of `vertices` vertices fit one binding of `device`, the hits' records and the radiance both. */
export const litFits = (device: GPUDevice, grid: readonly [number, number], vertices = 1) =>
  Math.max(litBindingBytes(grid, vertices), grid[0] * grid[1] * reflectionHitWords(true) * 4) <=
  Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)

/** The hit lighting's buffers and texture for a grid of `size` texels, the grid the image uses (`ReflectionGrids.lit`): its parameters (the grid's width of the image, written by the stage every image), the list of the traces to
 *  light and its sorted copy, the dispatch arguments, the first pass's radiance and the materials' texture the sort reads. */
function createLitState(
  device: GPUDevice,
  label: string,
  size: readonly number[],
  vertices: number,
) {
  const texels = size[0]! * size[1]!
  const buffer = (name: string, bytes: number, usage: number) =>
    device.createBuffer({
      label: `Trillion3D reflection hit lighting ${name} ${label}`,
      size: bytes,
      usage,
    })
  return {
    params: buffer('parameters', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    /** The count (padded to the entries' alignment of eight bytes), then a trace a pair of words. */
    list: buffer('list', (2 + 2 * texels) * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
    sorted: buffer('sorted', 2 * texels * 4, GPUBufferUsage.STORAGE),
    /** The sort's dispatch (words 0 to 2) and the passes' (3 to 5). */
    args: buffer('arguments', 24, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT),
    radiance: buffer('radiance', texels * litRadianceWords(vertices) * 4, GPUBufferUsage.STORAGE),
    materials: device.createTexture({
      label: `Trillion3D reflection hit lighting materials ${label}`,
      size: [size[0]!, size[1]!],
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    }),
  }
}
const destroyLitState = (state: ReturnType<typeof createLitState>) => {
  state.params.destroy()
  state.list.destroy()
  state.sorted.destroy()
  state.args.destroy()
  state.radiance.destroy()
  state.materials.destroy()
}

/** A surface's textures and lists over targets of `pixels`, each written by one kernel and read by the
 *  next. `meshes` for the surface the meshes' fields stage traces (the opaque one): the list of its rays is made for it alone. */
export function createReflectionGrids(
  device: GPUDevice,
  label: string,
  pixels: [number, number],
  meshes = false,
) {
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
    /** The rays of `pending` the meshes' fields stage traces, the rank of each in it (`trace/meshes.ts`); only where `meshes`. */
    ...(meshes ? { meshRays: list('rays near the meshes', size[0] * size[1]) } : {}),
  }
  // The triangles the scene stage's rays met, made by the stage that casts through the scene's triangles alone (`sceneTraceHardware.ts`).
  let hitBuffer: { buffer: GPUBuffer; bytes: number } | undefined
  let litState:
    | {
        state: ReturnType<typeof createLitState>
        size: readonly [number, number]
        vertices: number
      }
    | undefined
  // The most the images of the window of keeping asked of the hit lighting's state (`keepLit`), and the image the window began at.
  const asked: KeepingWindow<LitAsk> = { most: NO_LIT_ASK, since: 0 }
  // The same for the hits' buffer: the bytes asked since the last `keepLit` (the image's), and the most the window asked.
  let hitsAsked = 0
  const hitsWindow: KeepingWindow<number> = { most: 0, since: 0 }
  const retireLit = () => {
    if (!litState) return
    const old = litState.state
    retire(device, { destroy: () => destroyLitState(old) })
    litState = undefined
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
    /** The buffer the scene stage through the scene's triangles keeps its hits in, a record of `words` words (`reflectionHitWords`) a texel of the grid `grid` the image uses (`usedAxis`): made at the first call and grown, the one it replaces retired, when a later image needs more. */
    hits(words: number, grid: readonly [number, number]) {
      const bytes = grid[0] * grid[1] * words * 4
      hitsAsked = Math.max(hitsAsked, bytes)
      if (hitBuffer && hitBuffer.bytes >= bytes) return hitBuffer.buffer
      if (hitBuffer) retire(device, hitBuffer.buffer)
      hitBuffer = {
        bytes,
        buffer: device.createBuffer({
          label: `Trillion3D reflection hits ${label}`,
          size: bytes,
          usage: GPUBufferUsage.STORAGE,
        }),
      }
      return hitBuffer.buffer
    },
    /** Tells the grids what image `frame` asks of the hit lighting's state (`lit`): the grid `grid` the image uses and its paths' `vertices`, or nothing where it does not run. When a window of `IDLE_KEEP_IMAGES` images has asked less than the state kept holds, the state is retired (made again at the size asked, by the next `lit`); the hits' buffer (`hits`) is kept by the same window, over the bytes the images asked of it. */
    keepLit(frame: number, ask?: { grid: readonly [number, number]; vertices: number }) {
      const hitsEnded = foldWindow(hitsWindow, frame, hitsAsked || undefined, Math.max, 0)
      hitsAsked = 0
      if (hitsEnded !== undefined && hitBuffer && hitBuffer.bytes > hitsEnded) {
        retire(device, hitBuffer.buffer)
        hitBuffer = undefined
      }
      const ended = foldWindow(
        asked,
        frame,
        ask && { width: ask.grid[0], height: ask.grid[1], vertices: ask.vertices },
        mostLitAsked,
        NO_LIT_ASK,
      )
      if (
        ended &&
        litState &&
        (litState.size[0] > ended.width ||
          litState.size[1] > ended.height ||
          litState.vertices > ended.vertices)
      )
        retireLit()
    },
    /** What the hit lighting (`hitLighting/`) keeps for this surface over the grid `grid` the image uses, made at the first call and made again, the one it replaces retired, when a later image needs more (it is let go when a window of images asks less, `keepLit`): the list of the traces to light and its sorted copy, the dispatch arguments, the first pass's radiance and the materials' texture the sort reads. */
    lit(grid: readonly [number, number], vertices = 1) {
      // What is kept serves the asked (grid, vertices) while it holds them; otherwise it is retired and made for the asked alone, which the image's fit check (`hitLightingFits`) has passed, so what is created is what was checked.
      if (
        litState &&
        litState.size[0] >= grid[0] &&
        litState.size[1] >= grid[1] &&
        litState.vertices >= vertices
      )
        return litState.state
      retireLit()
      litState = {
        state: createLitState(device, label, grid, vertices),
        // Copied: the caller may hand a scratch tuple it writes again.
        size: [grid[0], grid[1]],
        vertices,
      }
      return litState.state
    },
    destroy() {
      for (const texture of textures) texture.destroy()
      for (const made of Object.values(lists)) made.destroy()
      hitBuffer?.buffer.destroy()
      if (litState) destroyLitState(litState.state)
    },
  }
}
export type ReflectionGrids = ReturnType<typeof createReflectionGrids>
