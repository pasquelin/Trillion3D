import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { skyLightReadBindEntries } from '../../../modules/sky/skyLight/read.ts'
import {
  hitLightingProbesRun,
  type HitLightingSettings,
} from '../../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { litListGroups } from '../../reflections/hitLighting/kernels.ts'
import {
  admitLitListResources,
  litMostRays,
  litRunBinder,
  singleBounceLightWord,
  type LitListGroups,
  type LitListResources,
} from '../../reflections/hitLighting/listPasses.ts'
import { deviceRefusal, retryDue, type Refusal } from '../../../gpu/core/refusal.ts'
import { lightProfileBindEntries } from '../../lightProfile/profileBindings.ts'
import type { LightProfileResources } from '../../lightProfile/profileBindings.ts'
import { isPending, isReady } from '../../rays/sceneTrace/sceneMaskHold.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { surfaceHitCardsEntries } from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import {
  CACHE_LIT_BINDINGS as O,
  CACHE_TRACED_SCENE,
  CACHE_TRACE_BINDINGS as B,
  CACHE_TRACE_SKY_LIGHT,
} from './cacheBindings.ts'
import { CACHE_LIT_COMPACT_BINDINGS, CACHE_LIT_HIT, CACHE_LIT_HOST } from './cacheHitLitWgsl.ts'
import {
  cacheLitCompactLayout,
  cacheLitDirectLayout,
  cacheLitFinishLayout,
  cacheLitMaker,
  cacheLitSceneLayout,
  type CacheLitKernels,
} from './cacheHitLitKernels.ts'
import type { CacheWiring, Queued } from './cacheGroups.ts'
import type { CacheStorage, TraceAtlas } from './cacheStorage.ts'
import { tracedCacheMaker } from './cacheKernels.ts'
import { CACHE_TILE_SIDE } from './cacheLayout.ts'

/** The rays a tile of the trace atlas holds. */
const TILE_RAYS = CACHE_TILE_SIDE * CACHE_TILE_SIDE

/** What an image gives the radiance cache's hit lighting: the hit lighting's settings (those of the reflections' family), the light functions' atlas and the light profiles', read only where the settings light the probes' hits. */
export interface CacheHitLighting {
  settings: HitLightingSettings
  lightFunction: GPUBindingResource
  lightProfile: LightProfileResources
  /** The exposure of the view the update is queued for, as the CPU knows it (`PreExposure.exposure`: the view's last adapted exposure), which the lights' inverse exposure blend reads, as the other hosts of the hit lighting read their own view's: never the GPU's uniform, which every view shares. */
  exposure: number
}

/** The mode word the cache's hits are lit with (`cache.lit`): the settings' lights and shadows, the one bounce and no refraction or reflection capture. */
export const cacheHitLightWord = (hit: CacheHitLighting) => singleBounceLightWord(hit.settings)

/** The word the maps' rays were lit with, after the trace: the hit lighting's where the trace ran its lit path (`ran`), the cards' (0) otherwise, whatever the settings or the kernels ask. */
export const cacheLitWordOf = (hit: CacheHitLighting | null | undefined, ran: boolean) =>
  ran && hit ? cacheHitLightWord(hit) : 0

/** The tiles of the trace atlas a slice may hold while the hit lighting runs: the most whose rays' radiance fits one storage binding of the device. */
export const cacheLitMostTiles = (device: GPUDevice) => Math.floor(litMostRays(device) / TILE_RAYS)

/** Whether the settings ask the cache's rays lit where their hits stand: they light the probes' hits (`hitLightingProbesRun`) and the cache's rays go through the triangles (`traced`). The user's mode alone: the word the maps are made under follows it, never what an image has (a scene trace, kernels, a budget). */
export const cacheLitWanted = (queued: Pick<Queued, 'hit'>, traced: boolean) =>
  traced && !!queued.hit && hitLightingProbesRun(queued.hit.settings)

