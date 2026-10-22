/**
 * THE DRAW DISTANCES OF THE PROXY'S PLACEMENTS: a placement out of the draw distances its object names, from the main view's
 * eye, is met by no ray (`distance`): its instance wears no node, as a parked one's. The placements that name a farthest
 * distance (`DRAW_DISTANCE_MARK`) are kept (`note`); each is judged on the world-space centre of its root's bounds, as the cut
 * tests it (`../shader/drawDistanceWgsl.ts`), held until its world is written (`worldWritten`). They are judged again only
 * when the eye, the scale or a placement moved since they were last, where a buffer holds the instances, and the ones that
 * flipped are written in runs.
 */
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { INSTANCE, INSTANCE_WORDS } from '../../../lighting/bounce/runtime/runtimeLayout.ts'
import { DAG_NODE_FLOATS, type PackedDag } from '../types.ts'
import { NODE_MAX, NODE_MIN } from '../nodeLayout.ts'
import { DRAW_DISTANCE_MARK } from '../frameTable.ts'
import { outsideDrawDistances } from '../drawDistance.ts'
import type { createProxyState } from './proxyState.ts'

/** The world-space centre of placement `w`'s root's bounds — the box of the node its descent starts from, through the
 *  placement's world — written into `into` at `3 · w`. */
function writeCentre(packed: PackedDag, w: number, into: Float64Array) {
  const at = packed.rootBases[w] * DAG_NODE_FLOATS,
    { elements: m } = packed.worldSources[w].world,
    { nodes } = packed
  const x = 0.5 * (nodes[at + NODE_MIN] + nodes[at + NODE_MAX]),
    y = 0.5 * (nodes[at + NODE_MIN + 1] + nodes[at + NODE_MAX + 1]),
    z = 0.5 * (nodes[at + NODE_MIN + 2] + nodes[at + NODE_MAX + 2])
  into[3 * w] = m[0] * x + m[4] * y + m[8] * z + m[12]
  into[3 * w + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
  into[3 * w + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
}

/** What the placements' draw distances are judged by (`createProxyDistances`): the proxy's state and the packing. */
type DistanceHost = Pick<
  ReturnType<typeof createProxyState>,
  'slots' | 'held' | 'arena' | 'writeInstances'
> & { packed: PackedDag }

/** What the draw distances were last judged on: the eye, the scale (NaN: the cull off), and a count of what moved since — a
 *  placement's world written, a placement that names a distance or stopped naming it, a root appended. */
type Judged = { x: number; y: number; z: number; scale: number; moved: number; at: number }

/** Whether the view `eye`, `scale` and the placements are as they were when `judged` judged them. */
const unchanged = (judged: Judged, eye: ArrayLike<number>, scale: number) =>
  judged.moved === judged.at &&
  eye[0] === judged.x &&
  eye[1] === judged.y &&
  eye[2] === judged.z &&
  (scale === judged.scale || (scale !== scale && judged.scale !== judged.scale))

/** The instances of the placements `sorted`, increasing, written one write a run of consecutive ones. */
function writeRuns(write: DistanceHost['writeInstances'], sorted: Uint32Array) {
  for (let k = 0; k < sorted.length;) {
    let end = k + 1
    while (end < sorted.length && sorted[end] === sorted[end - 1] + 1) end++
    write(sorted[k], end - k)
    k = end
  }
}

/** Whether placement `w` lies out of its draw distances from `eye`, `scale` times them (the cull off where `scale` is
 *  undefined): its root's centre, made where `centred` has it not, in `centres`. */
function outsideDistances(
  packed: PackedDag,
  centres: Float64Array,
  centred: Uint8Array,
  w: number,
  eye: ArrayLike<number>,
  scale: number | undefined,
) {
  if (scale === undefined) return false
  if (!centred[w]) {
    writeCentre(packed, w, centres)
    centred[w] = 1
  }
  const dx = centres[3 * w] - eye[0],
    dy = centres[3 * w + 1] - eye[1],
    dz = centres[3 * w + 2] - eye[2]
  return outsideDrawDistances(
    dx * dx + dy * dy + dz * dz,
    packed.drawDistance?.[2 * w] ?? 0,
    packed.drawDistance?.[2 * w + 1] ?? 0,
    scale,
  )
}

export function createProxyDistances(host: DistanceHost) {
  const { slots, held, arena, writeInstances, packed } = host
  /** The placements that name a farthest draw distance (`DRAW_DISTANCE_MARK`). */
  const named = new Set<number>()
  const judged: Judged = { x: NaN, y: NaN, z: NaN, scale: NaN, moved: 0, at: -1 }
  /** The world-space centres of the roots' bounds, each held until its world is written again. */
  const centres = new Float64Array(3 * slots),
    centred = new Uint8Array(slots)
  /** The placements whose instance `distance` flipped this call, to be written in runs. */
  const flipped = new Uint32Array(slots)
  return {
    /** Placement `w` wears the mark `mark`: it names a farthest draw distance or stops naming one. */
    note(w: number, mark: number) {
      judged.moved++
      if (mark & DRAW_DISTANCE_MARK) named.add(w)
      else {
        named.delete(w)
        held.culled.delete(w)
      }
    },
    /** Row `w` of the culling's world table was written: its centre is made again where it is next judged. */
    worldWritten(w: number) {
      if (w < 0 || w >= slots) return
      centred[w] = 0
      judged.moved++
    },
    /** The placements that name draw distances, those out of them from `eye` — the main view's, in
     *  the world's units — scaled by `scale` (`cutViewDistanceScale`) wearing no node from now on,
     *  those back in wearing it again: the centre of the root's bounds, as the cut tests it
     *  (`../shader/drawDistanceWgsl.ts`). `scale` undefined, the cull is off: every one is met.
     *  Nothing is judged where no buffer holds the instances yet, nor while the eye, the scale and the placements
     *  stand as they were when they were last judged; the instances that flipped are written in runs, one write a run
     *  of placements. How many changed. */
    distance(eye: ArrayLike<number>, scale: number | undefined) {
      if (!arena.buffer) return 0
      const kept = scale ?? NaN
      if (unchanged(judged, eye, kept)) return 0
      let changed = 0
      for (const w of named) {
        if (w >= slots) continue
        const out = outsideDistances(packed, centres, centred, w, eye, scale)
        if (out === held.culled.has(w)) continue
        if (out) held.culled.add(w)
        else held.culled.delete(w)
        const at = w * INSTANCE_WORDS
        held.words[at + INSTANCE.node] =
          out || packed.rootNodes[w] === NO_INDEX ? NO_INDEX : held.resolved[at + INSTANCE.node]
        flipped[changed++] = w
      }
      judged.x = eye[0]
      judged.y = eye[1]
      judged.z = eye[2]
      judged.scale = kept
      judged.at = judged.moved
      writeRuns(writeInstances, flipped.subarray(0, changed).sort())
      return changed
    },
  }
}
