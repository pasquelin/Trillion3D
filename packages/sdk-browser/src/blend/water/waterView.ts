import { clamp } from '../../../../math/src/scalar/reals.ts'
import { hypot2 } from '../../../../math/src/float/hypot.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { readSingleLayerWaterSetting } from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { blendNodeOf, notDrawn } from '../../placement/hidden.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { BlendGpuItem } from '../state.ts'
import { floorOf, type FloorUnder } from './waterFloor.ts'
import { waterWanted } from './waterTargets.ts'
import type { WaterSurface } from '../../../../sdk-core/src/fluids/waterSurface.ts'
import { boxesOverlap } from '../../../../math/src/geometry/box.ts'
import { waterExclusionVolumesOf } from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'
import type { WaterBodyOptions } from '../../../../sdk-core/src/fluids/waterBody.ts'

/**
 * WHERE THE CAMERA STANDS AGAINST THE WATER, tested once an image (`waterViewOf`): the camera is outside the water bodies, may
 * intersect them (`possibly`: a wave or the near plane's corner can reach it), or is under their surface. A body is a surface whose
 * material is single-layer water (`BlendGpuItem.water`): a volume, the footprint of its world box (x and z) from its bottom (`depth`
 * metres under the surface at rest, `mesh.waterBody`; unset, the scene's geometry under the camera, a ray cast down from the surface;
 * or its box's own bottom when that is deeper) to its top (the surface at rest
 * plus its crest, the highest of the waves that carry it, `mesh.waves`; none for a flat surface).
 *
 * The test is the sweep of the water bodies by a sphere, then the verdict of each body found:
 * - a sphere of `traceDistance` metres swept from the camera up by that distance finds the bodies whose volume it touches; they are
 *   ranked: the bodies the waves carry first, among those with waves or those without the higher overlap priority first;
 * - when the camera is no higher than the surface at rest of any body found (a hundredth of a metre of tolerance, so that it does not
 *   flicker at the surface), the bodies are found again by a sphere of `preciseTraceDistance` metres at the camera, in the order of the
 *   scene;
 * - of those, a body counts only if it has an underwater material (`waterBody.underwaterPostProcess`), the camera is not inside an
 *   exclusion volume that excludes it (`WaterExclusionVolume`: the world's volumes overlapping the body, the camera's point in the box,
 *   the volume's `mode` and `bodies` naming the body), and its surface at rest plus its crest is higher than the one counted before it. The camera is definitely under water when the surface at rest less the camera's
 *   height (the immersion without waves), less the distance of the near plane's corner from the eye, is past the crest, possibly in the
 *   water when its absolute value less that distance is within the crest;
 * - the first body counted whose immersion (the surface at the camera, waves included, less the camera's height) is not negative, or
 *   whose surface at the point closest to the camera lies within 10 centimetres of it across and a crest (10 centimetres at least)
 *   of its height, gives the camera's depth (that immersion); under water is a depth above zero, and -1 is out of water.
 *
 * The verdict also names the `stage` (`WaterView`): the one test every stage of the image reads to know whether it comes before the water
 * or after it.
 */

/** The verdict of an image: where the camera stands, and how far under the water it is (metres, -1 out of it). */
export interface WaterFacts {
  /** `possibly`: a wave or the near plane's corner can reach the camera; `inside`: it is wholly under the surface. */
  intersection: 'outside' | 'possibly' | 'inside'
  depth: number
}

/**
 * The water's verdict of an image, the one every stage reads: when the sky, the fog, the haze and the clouds are laid against the water.
 * - `'none'`: the image draws no single-layer water;
 * - `'before'`: the camera is under the water (`depth` above zero), so they are laid before the water, which is shaded over them, and
 *   the translucent layers are drawn before it too;
 * - `'after'`: the camera is out of the water, so they wait for the water and are laid over it.
 */
export interface WaterView extends WaterFacts {
  stage: 'none' | 'before' | 'after'
}

/** The slack in the camera's height under which the camera is under a surface's impact point, metres. */
const VIEW_TOLERANCE = 0.01

/** The half side across, in metres, of the box round the camera a surface point must lie in, and the least half height of it (the wave
 *  attenuation, 1, times ten centimetres). */
const CAMERA_BOX = 0.1

/** A body of the scene: what the test reads of a water item. */
type Body = Pick<BlendGpuItem, 'bounds' | 'drawSource' | 'placement' | 'hidden'>

/** The node that carries the body. */
type BodyNode = Object3D & { waves?: WaterSurface | null; waterBody?: WaterBodyOptions | null }

