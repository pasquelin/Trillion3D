import { length3 } from '../../../../math/src/vector/vector.ts'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { AtlasState } from './atlasState.ts'
import { sameElements, sameRange } from '../../../../math/src/matrix/matrixElements.ts'
import { halfExtent, holding } from './objectBoxes.ts'
import { minimumAxisScale, objectWorldBox } from './objectRecords.ts'

/**
 * THE TABLE OF THE PLACEMENTS THAT HAVE A DISTANCE FIELD (`objectTracker.ts` keeps it level with the
 * cut's roots): the objects in the order of the GPU's records, the records to write, the regions
 * each change names for the global field to composite again. A placement is added to the atlas's meshes
 * (`AtlasState.reference`), a mesh freed when its last placement is gone.
 */

/** What the tracker reads of a cut's root. */
export interface TrackedRoot {
  readonly mesh?: number
  /** Set on the world DAG's root, which places no mesh itself (`hlodObjects.ts`). */
  readonly hlod?: unknown
  /** A stand-in for it (`hlodObjects.ts`): the field of an HLOD cell's actors it places, the instance
   *  of the world DAG it lies in and the rank of the cut's root it stands for. */
  readonly field?: MeshDistanceField
  readonly instance?: number
  readonly standsFor?: number
  readonly world: { readonly elements: ArrayLike<number> }
  readonly worldAt?: number
  readonly parked?: boolean
  readonly hidden?: boolean
  /** The root's mark (`MARK_BITS`): how it casts, whether it is the world DAG's. */
  readonly mark?: number
  readonly drawDistance?: { readonly min: number; readonly max: number }
}

/** A placement in the scene's table. */
export interface TrackedObject {
  root: TrackedRoot
  rank: number
  readonly field: MeshDistanceField
  readonly asset: number
  version: number
  visible: boolean
  moving: boolean
  /** The root's mark as the record last took it. */
  mark: number
  /** The world box, centimetres, and the world matrix, as the records last took them. */
  box: Float64Array
  world: Float64Array
  key: string
}

/** The two kinds of cache the global field keeps: the mostly static meshes', then the full one. */
export const CACHE_STATIC = 0
export const CACHE_FULL = 1

/** The regions changed since they were last taken, a flat list of boxes (six numbers each) for each cache. */
export type ModifiedBoxes = [number[], number[]]

/** Everything a placement is told apart by: what it places — a compiled mesh's field or cards, or, in an
 *  instance of the world DAG, an HLOD cell's — and its world. */
export const keyOf = (placed: Pick<MeshDistanceField, 'mesh' | 'hlodCell'>, root: TrackedRoot) => {
  const m = root.world.elements
  const owner = placed.hlodCell ? `h${root.instance ?? 0}:` : ''
  return `${owner}${placed.mesh}:${Array.from({ length: 16 }, (_, k) => m[k]).join(',')}`
}

/** Whether a root is shown: neither parked nor hidden. */
export const rootVisible = (root: TrackedRoot) => !(root.parked || root.hidden)

/** The table: its objects, the records to write, the regions changed. */
export interface ObjectTable {
  /** The objects in the order of the GPU's records; a removed one is replaced by the last. */
  readonly objects: TrackedObject[]
  readonly atlas: AtlasState
  readonly upload: Set<number>
  readonly modified: ModifiedBoxes
}

export const createObjectTable = (atlas: AtlasState): ObjectTable => ({
  objects: [],
  atlas,
  upload: new Set(),
  modified: [[], []],
})

const note = (table: ObjectTable, caches: readonly number[], box: ArrayLike<number>) =>
  caches.forEach((cache) => table.modified[cache].push(...Array.from(box)))
const cacheOf = (moving: boolean) => (moving ? CACHE_FULL : CACHE_STATIC)

