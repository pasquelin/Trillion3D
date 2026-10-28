import { ensureSet, type HeldSet } from '../../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../../gpu/core/resourceAllocator.ts'
import { SURFACE_CACHE_ATLAS_LABEL } from '../../../diagnostic/stage/passLabels.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'
import {
  LIGHTING_PARAMS,
  SHADOW_TEXELS,
  lightTileArgsWords,
  lightTileCountsWords,
  PAGE_ARGS_WORDS,
  standaloneScratchWords,
  tracedShadowWords,
} from './layout.ts'
import { type LightingShape, shapeKey, sizesOf } from './params.ts'
import { STOCHASTIC_FRAMES_FORMAT, STOCHASTIC_RESOLVED_FORMAT } from './stochasticWgsl.ts'

/**
 * THE LIGHTING'S OWN MEMORY, made for a shape (`shapeOf`) and again when it changes: the parameters' uniform, the update
 * context (the header and the lists of pages and tiles: it is the dispatches' arguments too), the depth range of each tile, the light tiles the
 * cull picks and the compaction places (`lightTilesWgsl.ts`: the culled, the compacted and each tile's own list, with where each tile's lights begin
 * in it), a small buffer that stands in for the traced shadows' where they are not made, the radiosity's rays filtered, and the two atlases
 * the radiosity keeps from one image to the next — the rays' radiance for each probe
 * (`trace`, the light in the atlas's format, a square of rays a probe) and the probes' harmonics (`harmonics`, a layer a channel), and,
 * with the probes' occlusion, the distance each ray met a surface at (`hits`, laid as the trace is; 1 × 1 without). They are
 * asked of the device's budget as the atlases are (`ensureLighting`): where it refuses, the lighting is off and says why.
 *
 * THE LIGHT SLOTS' COUNTERS are a set of their own (`ensureLightSlots`), made for the lights the scene holds and again when their slots
 * outgrow it: the counters of the light tiles each slot holds and the arguments of the dispatches over them.
 *
 * THE TRACED SHADOWS' BUFFERS are a set of their own (`ensureTracedShadows`): the masks of the lights of the tiles and the shadow
 * traces they list. They are made when the shadows are traced, keyed by the
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
    /** The light tiles the cull appends, as it picks the lights of each tile. */
    culledLightTiles: allocator.buffer('culled light tiles', sizes.lightTileWords, 'storage'),
    /** The light tiles by slot, the tiles of a slot one after the other: what the shadow masks and the light functions run over. */
    compactedLightTiles: allocator.buffer('compacted light tiles', sizes.lightTileWords, 'storage'),
    /** The lights of each tile, in the order the cull picked them, with the place of each light tile in the compacted list. */
    cardTileLights: allocator.buffer(
      'light tiles of the card tiles',
      sizes.lightTileWords,
      'storage',
    ),
    /** Where each tile's lights begin in that list and how many it keeps. */
    cardTileOffsets: allocator.buffer(
      'light tile offsets of the card tiles',
      sizes.cardTileOffsetWords,
      'storage',
    ),
    /** The depth range of each tile of the direct list, a word of two half floats, which the cull of the lights reads. */
    depthRanges: allocator.buffer('depth ranges of the tiles', sizes.depthRangeWords, 'storage'),
    /** What the passes bind in place of the traced shadows' masks and traces where those are not made. */
    standIn: allocator.buffer('stand-in for the traced shadows', 1, 'storage'),
    /** What the context binds, read-only, in place of the rays' feedback where there is none: not the buffer above, which it binds writable beside. */
    feedbackStandIn: allocator.buffer('stand-in for the feedback', 1, 'storage'),
    filtered: allocator.buffer('filtered radiosity rays', sizes.filteredWords, 'storage'),
    trace: allocator.texture('radiosity trace', [sizes.traceAtlas, sizes.traceAtlas], shape.light, {
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

/** The counters of the light tiles of `slots` slots and the arguments of the dispatches over them, asked of `allocator`. */
const allocateLightSlots = (allocator: ResourceAllocator, slots: number) => ({
  counts: allocator.buffer('light tile counts', lightTileCountsWords(slots), 'storage'),
  args: allocator.buffer('light tile args', lightTileArgsWords(slots), 'args'),
})

/** The light slots' counters and arguments. */
export type LightSlots = ReturnType<typeof allocateLightSlots> & HeldSet

/** The counters of `slots` slots (`lightSlotsOf`): `held` where it is for that many, else made, `held` given back. */
export function ensureLightSlots(held: LightSlots | undefined, device: GPUDevice, slots: number) {
  return ensureSet(
    held,
    device,
    {
      key: [slots],
      what: 'the light tiles of the lights',
      label: `${SURFACE_CACHE_ATLAS_LABEL} light slots`,
    },
    (allocator) => allocateLightSlots(allocator, slots),
  )
}

/** What the stochastic direct light keeps (`stochasticWgsl.ts`) for `tiles` tiles of the direct list and `samples` lights picked a texel, in an atlas of `side` texels: the
 *  samples (four words each, one more a texel for the luminance the lights would give it), the light resolved before it is blended and, where it is blended
 *  (`temporal`), the history of two images (the light and its second moment, the images accumulated), the one read and the one written alternately. */
function allocateStochastic(
  allocator: ResourceAllocator,
  shape: { tiles: number; samples: number; side: number; temporal: boolean },
) {
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
  // Without the blend nothing is read or written of the resolved light and the history: one texel stands in.
  const extent = shape.temporal ? shape.side : 1
  const history = (name: string) => {
    return {
      lighting: allocator.texture(`${name} light`, [extent, extent], STOCHASTIC_RESOLVED_FORMAT, {
        usage,
      }),
      frames: allocator.texture(`${name} images`, [extent, extent], STOCHASTIC_FRAMES_FORMAT, {
        usage,
      }),
    }
  }
  return {
    samples: allocator.buffer(
      'stochastic direct light samples',
      shape.tiles * SHADOW_TEXELS * (shape.samples + 1) * 4,
      'storage',
    ),
    resolved: allocator.texture(
      'stochastic resolved light',
      [extent, extent],
      STOCHASTIC_RESOLVED_FORMAT,
      { usage },
    ),
    history: [history('stochastic history 0'), history('stochastic history 1')] as const,
  }
}

/** The stochastic direct light's memory. */
export type StochasticBuffers = ReturnType<typeof allocateStochastic> & HeldSet

/** The stochastic direct light's memory for the shape: `held` where it is for it, else made, `held` given back — where the budget leaves room; none where it does not, with the reason. */
export function ensureStochastic(
  held: StochasticBuffers | undefined,
  device: GPUDevice,
  shape: { tiles: number; samples: number; side: number; temporal: boolean },
) {
  return ensureSet(
    held,
    device,
    {
      key: [shape.tiles, shape.samples, shape.side, shape.temporal],
      what: 'the stochastic direct light',
      label: `${SURFACE_CACHE_ATLAS_LABEL} stochastic direct light`,
    },
    (allocator) => allocateStochastic(allocator, shape),
  )
}