/** Whether this image's cache rays are lit where their hits stand: the settings ask it (`cacheLitWanted`) and the image has the scene trace. An image without it lights them from the cards, the mode staying the user's. */
export const cacheLitAsked = (queued: Queued, traced: boolean) =>
  !!queued.rays && cacheLitWanted(queued, traced)

/**
 * THE KERNELS OF THE HIT LIGHTING of this image's rays, where it is asked (`cacheLitAsked`): over the held set of graph masks, the trace that marks the hits among them, so that it and the passes run on one set. Undefined where it is not asked, the rays then light their hits
 * from the cards. The kernels may not be ready: the caller waits while they are `pending` and lights from the cards where their compile was refused (they try again themselves).
 */
export function cacheLitKernelsOf(
  device: GPUDevice,
  queued: Queued,
  light: CacheStorage['shape']['light'],
  traced: boolean,
): CacheLitKernels | undefined {
  if (!cacheLitAsked(queued, traced)) return undefined
  return queued.rays!.sceneTrace.maskHold.use(
    'radiance cache hit lighting',
    light,
    cacheLitMaker(device, light),
    isReady,
    isPending,
  )?.kernel
}

/**
 * THE PLAIN TRACED KERNELS of the cache's rays (the ones without the marks), asked of the held set every image the rays go through the triangles, whether or not the hit lighting is asked: so that they are compiled and held beside the hit lighting's, and a fallback to the cards (a refusal, a kernel retry) traces through the triangles at once, with no retrace when they land.
 */
export const cacheTracedKernelOf = (
  device: GPUDevice,
  rays: SceneRays,
  light: CacheStorage['shape']['light'],
) =>
  rays.sceneTrace.maskHold.use(
    'radiance cache',
    light,
    tracedCacheMaker(device, light),
    isReady,
    isPending,
  )?.kernel

/** The images in a row the hit lighting is admitted at a slice smaller than the one refused before a refusal is forgotten (else its count is kept, so that a refusal that comes back doubles the wait). */
export const CACHE_LIT_CALM_IMAGES = 600

/** A refusal of the hit lighting's resources (the lists, or the marks texture of the trace atlas), with the slice of tiles it was asked for, and the images admitted since at a smaller slice (counted in place: it is read every image). */
export interface CacheLitRefusal {
  readonly refusal: Refusal
  readonly tiles: number
  calm: number
}

/** The refusal of a slice of `tiles` tiles at `now`, after `last` (the doubling wait of the engine's one backoff; `random`, a number in 0 .. 1, spreads it). */
export const cacheLitRefused = (
  last: CacheLitRefusal | undefined,
  tiles: number,
  now: number,
  random?: number,
): CacheLitRefusal => ({ refusal: deviceRefusal(now, last?.refusal, random), tiles, calm: 0 })

/** The refusal kept after an image admitted a slice of `tiles` tiles: forgotten once the slice refused was itself admitted, or after `CACHE_LIT_CALM_IMAGES` images admitted smaller ones; else kept, so that the refusal that comes back doubles the wait and does not restart it. */
export const cacheLitAdmitted = (
  refused: CacheLitRefusal | undefined,
  tiles: number,
): CacheLitRefusal | undefined =>
  !refused || tiles >= refused.tiles || ++refused.calm >= CACHE_LIT_CALM_IMAGES
    ? undefined
    : refused

/** Whether `refused` still keeps the hit lighting from being asked: its wait has not ended, whatever the slice asked since (a slice that moves with the queue must not flip the word every few images). */
export const cacheLitRefusalWaits = (refused: CacheLitRefusal | undefined, now: number) =>
  refused !== undefined && !retryDue(refused.refusal, 0, now)

/** The tiles a trace takes at a time: the hit lighting's slice while it is wanted, the plain trace too (the marks atlas held serves it, no churn between the two), else all that was asked. */
export const cacheTraceSliceOf = (wanted: boolean, litTiles: number, asked: number) =>
  wanted ? litTiles : asked

/** The tiles the hit lighting's lists are sized for: the tiles the update traces, at most `cacheLitMostTiles`. */
export const cacheLitTiles = (device: GPUDevice, traceTiles: number) =>
  Math.min(traceTiles, cacheLitMostTiles(device))

