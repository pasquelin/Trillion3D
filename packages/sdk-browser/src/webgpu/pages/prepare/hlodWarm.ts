/**
 * THE WARMTH OF THE WORLD'S HLOD ACTORS: a switch draws an actor only once its textures show it at
 * the resolution its pixels ask (`../../../gpu/dag/worldFollow.ts`, `warmWith`).
 *
 * An actor not drawn yet asks no tile: the image's feedback names only what it samples. A switch
 * that draws it would show its atlas's tail — a blur — till the next feedback came back. So each
 * actor about to draw asks, beside the feedback, the tiles of the level of each of its textures
 * that matches the pixels its cell covers from the eye — read in the frame of the world DAG's
 * instance —, within a 2 048-texel side and what a tile pass takes beside the feedback
 * (`../../tile/streamer.ts`, `warm`); its switch waits until they all reside, asked again each cut.
 * A level of the tail is always resident: nothing to wait for. Each cell is read once an image.
 *
 * A pool too small to hold them, or a read that never lands, holds no switch for more than
 * `WARM_ASKS` cuts that asked: the wait is then given up — the switch goes on what resides, as a
 * cut goes on a coarser page — till its actor draws (`drawn`), and never starts again before. A
 * held image asks nothing, and counts nothing.
 */
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { ActorWarmth } from '../../../gpu/dag/worldFollow.ts'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'
import { PHYSICAL_MAP_FIELDS, SURFACE_MAP_FIELDS } from '../../../visibility/materialType.ts'
import { placementWorld } from '../../../placement/rows.ts'
import { BOX_VALUES } from '../../../../../math/src/geometry/box.ts'
import { boxPointDistance } from '../../../../../math/src/geometry/boxDistance.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { keepNumbers, transformAffinePoint } from '../../../../../math/src/vector/vector.ts'
import { MATRIX_VALUES } from '../../../../../math/src/batch/strides.ts'

/** The cuts a switch waits for its actor's textures at most. */
const WARM_ASKS = 30
/** The texels a warm level asks at most along its side. */
const WARM_TEXELS = 2048
/** The maps of a surface the colour atlas holds; every other is the data atlas's
 *  (`../../core/materialTextures.ts`). */
const COLOR_FIELDS: ReadonlySet<string> = new Set(['map', 'emissiveMap', 'subsurfaceMap'])
/** Every map a surface may wear, as the material census reads them. */
const MAP_FIELDS = [...SURFACE_MAP_FIELDS, ...PHYSICAL_MAP_FIELDS]

/** A map of an actor's material: its atlas and its texture, its slot there read as it stands. */
type ActorMap = { kind: 'color' | 'data'; texture: Texture }

/** Per runtime, the warmth its cut's world cells wait on. */
const warmths = new WeakMap<object, ActorWarmth>()

/**
 * The warmth of `rt`'s world's actors: whether the actor of HLOD cell `cell` of instance `instance`
 * is warm — every map of every material its clusters wear resident at the level its pixels ask,
 * those not asked for the next tile pass —, and its wait ended once it draws. Warm with no texture
 * streamer or no surface yet: nothing to wait for.
 */
