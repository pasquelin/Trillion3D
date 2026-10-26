/**
 * THE WARM-UP OF THE WORLD'S HLOD ACTORS: a switch that draws an actor waits so many frames in a
 * row (`../../geometry/dag/worlds/worldFollow.ts`, `warmWith`), the actor's geometry asked
 * meanwhile, and its textures at the size it covers on screen, so that it does not first show its
 * root page and its atlas's tail — a blur — till the views' requests and the image's feedback,
 * which name only what they see, come back.
 *
 * A switch asks after each actor it is about to draw (`ActorWarmth.warming`): the actors in a cell
 * turning visible, the actor of a cell turning invisible. The first ask — or one after a frame
 * passed unasked — starts the actor's count at `HlodWarmup.frames` and takes the asking
 * cell's content bounds, carried by the pose of the world DAG's instance; each frame asked after
 * counts one down — a frame asked more than once counts once —, and the switch waits while the
 * count is not zero. A frame is the main view's image (`WebgpuViews.mainImages`): the other views
 * drawn in it count none. The actor stays warming, asked or not, till it is drawn or let go
 * (`ActorWarmth.release`, `../../geometry/dag/worlds/worldFollow.ts`).
 *
 * Each image (`warmWorldActors`), every actor warming whose bounds the drawn view's frustum meets
 * asks its geometry — as its count starts, for `HlodWarmup.frames` updates of the streaming; while
 * it stands at zero, for one: the pages of its first `PREFETCH_BUNDLES` bundles past its root page,
 * the coarsest, ahead of the views' requests, the nearer the switch the higher
 * (`../../geometry/residency/pageRequests.ts`, `prefetch`) —, and the textures of each material
 * its clusters wear at the pixels its bounds cover — the diameter of the sphere around them over
 * their distance, at the view's scale, twice — times `textureScale`, `textureClamp` texels at
 * most, a texture several ask at the most of theirs, beside the feedback
 * (`../../materials/virtual/streamer/streamer.ts`, `warm`). Every view drawn is an image of its
 * own, its uniforms and its size the runtime's while it is drawn: each asks at the size it sees.
 * Those asks hold nothing: the count alone holds the switch.
 *
 * The settings are the session's (`HLOD_WARMUP_SETTINGS`), read each frame: off (`hlodWarmup`
 * false), of no frame, or asking neither the geometry nor the textures, no switch waits and the
 * actors warming are let go; the initial load waits on none either (`WorldCells.firstImageShown`).
 */
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { ActorWarmth } from '../../geometry/dag/worlds/worldWarm.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { PHYSICAL_MAP_FIELDS, SURFACE_MAP_FIELDS } from '../../visibility/materialType.ts'
import { placementWorld } from '../../placement/rows/rows.ts'
import { BOX_VALUES, boxTransform } from '../../../../math/src/geometry/box.ts'
import { frustumExcludesBox } from '../../../../math/src/geometry/frustum/box.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../../math/src/geometry/frustum/frustum.ts'
import {
  resolveHlodWarmup,
  type HlodWarmup,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'

/** The nearest distance, metres, the pixels a warming actor covers are measured from: a
 *  centimetre. */
const NEAREST = 0.01
/** The maps of a surface the colour atlas holds; every other is the data atlas's
 *  (`../../materials/classes/materialTextures.ts`). */
const COLOR_FIELDS: ReadonlySet<string> = new Set(['map', 'emissiveMap', 'subsurfaceMap'])
/** Every map a surface may wear, as the material census reads them. */
const MAP_FIELDS = [...SURFACE_MAP_FIELDS, ...PHYSICAL_MAP_FIELDS]
/** The bundles past an actor's root page whose pages its warm-up asks: its first, the coarsest. */
const PREFETCH_BUNDLES = 16

/** A map of an actor's material: its atlas and its texture, its slot there read as it stands. */
type ActorMap = { kind: 'color' | 'data'; texture: Texture }

/** An actor warming: the frames its switch still waits, the frame it was last asked at, and the
 *  bounds its geometry and textures are asked by, in the world. */
type Warming = { left: number; askedAt: number; bounds: Float64Array }

/** A runtime's warm-up: what its cut's world cells ask (`warmth`), and each image's asks for the
 *  geometry and the textures of the actors warming (`ask`). */
type WarmUp = { warmth: ActorWarmth; ask(): void }

/** Per runtime, the warm-up its cut's world cells wait on. */
const warmUps = new WeakMap<object, WarmUp>()

/** Per runtime, the object its session's warm-up settings are read into. */
const read = new WeakMap<object, HlodWarmup>()
/** The warm-up settings of `rt`'s session as they stand (`EngineContext`), read by their resolvers
 *  (`resolveHlodWarmup`) into the runtime's one object: no reading allocates. */
function settingsOf(rt: WebgpuPagesRuntime) {
  let settings = read.get(rt)
  if (!settings) read.set(rt, (settings = {} as HlodWarmup))
  return resolveHlodWarmup(rt.context, settings)
}

type Hold = NonNullable<WebgpuPagesRuntime['context']['worldRoots']>
type Dag = NonNullable<Hold['dag']>

/** Each cell's actor materials, by rank: the materials its clusters wear. */
function materialsOfCells(dag: Dag) {
  const materials = new Map<number, Set<number>>()
  dag.pages.forEach((page, rank) => {
    const cell = dag.hlod.cells[rank]
    let own = materials.get(cell)
    if (!own) materials.set(cell, (own = new Set()))
    own.add((page as { material: number }).material)
  })
  return materials
}

/** Each material's maps, read once its surface is worn. */
function createMaps(hold: Hold) {
  const mapsOf = new Map<number, ActorMap[]>()
  return (material: number): readonly ActorMap[] => {
    const known = mapsOf.get(material)
    if (known) return known
    const surface = hold.surfaces[material] as unknown as Record<string, Texture | undefined>
    if (!surface) return NO_MAPS
    const found: ActorMap[] = []
    for (const field of MAP_FIELDS) {
      const texture = surface[field]
      if (texture) found.push({ kind: COLOR_FIELDS.has(field) ? 'color' : 'data', texture })
    }
    mapsOf.set(material, found)
    return found
  }
}

/** Cell `cell`'s content bounds as instance `instance`'s pose carries them, into `out`. */
function contentOf(hold: Hold, instance: number, cell: number, out: Float64Array) {
  const { content } = hold.table.chain,
    rows = hold.pose,
    at = BOX_VALUES * cell
  if (rows && instance < rows.capacity)
    boxTransform(out, 0, content, at, placementWorld(rows, instance).elements)
  else out.set(content.subarray(at, at + BOX_VALUES))
}

/** What its cut's world cells ask: the actors warming, by cell slot (instance by instance, `cells`
 *  slots each), and the switch's answer for each. */
function createWarmth(
  rt: WebgpuPagesRuntime,
  hold: Hold,
  cells: number,
  actors: Map<number, Warming>,
): ActorWarmth {
  return {
    warming(instance, actor, cell) {
      const slot = instance * cells + actor,
        frame = rt.views.mainImages
      let state = actors.get(slot)
      if (!state || state.askedAt + 1 < frame) {
        state ??= { left: 0, askedAt: frame, bounds: new Float64Array(BOX_VALUES) }
        state.left = settingsOf(rt).frames
        contentOf(hold, instance, cell, state.bounds)
        actors.set(slot, state)
      } else if (state.askedAt < frame && state.left > 0) state.left--
      state.askedAt = frame
      return state.left > 0
    },
    release(instance, actor) {
      actors.delete(instance * cells + actor)
    },
  }
}

/** Each cell's actor's ranks its warm-up asks: those of its first `PREFETCH_BUNDLES` bundles past
 *  its root page — the coarsest: the bundles lie coarsest first —, made at the first ask. */
function createPrefetchOf(dag: Dag, cells: number) {
  let prefetchRanks: number[][] | undefined
  return (cell: number) => {
    if (prefetchRanks) return prefetchRanks[cell]
    const { bundleOf, pages } = dag,
      cellOf = dag.hlod.cells
    const streamed: number[] = []
    bundleOf.forEach((bundle, rank) => {
      if (bundle >= 0 && pages[rank].holder === undefined) streamed.push(rank)
    })
    streamed.sort((a, b) => bundleOf[a] - bundleOf[b])
    const lists: number[][] = Array.from({ length: cells }, () => []),
      taken = new Uint8Array(cells),
      last = new Int32Array(cells).fill(-1)
    for (const rank of streamed) {
      const own = cellOf[rank],
        bundle = bundleOf[rank]
      if (bundle !== last[own]) {
        if (taken[own] === PREFETCH_BUNDLES) continue
        taken[own]++
        last[own] = bundle
      }
      lists[own].push(rank)
    }
    return (prefetchRanks = lists)[cell]
  }
}

/** The actor of cell slot `slot`, in view, asks its geometry (`HlodWarmup.geometry`): as its
 *  count starts, for as many updates as the count; standing at zero, for one. */
function createPrefetch(
  rt: WebgpuPagesRuntime,
  cells: number,
  prefetchOf: (cell: number) => number[],
) {
  return (slot: number, left: number) => {
    const { geometry, frames } = settingsOf(rt),
      world = rt.run.gpuSelection?.world
    const updates = left === frames ? frames : left === 0 ? 1 : 0
    if (!geometry || !world || !updates) return
    const actor = slot % cells,
      ranks = prefetchOf(actor)
    if (!ranks.length) return
    const base = world.pageBase((slot - actor) / cells)
    rt.services.residency.prefetch(
      ranks.map((rank) => base + rank),
      updates,
    )
  }
}

/** The drawn view as `pixelsOf` reads it, taken once an image (`seeView`): its eye in the render
 *  frame, its frustum, and half the projection's scale per axis (`multiple`) and the view's pixels
 *  per unit of it (`scale`). */
function createViewPixels(rt: WebgpuPagesRuntime) {
  const planes = new Float64Array(FRUSTUM_PLANE_VALUES)
  let eye: readonly number[] = [0, 0, 0],
    multiple = 0,
    scale = 0
  const seeView = () => {
    const uniforms = rt.run.selectionUniforms,
      { pixelScale } = uniforms,
      [width, height] = rt.setup.viewport
    eye = uniforms.cameraWorld
    planes.set(rt.run.gate.cam.planesRelative) // the camera's own, never the cut's: no jitter
    multiple = Math.max(pixelScale[0] / width, pixelScale[1] / height)
    scale = Math.max(pixelScale[0], pixelScale[1])
  }
  /** The pixels the drawn view sees world bounds `box` cover: the diameter of the sphere around
   *  them, projected at their centre's distance — a centimetre at least —, at the view's scale,
   *  twice; none out of its frustum. Read in the render frame, the eye at its origin. */
  const pixelsOf = (box: Float64Array) => {
    const x0 = box[0] - eye[0],
      y0 = box[1] - eye[1],
      z0 = box[2] - eye[2],
      x1 = box[3] - eye[0],
      y1 = box[4] - eye[1],
      z1 = box[5] - eye[2]
    if (frustumExcludesBox(planes, x0, y0, z0, x1, y1, z1)) return 0
    const radius = length3(x1 - x0, y1 - y0, z1 - z0) / 2,
      distance = length3(x0 + x1, y0 + y1, z0 + z1) / 2
    return ((2 * multiple * radius) / Math.max(NEAREST, distance)) * scale * 2
  }
  return { seeView, pixelsOf }
}

/**
 * The warm-up of `rt`'s world's actors under its session's settings (`settingsOf`): whether the
 * actor of HLOD cell `actor` of instance `instance`, asked by cell `cell`'s switch, still waits a
 * frame (`warmth`); and each image, the geometry and the textures of the actors warming in view
 * asked (`ask`).
 */
function createWarmUp(rt: WebgpuPagesRuntime): WarmUp {
  const hold = rt.context.worldRoots!,
    dag = hold.dag!,
    cells = dag.hlod.parent.length
  const materials = materialsOfCells(dag),
    maps = createMaps(hold),
    actors = new Map<number, Warming>(),
    warmth = createWarmth(rt, hold, cells, actors),
    prefetch = createPrefetch(rt, cells, createPrefetchOf(dag, cells)),
    { seeView, pixelsOf } = createViewPixels(rt),
    sizes = new Map<number, number>()
  /** Each image: every actor warming in view asks its geometry, and every map of each material
   *  those in view wear is asked at the most pixels any of them asks of it. */
  const ask = () => {
    const frame = rt.run.frame,
      streamer = rt.vis.textures,
      settings = settingsOf(rt)
    sizes.clear()
    if (actors.size) seeView()
    for (const [slot, { left, bounds }] of actors) {
      const seen = pixelsOf(bounds)
      if (!(seen > 0)) continue
      prefetch(slot, left)
      const own = materials.get(slot % cells)
      if (!settings.textures || !own) continue
      const pixels = Math.min(seen * settings.textureScale, settings.textureClamp)
      for (const material of own) sizes.set(material, Math.max(sizes.get(material) ?? 0, pixels))
    }
    if (!streamer) return
    for (const [material, pixels] of sizes)
      for (const { kind, texture } of maps(material)) {
        const slot = (kind === 'color' ? rt.vis.mapLayer : rt.vis.dataLayer).get(texture)
        if (slot !== undefined) streamer.warm(kind, slot, pixels, frame)
      }
  }
  return { warmth, ask }
}

/** A material with no surface yet: no map to ask. */
const NO_MAPS: readonly ActorMap[] = []

/** `rt`'s cut's switches that draw a world HLOD actor wait on its warm-up as the session's
 *  settings stand this frame (`HlodWarmup`), the geometry and the textures of the actors warming
 *  asked; none while it is off, of no frame or asking nothing — the actors warming let go —, or
 *  for a cut that packs no world DAG. */
export function warmWorldActors(rt: WebgpuPagesRuntime) {
  const world = rt.run.gpuSelection?.world
  if (!world || !rt.context.worldRoots?.dag) return
  const { enabled, frames, geometry, textures } = settingsOf(rt)
  if (!enabled || frames === 0 || !(geometry || textures)) {
    warmUps.delete(rt)
    return world.warmWith(undefined)
  }
  let warmUp = warmUps.get(rt)
  if (!warmUp) warmUps.set(rt, (warmUp = createWarmUp(rt)))
  world.warmWith(warmUp.warmth)
  warmUp.ask()
}
