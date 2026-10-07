import {
  drawnTriangles,
  type DrawnTriangles,
} from '../../../../sdk-core/src/world/geometry/drawn.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { PageCutPayload } from '../../../../sdk-core/src/page/taskContracts.ts'
import { packDrawn } from '../page/runtimeCut.ts'
import { servePrimitive, type HeldBox } from '../page/runtimePrimitive.ts'
import { cutPagesOffThread } from '../../page/work/host.ts'
import type { WorldNotices } from '../diagnostic/worldNotices.ts'
import { changedRanges, copyRanges, LISTS, type VertexUploads } from './worldDynamicRanges.ts'
import { createPageMotion, type PageMotion } from './pageMotion.ts'
import { fits, heldBox, readInPlace, readingOf, type Reading } from './worldDynamicRead.ts'
import type { Cut } from './worldCuts.ts'

/** THE PER-FRAME UPLOAD BUDGET OF DYNAMIC GEOMETRY, in bytes sent the GPU: past it an
 *  upload waits for the next frame, never dropped; a larger one still goes as a frame's first. Not
 *  derived from a scene: 4 MiB, a 60 × 60 m sea at 15 cm, 480 MB/s at 120 Hz. */
export const DYNAMIC_UPLOAD_BUDGET_BYTES = 4 * 1024 * 1024

/** What a dynamic resource holds beside its pages: the box its vertices never leave, the cut that
 *  serves them again in a larger one, the geometry version read into its lists (`Reading`), where
 *  each page has its vertices (`motion`, its pages bounded where they were cut) and the farthest
 *  any vertex lies on an axis from there (`reach`), which every cut grows those bounds by. */
export type DynamicHeld = Reading & {
  box: HeldBox
  cut: PageCutPayload
  version: number
  motion: PageMotion
  reach: number
}
type Options = NonNullable<Parameters<typeof drawnTriangles>[2]>
type Made = (cut: Cut) => void

/**
 * THE DYNAMIC GEOMETRY OF A WORLD. A geometry that declares `usage: 'dynamic'`, or whose
 * version changes on two consecutive frames — said once under `geometry-dynamic`, naming the
 * mesh —, is cut into pages once, index pages alone (`servePrimitive`), and never again while its
 * triangles keep their corners: a new version is read, and its changed vertices wait for
 * `upload`, which writes them in place under the frame's budget. Vertices that leave the held box
 * serve the same pages again in a larger one — nothing is cut —; corners that change are cut anew.
 */
export function createWorldDynamic(notices: WorldNotices | undefined, counts: { cuts: number }) {
  const state: DynamicState = {
    notices,
    counts,
    frame: 0,
    serial: 0,
    sent: 0,
    changes: new WeakMap(),
    dynamic: new WeakSet(),
    ways: new WeakMap(),
    leaves: new WeakMap(),
    dirty: new Set(),
    reaching: new Set(),
  }
  return {
    wants: (mesh: Mesh) => wants(state, mesh),
    /** A frame was drawn, by the host's `render()` or the session's own loop: its metrics carry
     *  the bytes uploaded since the last one, and two changes a frame apart are consecutive. */
    drew(metrics: { dynamicUploadBytes?: number }) {
      metrics.dynamicUploadBytes = state.sent
      state.sent = 0
      state.frame++
    },
    /** The dynamic resource `mesh` draws read `way`; `made` hears each new one. */
    of: (mesh: Mesh, way: string, options: Options, blended: boolean, made: Made) =>
      dynamicRead(state, mesh, way, { options, blended, made }),
    /** A resource released, its pages no longer served: a later read makes another. */
    forget(cut: Cut) {
      state.dirty.delete(cut)
      state.reaching.delete(cut)
      state.leaves.get(cut)?.()
    },
    /** Writes the read vertices of the resources that changed, in order, until the next would
     *  pass `budget` bytes as `uploads` weighs them; one the session does not draw yet waits.
     *  Returns the bytes sent. Nothing is allocated. */
    upload: (budget: number, uploads: VertexUploads) => upload(state, budget, uploads),
  }
}

/** What a world's dynamic geometry holds between frames (`createWorldDynamic`). */
type DynamicState = {
  notices: WorldNotices | undefined
  counts: { cuts: number }
  frame: number
  serial: number
  /** Bytes uploaded since the last frame drawn. */
  sent: number
  changes: WeakMap<Geometry, { version: number; frame: number }>
  dynamic: WeakSet<Geometry>
  ways: WeakMap<Geometry, Map<string, Promise<Cut | null>>>
  /** How each resource leaves its geometry's reading, once released. */
  leaves: WeakMap<Cut, () => void>
  /** The resources whose read vertices wait for an upload, in the order they changed. */
  dirty: Set<Cut>
  /** The resources whose vertices lie away from where their pages are bounded: a new session
   *  hears where. */
  reaching: Set<Cut>
}

const dynamicOf = (cut: Cut) => cut.dynamic!

/** `cut`'s lists read at its geometry's `version`: they wait for the next `upload`. */
function pend(state: DynamicState, cut: Cut, version: number) {
  dynamicOf(cut).version = version
  state.dirty.add(cut)
  return cut
}