/** The world box of a root's placement of `field`, none where the scene leaves it out. */
export function measure(root: TrackedRoot, field: MeshDistanceField, maxRadius: number) {
  if (!(minimumAxisScale(root.world.elements) >= 0.0001)) return undefined
  const box = objectWorldBox(new Float64Array(6), root.world.elements, field)
  return length3(halfExtent(box, 0), halfExtent(box, 1), halfExtent(box, 2)) < maxRadius
    ? box
    : undefined
}

/** Object `at` taken out of the table, its asset let go, its region named; the last takes its place. */
export function removeObject(table: ObjectTable, at: number) {
  const { objects, upload } = table
  const gone = objects[at]
  note(table, [cacheOf(gone.moving)], gone.box)
  table.atlas.release(gone.asset)
  const last = objects.pop()!
  if (last !== gone) {
    objects[at] = last
    upload.add(at)
  }
  upload.delete(objects.length)
}

/** `root`'s placement of `field`, at rank `rank` of the roots and in `box`, added to the table. */
export function addObject(
  table: ObjectTable,
  rank: number,
  root: TrackedRoot,
  field: MeshDistanceField,
  box: Float64Array,
  moving: boolean,
) {
  const entry: TrackedObject = {
    root,
    rank,
    field,
    key: keyOf(field, root),
    box,
    moving,
    asset: table.atlas.reference(field),
    version: root.worldAt ?? 0,
    visible: rootVisible(root),
    mark: root.mark ?? 0,
    world: Float64Array.from({ length: 16 }, (_, k) => root.world.elements[k]),
  }
  table.upload.add(table.objects.length)
  table.objects.push(entry)
  note(table, [cacheOf(moving)], box)
}

/** The regions a change of `entry` to `box`, `visible` and `moving` names: the box that holds both its
 *  places if they are near, else both; in both kinds of cache where it began or stopped moving. */
function noteChange(
  table: ObjectTable,
  entry: TrackedObject,
  { box, visible, moving }: { box: Float64Array; visible: boolean; moving: boolean },
) {
  const flipped = entry.moving !== moving
  // Any change of world or box names its regions, none rounded away: a slow turn's steps, each under
  // a tolerance, would otherwise leave the old poses in the field.
  const moved =
    !sameElements(entry.world, entry.root.world.elements) || !sameRange(entry.box, box, 6)
  if (!(flipped || moved || entry.visible !== visible)) return
  const both = holding(entry.box, box)
  const caches = flipped ? [CACHE_STATIC, CACHE_FULL] : [cacheOf(moving)]
  if (!moved || both.near) note(table, caches, moved ? both.box : box)
  else {
    note(table, caches, entry.box)
    note(table, caches, box)
  }
}

/** `entry`, object `at`, taken to the state of its root; false where the scene no longer keeps it. */
export function updateObject(
  table: ObjectTable,
  entry: TrackedObject,
  at: number,
  state: { rank: number; moving: boolean; maxRadius: number },
) {
  const { rank, moving } = state
  const box = measure(entry.root, entry.field, state.maxRadius)
  if (!box) return false
  const visible = rootVisible(entry.root)
  noteChange(table, entry, { box, visible, moving })
  entry.world.set(Array.from({ length: 16 }, (_, k) => entry.root.world.elements[k]))
  const mark = entry.root.mark ?? 0
  Object.assign(entry, { rank, version: entry.root.worldAt ?? 0, visible, moving, box, mark })
  entry.key = keyOf(entry.field, entry.root)
  table.upload.add(at)
  return true
}

/** The record indices to write, ascending; the set is emptied. */
export function takeUpload({ objects, upload }: ObjectTable) {
  const indices = [...upload].filter((i) => i < objects.length).sort((a, b) => a - b)
  upload.clear()
  return indices
}

/** The regions changed since the last call, per cache. */
export const takeModified = ({ modified }: ObjectTable): ModifiedBoxes => [
  modified[0].splice(0),
  modified[1].splice(0),
]
