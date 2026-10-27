import { ensureSet, type HeldSet } from '../../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../../gpu/core/resourceAllocator.ts'
import { SURFACE_CACHE_ATLAS_LABEL } from '../../../diagnostic/stage/passLabels.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import {
  LIGHTING_PARAMS,
  PAGE_ARGS_WORDS,
  standaloneScratchWords,
  tracedShadowWords,
} from './layout.ts'
import { type LightingShape, shapeKey, sizesOf } from './params.ts'

/**
 * THE LIGHTING'S OWN MEMORY, made for a shape (`shapeOf`) and again when it changes: the parameters' uniform, the update
 * context (the header and the lists of pages and tiles: it is the dispatches' arguments too), the depth range and the lights of each tile, a small
 * buffer that stands in for the traced shadows' where they are not made, the radiosity's rays filtered, and the two atlases
 * the radiosity keeps from one image to the next — the rays' radiance for each probe
 * (`trace`, the words of light, a square of rays a probe) and the probes' harmonics (`harmonics`, a layer a channel), and,
 * with the probes' occlusion, the distance each ray met a surface at (`hits`, laid as the trace is; 1 × 1 without). They are
 * asked of the device's budget as the atlases are (`ensureLighting`): where it refuses, the lighting is off and says why.
 *
 * THE TRACED SHADOWS' BUFFERS are a set of their own (`ensureTracedShadows`): the masks of the lights of the tiles, the shadow
 * traces they list and the light tiles the traces are found by. They are made when the shadows are traced, keyed by the
 * light tiles, the format of the masks and whether the light functions the atlas holds no slot of have their scratch after the
 * masks (`tracedShadowWords`), and given back when they are not traced: turning the traced path on or off remakes
 * none of the lighting's memory, and the radiosity keeps its history. Where the shadows are not traced and such light functions
 * are, the scratch is a set of its own (`ensureStandaloneScratch`).
 */

/** The lighting's resources of one shape. */
export type LightingResources = ReturnType<typeof allocate> & HeldSet

/** The resources of `shape`, asked of `allocator`. */
function allocate(allocator: ResourceAllocator, shape: LightingShape) {
  const sizes = sizesOf(shape)
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
  return {
    params: allocator.buffer('lighting parameters', LIGHTING_PARAMS.words, 'uniform'),
    context: allocator.buffer('lighting context', sizes.context.words, 'list'),
    /** The dispatches that cut the context's pages into tiles, read by the dispatch that is not bound to the context's writer. */
    pageArgs: allocator.buffer('lighting page args', PAGE_ARGS_WORDS, 'args'),
    tileLights: allocator.buffer('lights of the tiles', sizes.tileLightsWords, 'storage'),
    /** The depth range of each tile of the direct list, a word of two half floats, which the cull of the lights reads. */
    depthRanges: allocator.buffer('depth ranges of the tiles', sizes.depthRangeWords, 'storage'),
    /** What the passes bind in place of the traced shadows' masks and traces where those are not made. */
    standIn: allocator.buffer('stand-in for the traced shadows', 1, 'storage'),
    /** What the context binds, read-only, in place of the rays' feedback where there is none: not the buffer above, which it binds writable beside. */
    feedbackStandIn: allocator.buffer('stand-in for the feedback', 1, 'storage'),
    filtered: allocator.buffer('filtered radiosity rays', sizes.filteredWords, 'storage'),
    trace: allocator.texture('radiosity trace', [sizes.traceAtlas, sizes.traceAtlas], 'r32uint', {
      usage,
    }),
    hits: allocator.texture(
      'radiosity hit distances',
      [sizes.hitAtlas, sizes.hitAtlas],
      'r32float',
      {
        usage,
      },
    ),
    harmonics: allocator.texture(
      'radiosity harmonics',
      [sizes.probeAtlas, sizes.probeAtlas, 3],
      'rgba16float',
      { usage },
    ),
  }
}

/**
 * The lighting's resources for `shape`: `held` where they are for it, else made, those held given back — where the device's
 * budget leaves room (`ledgerAdmitted`); none where it does not, with the reason.
 */
export function ensureLighting(
  held: LightingResources | undefined,
  device: GPUDevice,
  shape: LightingShape,
) {
  return ensureSet(
    held,
    device,
    {
      key: [shapeKey(shape)],
      what: 'the surface cache lighting',
      label: `${SURFACE_CACHE_ATLAS_LABEL} lighting`,
    },
    (allocator) => allocate(allocator, shape),
  )
}

/** The buffers of the traced shadows for `lightTiles` light tiles, their masks in `format`, with room for the scratch of the light
 *  functions where `scratch`, asked of `allocator`. */
function allocateTraced(
  allocator: ResourceAllocator,
  lightTiles: number,
  format: AtlasFormat,
  scratch: boolean,
) {
  const words = tracedShadowWords(lightTiles, format, scratch)
  return {
    masks: allocator.buffer('shadow masks', words.masks, 'storage'),
    traces: allocator.buffer('shadow traces', words.traces, 'storage'),
    /** The page and tile word and the light of each light tile of the masks, which the traces find their texels by. */
    lightTiles: allocator.buffer('shadow light tiles', words.lightTiles, 'storage'),
  }
}

/** The traced shadows' buffers of one size. */
export type TracedShadowBuffers = ReturnType<typeof allocateTraced> & HeldSet

/**
 * The traced shadows' buffers for `lightTiles` light tiles (a tile of the direct list's, a light of it), their masks in `format`
 * and with the scratch of the light functions where `scratch`: `held` where they are for that, else made, `held` given back —
 * where the device's budget leaves room; none where it does not, with the reason.
 */
export function ensureTracedShadows(
  held: TracedShadowBuffers | undefined,
  device: GPUDevice,
  lightTiles: number,
  format: AtlasFormat,
  scratch: boolean,
) {
  return ensureSet(
    held,
    device,
    {
      key: [lightTiles, format, scratch],
      what: 'the traced shadows',
      label: `${SURFACE_CACHE_ATLAS_LABEL} traced shadows`,
    },
    (allocator) => allocateTraced(allocator, lightTiles, format, scratch),
  )
}

/** The scratch of the light functions alone, for `lightTiles` light tiles, asked of `allocator`: what the direct light reads in the
 *  masks' place where its shadows are not traced. */
const allocateScratch = (allocator: ResourceAllocator, lightTiles: number) => ({
  scratch: allocator.buffer(
    'light function scratch',
    standaloneScratchWords(lightTiles),
    'storage',
  ),
})

/** The scratch of the light functions alone. */
export type StandaloneScratch = ReturnType<typeof allocateScratch> & HeldSet

/** The scratch of `lightTiles` light tiles for an image whose shadows are not traced: `held` where it is for that many, else made. */
export function ensureStandaloneScratch(
  held: StandaloneScratch | undefined,
  device: GPUDevice,
  lightTiles: number,
) {
  return ensureSet(
    held,
    device,
    {
      key: [lightTiles],
      what: 'the scratch of the light functions',
      label: `${SURFACE_CACHE_ATLAS_LABEL} light function scratch`,
    },
    (allocator) => allocateScratch(allocator, lightTiles),
  )
}
