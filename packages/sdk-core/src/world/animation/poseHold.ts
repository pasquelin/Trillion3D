// How far a rig's true pose drifts from the pose last written while its clips play on: what lets
// a far rig keep that pose, untouched, while no point of it would move half a pixel
// (`mixerHold.ts`). The bound is read once from the clips' keys (`trackMotion.ts`: each
// segment's top speed, the times a value leaps) and the rig (`rigLevers.ts`), as a table of each
// clip's time; a frame reads it twice.
import type { Object3D } from '../object/object3d.ts'
import type { Clip, Track } from './clip.ts'
import type { RigReach } from './rigLevers.ts'
import { clipKeys, clipMotion, type TrackMotion } from './trackMotion.ts'
import { lastTrue } from '../../../../math/src/scalar/search.ts'
import { SQRT3 } from '../../../../math/src/constants.ts'

/** A clip playing into the pose, at its weight; `additive` adds it to the others. */
export type HoldPlaying = {
  readonly clip: Clip
  readonly weight: number
  readonly additive: boolean
}

/** The most `x = Σ wₐ θₐ / |s|` a blended rotation's bound takes (`holdTables`): below it,
 *  `2 asin x ≤ 2 x · BLEND_SLOPE`. */
export const BLEND_SIN = 0.5
const BLEND_SLOPE = Math.asin(BLEND_SIN) / BLEND_SIN

/**
 * One action's drift over its clip's times `times` (0, every key, the end, in order): from clip
 * time 0 to `times[i]`, `moved[i]` is the most a point of the rig moves, in the frame of the
 * root's parent, `turned[i]` the most a blended rotation's `x` grows (`BLEND_SIN`), `leaps[i]`
 * how many times a value leaps; `rate[i]` and `turn[i]` their slopes up to `times[i + 1]`.
 */
export type HoldTable = {
  readonly times: Float64Array
  readonly moved: Float64Array
  readonly rate: Float64Array
  readonly turned: Float64Array
  readonly turn: Float64Array
  readonly leaps: Float64Array
}

/**
 * Each playing clip's drift table (`HoldTable`) on `root`; `null` when one is additive.
 *
 * Held from clip time `a` to `b`, a track's value moves by at most `∫ₐᵇ |c'|`, below each
 * segment's top speed (`TrackMotion.speeds`) — a rotation's unit quaternion along its arc in ℝ⁴,
 * its sign kept continuous —, unless the value leaps between them. A property is the weighted sum
 * `s = Σ wₐ cₐ / max(1, W)` of its tracks' samples (`Blend.write`, the rest value topping up a sum
 * under 1): a vector moves by at most `Σ wₐ δₐ / max(1, W)` (an Euler triple's angles each turn
 * by its component, `√3` its length at most). A rotation alone at weight 1 turns by twice its arc;
 * blended, `s` moves by `Σ wₐ θₐ` while `|s| ≥ √(Σ wₐ² + rest²)` (each term is added in the
 * hemisphere of the sum before it), so it turns by `2 asin x`, `x` that ratio, at most
 * `2 · BLEND_SLOPE · x` while `x ≤ BLEND_SIN`. Each property's move carries its node's subtree
 * by its lever (`rigReach`); a point moves by the sum along its chain of nodes from the root, and
 * the table's rate is the largest chain's.
 */
export function holdTables(root: Object3D, reach: RigReach, playing: readonly HoldPlaying[]) {
  if (playing.some((p) => p.additive)) return null
  const rig = rigOf(root, reach, playing)
  return playing.map(({ clip, weight }) => tableOf(clip, Math.max(0, weight), rig))
}

/** Per property, its clips' weights summed, their squares summed, and how many clips write it. */
type Blend = { sum: number; squares: number; count: number }
/** What a rig's tables share whatever the weights, read once for a reach (`shapeOf`): the nodes in
 *  order (a parent before its children), each node's parent's rank, and room for each node's own
 *  rate and its chain's. */
type Shape = {
  nodes: Map<Object3D, number>
  parents: number[]
  own: Float64Array
  chain: Float64Array
}
/** What a table is built from: the rig's shape, the levers, and the blends. */
type RigTerms = Shape & { reach: RigReach; blends: Map<string, Blend> }

/** A clip's tracks on a rig, whatever the weights: the rank of the node each writes (`-1` for a
 *  property with no lever), its lever, and the top speed of each track on each interval of the
 *  clip's times — `speeds[i * tracks + k]` — read once. */
type ClipTerms = { node: Int32Array; lever: Float64Array; speeds: Float64Array }

const shapes = new WeakMap<RigReach, Shape>()
const clipTerms = new WeakMap<RigReach, WeakMap<Clip, ClipTerms>>()

/** The shape of the rig `reach` was read from: a reach is read again when its rig changes
 *  (`mixerHold.ts`), so what hangs on it stands as long as it does. */
function shapeOf(root: Object3D, reach: RigReach) {
  let shape = shapes.get(reach)
  if (!shape) {
    const nodes = new Map<Object3D, number>(),
      parents: number[] = []
    root.traverse((node) => {
      parents.push(node === root ? -1 : (nodes.get(node.parent!) ?? -1))
      nodes.set(node, nodes.size)
    })
    shapes.set(
      reach,
      (shape = {
        nodes,
        parents,
        own: new Float64Array(parents.length),
        chain: new Float64Array(parents.length),
      }),
    )
  }
  return shape
}