/** A body as the test reads it, resolved once an image: its node, waves and fields, and its volume. */
interface Resolved {
  item: Body
  node: BodyNode | undefined
  /** The waves that carry the body, none for a flat surface. */
  waves: WaterSurface | undefined
  /** The body's fields (`WaterBodyOptions`), each at its default where the node sets none. */
  underwater: boolean
  priority: number
  depth: number | undefined
  /** The surface at rest: its waves' level, else the top of its world box. */
  level: number
  /** The crest of its waves, 0 for a flat surface. */
  crest: number
  /** The surface at rest plus its crest. */
  surface: number
  /** The volume, `[minX, bottom, minZ, maxX, top, maxZ]`: the footprint of the world box from `depth` metres under the surface at rest
   *  (or the box's own bottom when deeper) to the box's top or the surface plus its crest when higher. */
  volume: Float64Array
}

/** The bodies of the image, resolved, and the records they reuse. */
const bodies: Resolved[] = [],
  pool: Resolved[] = []

/** Resolves `item` into the record at `index` of the pool: its node, waves, fields, level and volume read once. */
function resolve(
  item: Body,
  index: number,
  eye: ArrayLike<number>,
  floorUnder: FloorUnder | undefined,
) {
  const body =
    pool[index] ??
    (pool[index] = {
      item,
      node: undefined,
      waves: undefined,
      underwater: true,
      priority: 0,
      depth: undefined,
      level: 0,
      crest: 0,
      surface: 0,
      volume: new Float64Array(6),
    })
  const node = blendNodeOf(item) as BodyNode | undefined,
    box = item.bounds!
  body.item = item
  body.node = node
  body.waves = node?.waves ?? undefined
  const options = node?.waterBody
  body.underwater = options?.underwaterPostProcess ?? true
  body.priority = options?.overlapPriority ?? 0
  body.depth = options?.depth
  body.level = body.waves?.level ?? box[4]
  body.crest = body.waves?.crest ?? 0
  body.surface = body.level + body.crest
  const volume = body.volume
  volume[0] = box[0]
  // The bottom: the depth the body declares under its surface, else the scene's geometry under the camera, else its box's own.
  const depth = body.depth
  volume[1] = Math.min(
    box[1],
    depth !== undefined ? body.level - depth : (floorUnder?.(node, box, body.level, eye) ?? box[1]),
  )
  volume[2] = box[2]
  volume[3] = box[3]
  volume[4] = Math.max(box[4], body.surface)
  volume[5] = box[5]
  return body
}

/** The height of the body's surface over the world point `(x, z)`, waves included at their clock. */
const heightAt = (body: Resolved, x: number, z: number) => body.waves?.height(x, z) ?? body.level

/** Whether the body's volume is touched by the sphere of `radius` swept from `eye` up by `lift`, so the sphere's centre travels over
 *  `[eye.y, eye.y + lift]`. */
function touches(body: Resolved, eye: ArrayLike<number>, radius: number, lift: number) {
  const v = body.volume
  const dx = Math.max(v[0] - eye[0], 0, eye[0] - v[3])
  const dz = Math.max(v[2] - eye[2], 0, eye[2] - v[5])
  const dy = Math.max(eye[1] - v[4], v[1] - (eye[1] + lift), 0)
  return dx * dx + dz * dz + dy * dy <= radius * radius
}

/** The distance from the eye to the corner of the near plane in the view's xy (`projection` the camera's, reversed and infinite). */
export function nearCornerDistance(cam: Pick<EngineCamera, 'projection' | 'near' | 'perspective'>) {
  const x = 1 / cam.projection[0],
    y = 1 / cam.projection[5]
  return hypot2(x, y) * (cam.perspective ? cam.near : 1)
}

/** Whether the item is a body the test reads: drawn, with a world box. */
const isBody = (item: Body) => !notDrawn(item) && !!item.bounds

/** The order the sweep's bodies are weighed in: a body with waves before one without; among two alike, the higher priority first. */
function ranked(a: Resolved, b: Resolved) {
  const waved = !!a.waves
  if (waved === !!b.waves) return b.priority - a.priority
  return waved ? -1 : 1
}

/** The world extent of the exclusion volume under test. */
const volumeBox = new Float64Array(6)

/**
 * Whether the camera stands inside an exclusion volume that excludes the body: a volume the body's world holds, that overlaps the body's
 * volume (by their boxes), whose `mode` and `bodies` name the body, and that contains `eye`.
 */
function excluded(body: Resolved, eye: ArrayLike<number>) {
  const volumes = waterExclusionVolumesOf(body.node)
  if (!volumes) return false
  for (const volume of volumes) {
    if (!volume.encompasses(eye[0], eye[1], eye[2]) || !volume.excludes(body.node)) continue
    volume.worldBounds(volumeBox)
    if (boxesOverlap(body.volume, 0, volumeBox, 0)) return true
  }
  return false
}

