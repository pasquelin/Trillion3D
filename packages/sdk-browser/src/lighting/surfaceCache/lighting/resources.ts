import { ensureSet, type HeldSet } from '../../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../../gpu/core/resourceAllocator.ts'
import { SURFACE_CACHE_ATLAS_LABEL } from '../../../diagnostic/stage/passLabels.ts'
import { LIGHTING_PARAMS, tracedShadowWords } from './layout.ts'
import { type LightingShape, shapeKey, sizesOf } from './params.ts'

/**
 * THE LIGHTING'S OWN MEMORY, made for a shape (`shapeOf`) and again when it changes: the parameters' uniform, the update
 * context (the header and the lists of tiles: it is the dispatches' arguments too), the lights of each tile, a small
 * buffer that stands in for the traced shadows' where they are not made, the radiosity's rays filtered, and the two atlases
 * the radiosity keeps from one image to the next — the rays' radiance for each probe
 * (`trace`, the words of light, a square of rays a probe) and the probes' harmonics (`harmonics`, a layer a channel). They are
 * asked of the device's budget as the atlases are (`ensureLighting`): where it refuses, the lighting is off and says why.
 *
 * THE TRACED SHADOWS' BUFFERS are a set of their own (`ensureTracedShadows`): the masks of the lights of the tiles, the shadow
 * traces they list and the light tiles the traces are found by. They are made when the shadows are traced, keyed by the
 * light tiles alone (`tracedShadowWords`), and given back when they are not: turning the traced path on or off remakes
 * none of the lighting's memory, and the radiosity keeps its history.
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
    tileLights: allocator.buffer('lights of the tiles', sizes.tileLightsWords, 'storage'),
    /** What the passes bind in place of the traced shadows' masks and traces where those are not made. */
    standIn: allocator.buffer('stand-in for the traced shadows', 1, 'storage'),
    filtered: allocator.buffer('filtered radiosity rays', sizes.filteredWords, 'storage'),
    trace: allocator.texture('radiosity trace', [sizes.traceAtlas, sizes.traceAtlas], 'r32uint', {
      usage,
    }),
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

/** The buffers of the traced shadows for `lightTiles` light tiles, asked of `allocator`. */
function allocateTraced(allocator: ResourceAllocator, lightTiles: number) {
  const words = tracedShadowWords(lightTiles)
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
 * The traced shadows' buffers for `lightTiles` light tiles (a tile of the direct list's, a light of it): `held` where they
 * are for that many, else made, `held` given back — where the device's budget leaves room; none where it does not, with the
 * reason.
 */
export function ensureTracedShadows(
  held: TracedShadowBuffers | undefined,
  device: GPUDevice,
  lightTiles: number,
) {
  return ensureSet(
    held,
    device,
    {
      key: [lightTiles],
      what: 'the traced shadows',
      label: `${SURFACE_CACHE_ATLAS_LABEL} traced shadows`,
    },
    (allocator) => allocateTraced(allocator, lightTiles),
  )
}