/** Whether `mesh`'s geometry takes the dynamic path: declared, or changed on two frames in a row. */
function wants(state: DynamicState, mesh: Mesh) {
  const { changes, dynamic, frame } = state
  const geometry = mesh.geometry,
    declared = geometry.usage === 'dynamic'
  if (dynamic.has(geometry)) return true
  const seen = changes.get(geometry)
  const detected = !!seen && seen.version !== geometry.version && frame - seen.frame === 1
  // First seen, a geometry has changed on no frame yet.
  if (!seen || seen.version !== geometry.version)
    changes.set(geometry, { version: geometry.version, frame: seen ? frame : -Infinity })
  if (!declared && !detected) return false
  dynamic.add(geometry)
  // Said dynamic from now on, as a declared one: what reads `usage` (the water's carry) sees it.
  geometry.usage = 'dynamic'
  const name = mesh.name || `(unnamed ${mesh.type})`
  state.notices?.say(
    'geometry-dynamic',
    `Mesh "${name}" ${declared ? 'declares' : 'rewrites every frame'} its geometry: its vertices are uploaded in place, never cut again`,
    { kind: 'lifecycle', mesh: name, declared },
  )
  return true
}

/** A new resource for `drawn`: cut, or `before`'s cut served in a larger box. */
async function make(
  state: DynamicState,
  drawn: DrawnTriangles,
  geometry: Geometry,
  blended: boolean,
  before?: Cut,
) {
  const held = before && dynamicOf(before)
  const box = heldBox(drawn, geometry.maxBounds, held?.box)
  // Its corners unchanged, a larger box serves the same pages again: nothing is cut.
  const again = held && fits(before.drawn, drawn, box)
  if (!again) state.counts.cuts++
  const cut = again ? held.cut : await cutPagesOffThread(packDrawn(drawn, blended, { held: true }))
  // Each page bounded by its own corners where they are now: a rewrite measures them again.
  const motion = createPageMotion(cut, new Float32Array(drawn.positions))
  const runtime = servePrimitive(cut, drawn, motion.boxes)
  const [key, users, version] = [`dynamic:${state.serial++}`, new Set<Mesh>(), geometry.version]
  const dynamic: DynamicHeld = {
    ...readingOf(geometry, drawn),
    box,
    cut,
    version,
    motion,
    reach: 0,
  }
  return { key, drawn, runtime, users, held: false, dynamic } satisfies Cut
}

/** How a mesh's dynamic resource is read: its drawn options, its draw family, who hears a new one. */
type ReadWay = { options: Options; blended: boolean; made: Made }

/** The dynamic resource `mesh` draws read `way`: the one held, read again in place, or a new one. */
async function dynamicRead(state: DynamicState, mesh: Mesh, way: string, read: ReadWay) {
  const { options, blended, made } = read
  const geometry = mesh.geometry
  const byWay = state.ways.get(geometry) ?? new Map<string, Promise<Cut | null>>()
  state.ways.set(geometry, byWay)
  let asked = byWay.get(way),
    before = await asked
  // Another mesh of this geometry made its resource meanwhile: it is this one's too, not cut.
  while (byWay.get(way) !== asked) before = await (asked = byWay.get(way))
  if (before && dynamicOf(before).version === geometry.version) return before
  // Its corners and lists kept, a rewrite is read into the resource's own lists, then uploaded.
  if (before && readInPlace(geometry, mesh.primitive, options, dynamicOf(before)))
    return pend(state, before, geometry.version)
  const drawn = drawnTriangles(geometry, mesh.primitive, options)
  if (!drawn) return null
  if (before && fits(before.drawn, drawn, dynamicOf(before).box)) {
    const lists = dynamicOf(before).next
    for (const [list] of LISTS) lists[list]?.set(drawn[list]!) // `fits`: the same lists
    return pend(state, before, geometry.version)
  }
  // A new resource replaces it: what it read and did not upload is read there again.
  if (before) state.dirty.delete(before)
  const leave = () => byWay.get(way) === next && byWay.delete(way)
  // A failed cut leaves no trace, as a static one: the mesh draws nothing, the next read retries.
  const next: Promise<Cut | null> = make(state, drawn, geometry, blended, before ?? undefined).then(
    (cut) => (state.leaves.set(cut, leave), made(cut), cut),
    () => (leave(), null),
  )
  byWay.set(way, next)
  return next
}

/** The resources that changed written in order under `budget` (`createWorldDynamic.upload`). */
function upload(state: DynamicState, budget: number, uploads: VertexUploads) {
  const { dirty, reaching } = state
  let spent = 0
  // A new session's roots start at rest: each resource that moved tells them its reach.
  if (uploads.renewed()) for (const cut of reaching) dirty.add(cut)
  for (const cut of dirty) {
    const held = dynamicOf(cut),
      changed = changedRanges(cut.drawn, held.next),
      bytes = uploads.weigh(cut, changed.ranges, changed.bytes)
    if (spent && spent + bytes > budget) break
    copyRanges(cut.drawn, held.next, changed.ranges)
    // Each page where its vertices are now, the reach the farthest of them this frame.
    held.reach = held.motion.measure(cut.drawn.positions, changed.ranges)
    if (held.reach > 0) reaching.add(cut)
    else reaching.delete(cut)
    if (!uploads.write(cut, changed.ranges, changed.box, held.reach, held.motion.boxes)) continue
    spent += bytes
    dirty.delete(cut)
  }
  state.sent += spent
  return spent
}