function rigOf(root: Object3D, reach: RigReach, playing: readonly HoldPlaying[]): RigTerms {
  const blends = new Map<string, Blend>()
  for (const { clip, weight } of playing)
    for (const tr of clip.tracks) {
      const w = Math.max(0, weight),
        blend = blends.get(tr.name) ?? { sum: 0, squares: 0, count: 0 }
      blend.sum += w
      blend.squares += w * w
      blend.count++
      blends.set(tr.name, blend)
    }
  return { ...shapeOf(root, reach), reach, blends }
}

/** `clip`'s tracks on `rig`, read once for its reach. */
function termsOf(clip: Clip, rig: RigTerms) {
  let known = clipTerms.get(rig.reach)
  if (!known) clipTerms.set(rig.reach, (known = new WeakMap()))
  let terms = known.get(clip)
  if (!terms) {
    const times = timesOf(clip),
      motions = clipMotion(clip),
      n = clip.tracks.length
    terms = {
      node: new Int32Array(n),
      lever: new Float64Array(n),
      speeds: new Float64Array(Math.max(0, times.length - 1) * n),
    }
    clip.tracks.forEach((tr, k) => {
      const node = rig.reach.owners.get(tr.name),
        lever = rig.reach.levers.get(tr.name) ?? 0
      terms!.node[k] = node && lever > 0 ? rig.nodes.get(node)! : -1
      terms!.lever[k] = lever
    })
    for (let i = 0; i + 1 < times.length; i++)
      for (let k = 0; k < n; k++)
        terms.speeds[i * n + k] = speedAt(clip.tracks[k], motions[k], (times[i] + times[i + 1]) / 2)
    known.set(clip, terms)
  }
  return terms
}

/** `clip`'s table at weight `w`: each interval's rates (`rateOf`), integrated, and its leaps
 *  counted. */
function tableOf(clip: Clip, w: number, rig: RigTerms): HoldTable {
  const times = timesOf(clip),
    n = times.length,
    motions = clipMotion(clip),
    terms = termsOf(clip, rig),
    blends = clip.tracks.map((tr) => rig.blends.get(tr.name)!)
  const table: HoldTable = {
    times,
    moved: new Float64Array(n),
    rate: new Float64Array(n),
    turned: new Float64Array(n),
    turn: new Float64Array(n),
    leaps: new Float64Array(n),
  }
  for (let i = 0; i + 1 < n; i++) {
    const turn = rateOf(clip, terms, i, blends, w, rig),
      span = times[i + 1] - times[i]
    let most = 0
    for (let k = 0; k < rig.parents.length; k++) {
      rig.chain[k] = (rig.parents[k] < 0 ? 0 : rig.chain[rig.parents[k]]) + rig.own[k]
      most = Math.max(most, rig.chain[k])
    }
    table.rate[i] = most
    table.turn[i] = turn
    table.moved[i + 1] = table.moved[i] + (most > 0 ? most * span : 0)
    table.turned[i + 1] = table.turned[i] + (turn > 0 ? turn * span : 0)
  }
  for (const motion of motions)
    for (const at of motion.leapsAt) table.leaps[intervalOf(times, at)]++
  for (let i = 1; i < n; i++) table.leaps[i] += table.leaps[i - 1]
  return table
}

/** On interval `i` of `clip`, weighed `w`: each node's own rate into `rig.own` (`holdTables`);
 *  returns the most a blended rotation's `x` grows. */
function rateOf(
  clip: Clip,
  terms: ClipTerms,
  i: number,
  blends: Blend[],
  w: number,
  rig: RigTerms,
) {
  rig.own.fill(0)
  let turn = 0
  const width = clip.tracks.length
  for (let k = 0; k < width; k++) {
    const speed = terms.speeds[i * width + k],
      node = terms.node[k]
    if (!(speed > 0) || node < 0 || !(w > 0)) continue
    const tr = clip.tracks[k],
      lever = terms.lever[k],
      { sum, squares, count } = blends[k]
    let factor: number
    if (tr.kind !== 'quaternion') factor = (w / Math.max(1, sum)) * (isEulerTriple(tr) ? SQRT3 : 1)
    else if (count === 1 && sum === 1) factor = 2
    else {
      const least = Math.sqrt(squares + Math.max(0, 1 - sum) ** 2)
      turn = Math.max(turn, (w * speed) / least)
      factor = (2 * BLEND_SLOPE * w) / least
    }
    rig.own[node] += lever * factor * speed
  }
  return turn
}

/** Clip time 0, every key of `clip` and its end, in order. */
function timesOf(clip: Clip) {
  const keys = clipKeys(clip)
  return keys[0] > 0 ? Float64Array.of(0, ...keys) : keys
}

/** An Euler triple of angles (`node.rotation`), whose three turns add up. */
function isEulerTriple(tr: Track) {
  return tr.kind === 'vector' && tr.name.split('.')[1] === 'rotation'
}

/** The top speed of `tr`'s segment at clip time `t`; still before its first key and after its
 *  last. */
function speedAt(tr: Track, motion: TrackMotion, t: number) {
  const { times } = tr
  if (!(t >= times[0]) || !(t < times[times.length - 1])) return 0
  return motion.speeds[intervalOf(times, t)] ?? 0
}

/** The last index of `times` (in order) at or before `t`; 0 before the first. */
export function intervalOf(times: ArrayLike<number>, t: number) {
  return lastTrue(0, times.length - 1, (mid) => times[mid] <= t)
}