/** The bodies a pass found and the ones it keeps, refilled each call. */
const found: Resolved[] = [],
  kept: Resolved[] = []

/** Fills `into` with the bodies the sphere touches. */
function sweep(into: Resolved[], eye: ArrayLike<number>, radius: number, lift: number) {
  into.length = 0
  for (const body of bodies) if (touches(body, eye, radius, lift)) into.push(body)
}

/** No body, the camera outside. */
function reset(out: WaterFacts) {
  out.intersection = 'outside'
  out.depth = -1
  return out
}

/**
 * The verdict for a camera at `eye` among the `water` items, into `out`: `corner` the distance of the near plane's corner from the eye
 * (`nearCornerDistance`), `trace` and `precise` the radii of the two spheres (metres).
 */
export function classifyWaterView(
  out: WaterFacts,
  water: readonly Body[],
  eye: ArrayLike<number>,
  corner: number,
  trace: number,
  precise: number,
  floorUnder?: FloorUnder,
) {
  reset(out)
  bodies.length = 0
  for (const item of water)
    if (isBody(item)) bodies.push(resolve(item, bodies.length, eye, floorUnder))
  sweep(found, eye, trace, trace)
  if (!found.length) return out
  if (found.length > 1) found.sort(ranked)
  // The camera is under a body's impact point, or not.
  let under = false
  for (const body of found) under ||= body.level + VIEW_TOLERANCE > eye[1]
  // Above the water, the extended sphere finds the bodies the waves reach; under it, the precise sphere finds those that really overlap.
  if (under) sweep(found, eye, precise, 0)
  kept.length = 0
  let highest = -Infinity
  for (const body of found) {
    if (!body.underwater || excluded(body, eye)) continue
    // Only a body whose surface, waves included, is higher than the one before it is weighed.
    if (body.surface <= highest) continue
    highest = body.surface
    kept.push(body)
  }
  let definitely = false,
    possibly = false
  for (const body of kept) {
    const rest = body.level - eye[1]
    definitely ||= rest - corner > body.crest
    possibly ||= Math.abs(rest) - corner <= body.crest
    // The camera is in the body when under its surface, or when the surface closest to it lies in the box round the camera.
    const immersion = heightAt(body, eye[0], eye[2]) - eye[1]
    const box = body.item.bounds!
    const x = clamp(eye[0], box[0], box[3]),
      z = clamp(eye[2], box[2], box[5])
    const near =
      Math.abs(x - eye[0]) <= CAMERA_BOX &&
      Math.abs(z - eye[2]) <= CAMERA_BOX &&
      Math.abs(heightAt(body, x, z) - eye[1]) <= Math.max(body.crest, CAMERA_BOX)
    if (immersion >= 0 || near) {
      out.depth = Math.max(immersion, out.depth)
      break
    }
  }
  out.intersection = possibly ? 'possibly' : definitely ? 'inside' : 'outside'
  return out
}

/** The verdict of each runtime's last image, and the image it was made for. */
const views = new WeakMap<WebgpuPagesRuntime, WaterView & { frame: number }>()

/**
 * Where the main camera stands against the water this image, and the stage that follows (`WaterView.stage`), tested on the first ask of
 * the image and held for the rest of it. Outside the water where the image draws none, the test is off
 * (`singleLayerWaterUnderwaterTest`) or no body is near.
 */
export function waterViewOf(rt: WebgpuPagesRuntime): Readonly<WaterView> {
  let held = views.get(rt)
  if (!held)
    views.set(rt, (held = { frame: -1, intersection: 'outside', depth: -1, stage: 'none' }))
  if (held.frame === rt.run.frame) return held
  held.frame = rt.run.frame
  reset(held)
  if (!waterWanted(rt)) {
    held.stage = 'none'
    return held
  }
  if (readSingleLayerWaterSetting(rt, 'singleLayerWaterUnderwaterTest')) {
    const cam = rt.run.gate.cam
    const trace = readSingleLayerWaterSetting(rt, 'singleLayerWaterUnderwaterTraceDistance')
    classifyWaterView(
      held,
      rt.blendState.waterItems,
      cam.eye,
      nearCornerDistance(cam),
      trace,
      readSingleLayerWaterSetting(rt, 'singleLayerWaterUnderwaterPreciseTraceDistance'),
      floorOf(rt),
    )
  }
  held.stage = held.depth > 0 ? 'before' : 'after'
  return held
}