/**
 * The resources for `tiles` tiles (`cacheLitTiles`), kept while they hold as many rays; none where the device's budget refuses them (`admitLitListResources`), the rays then light their hits from the cards.
 */
export const cacheLitResourcesFor = (
  device: GPUDevice,
  held: LitListResources | undefined,
  tiles: number,
) =>
  admitLitListResources(device, held, 'Trillion3D radiance cache hit lighting', tiles * TILE_RAYS)

/**
 * The binder of the radiance cache's hit lighting: `(kernels, storage, queued, rays, hit, atlas, resources)` the run of the image, whose groups over the kernels' layouts, the scene trace of the image and the lists are made again only where a resource they name moved; the run is one object the binder keeps, written over each image. The groups of the passes that
 * need the cache's tile list read it whole.
 */
export function cacheHitLitBinder(device: GPUDevice, wiring: CacheWiring) {
  const identity = createWebgpuBindIdentity()
  const sceneGroup = sceneTraceGroupBinder(device)
  const runOf = litRunBinder<CacheLitKernels>(CACHE_TRACED_SCENE.group)
  let groups: LitListGroups | undefined
  return (
    kernels: CacheLitKernels,
    s: CacheStorage,
    q: Queued,
    rays: SceneRays,
    hit: CacheHitLighting,
    atlas: TraceAtlas,
    lit: LitListResources,
  ) => {
    const marks = atlas.marks!
    const { next } = identity
    next.length = 0
    next.push(kernels, s, atlas, lit.list, lit.sorted, lit.args, lit.radiance, q.lights)
    next.push(q.sky.cube, q.sky.harmonics, q.sky.params, q.reads.hit.tables, q.reads.hit.depth)
    next.push(q.reads.hit.indirect!, q.reads.hit.instances, hit.lightFunction as object)
    next.push(hit.lightProfile.view, hit.lightProfile.sampler, s.shape.light)
    next.push(rays.views.nodes, rays.views.frames, rays.views.worlds, rays.views.tree)
    const scene = sceneGroup(cacheLitSceneLayout(device), rays.sceneTrace, CACHE_TRACED_SCENE.first)
    if (identity.moved() || !groups) {
      const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
        device.createBindGroup({ layout, entries })
      const lists = {
        litList: wholeBuffer(lit.list),
        litSorted: wholeBuffer(lit.sorted),
        litRadiance: wholeBuffer(lit.radiance),
      }
      const probes = {
        grid: wholeBuffer(wiring.grid),
        queue: wholeBuffer(wiring.queue),
        table: wiring.table,
        params: wholeBuffer(s.params),
      }
      const ownBindings = { ...B, ...O }
      groups = {
        scene,
        compact: group(
          cacheLitCompactLayout(device),
          namedEntries(CACHE_LIT_COMPACT_BINDINGS, {
            ...probes,
            tiles: wholeBuffer(s.tiles),
            marks,
            litList: lists.litList,
          }),
        ),
        ...litListGroups(device, lit, marks),
        direct: group(cacheLitDirectLayout(device), [
          ...namedEntries(ownBindings, {
            ...probes,
            marks,
            lights: wholeBuffer(q.lights),
            ...lists,
          }),
          ...dagReadGroupEntries(rays.views),
          { binding: CACHE_LIT_HOST.lightFunction.atlas, resource: hit.lightFunction },
          ...lightProfileBindEntries(CACHE_LIT_HOST.lightProfile, hit.lightProfile),
        ]),
        finish: group(cacheLitFinishLayout(device, s.shape.light), [
          ...namedEntries(ownBindings, {
            ...probes,
            raw: atlas.view,
            marks,
            ...lists,
          }),
          ...skyLightReadBindEntries(CACHE_TRACE_SKY_LIGHT, q.sky),
          ...surfaceHitCardsEntries(CACHE_LIT_HIT, q.reads.hit),
        ]),
      }
    } else groups.scene = scene
    return runOf(kernels, lit, groups, hit.settings.bucket)
  }
}