function createWarmth(rt: WebgpuPagesRuntime): ActorWarmth {
  const hold = rt.context.worldRoots!,
    dag = hold.dag!,
    cells = dag.hlod.parent.length
  /** Each cell's actor materials, by rank: the materials its clusters wear. */
  const materials = new Map<number, Set<number>>()
  dag.pages.forEach((page, rank) => {
    const cell = dag.hlod.cells[rank]
    let own = materials.get(cell)
    if (!own) materials.set(cell, (own = new Set()))
    own.add((page as { material: number }).material)
  })
  /** Each material's maps, read once its surface is worn. */
  const mapsOf = new Map<number, ActorMap[]>()
  const maps = (material: number): readonly ActorMap[] => {
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
  /** Per cell slot: the image it was last read at (plus one, 0 for none) and its answer then, and
   *  the cuts that asked it since its wait began — `WARM_ASKS` and more, given up. */
  const readAt = new Uint32Array(cells * Math.max(1, hold.pose?.capacity ?? 1)),
    readWarm = new Uint8Array(readAt.length),
    asks = new Uint8Array(readAt.length)
  /** Per instance, its pose as last inverted, and that inverse: the eye in the cells' frame. */
  const posed: Float64Array[] = [],
    inverses: Float64Array[] = []
  const eye = [0, 0, 0]
  /** The eye in instance `instance`'s frame, the cells' bounds' own. */
  const localEye = (instance: number) => {
    const world = rt.run.selectionUniforms.cameraWorld
    const rows = hold.pose
    if (!rows || instance >= rows.capacity) {
      eye[0] = world[0]
      eye[1] = world[1]
      eye[2] = world[2]
      return eye
    }
    const matrix = placementWorld(rows, instance).elements
    posed[instance] ??= new Float64Array(MATRIX_VALUES).fill(NaN)
    inverses[instance] ??= new Float64Array(MATRIX_VALUES)
    if (!keepNumbers(posed[instance], matrix)) invertMatrix4(inverses[instance], matrix)
    return transformAffinePoint(eye, inverses[instance], world[0], world[1], world[2])
  }
  /** Whether cell `cell` of `instance`'s actor maps reside at the level its pixels ask now. */
  const read = (instance: number, cell: number, own: ReadonlySet<number>) => {
    const streamer = rt.vis.textures!,
      { pixelScale } = rt.run.selectionUniforms,
      frame = rt.run.frame
    // The pixels its cell covers from the eye: its widest side over its distance.
    const bounds = hold.table.chain.bounds,
      at = BOX_VALUES * cell
    const side = Math.max(
      bounds[at + 3] - bounds[at],
      bounds[at + 4] - bounds[at + 1],
      bounds[at + 5] - bounds[at + 2],
    )
    const [x, y, z] = localEye(instance)
    const distance = boxPointDistance(bounds, at, x, y, z)
    const pixels = Math.min(
      WARM_TEXELS,
      (side * Math.max(pixelScale[0], pixelScale[1])) / Math.max(distance, side),
    )
    let warm = true
    for (const material of own)
      for (const { kind, texture } of maps(material)) {
        const slot = (kind === 'color' ? rt.vis.mapLayer : rt.vis.dataLayer).get(texture)
        if (slot !== undefined) warm = streamer.warm(kind, slot, pixels, frame) && warm
      }
    return warm
  }
  return {
    ready(instance, cell) {
      const own = materials.get(cell)
      if (!rt.vis.textures || !own) return true
      const slot = instance * cells + cell
      if (slot >= readAt.length || asks[slot] >= WARM_ASKS) return true
      const stamp = rt.run.frame + 1
      if (readAt[slot] === stamp) return readWarm[slot] === 1
      readAt[slot] = stamp
      const warm = read(instance, cell, own)
      readWarm[slot] = Number(warm)
      asks[slot] = warm ? 0 : asks[slot] + 1
      return warm
    },
    drawn(instance, cell) {
      const slot = instance * cells + cell
      if (slot < asks.length) asks[slot] = 0
    },
  }
}

/** A material with no surface yet: no map to wait for. */
const NO_MAPS: readonly ActorMap[] = []

/** `rt`'s cut waits for its world's HLOD actors to warm before a switch draws one; nothing for a
 *  cut that packs no world DAG. */
export function warmWorldActors(rt: WebgpuPagesRuntime) {
  const world = rt.run.gpuSelection?.world
  if (!world || !rt.context.worldRoots?.dag) return
  let warmth = warmths.get(rt)
  if (!warmth) warmths.set(rt, (warmth = createWarmth(rt)))
  world.warmWith(warmth)
}
