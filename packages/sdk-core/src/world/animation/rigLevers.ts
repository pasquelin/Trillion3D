// How far a change of one animated value carries the points of a rig: the lever that turns a
// track's move (`trackMotion.ts`) into a distance in the scene (`poseHold.ts`). Every bound is
// an upper one, read from the clips' keys and the meshes' vertices, never from a sampled pose.
import type { Object3D } from '../object/object3d.ts'
import type { Mesh } from '../object/mesh.ts'
import { pointAt } from '../geometry/bounds.ts'
import { skinStreams } from '../geometry/skin.ts'
import { trackWidth, type Clip, type Track } from './clip.ts'
import { length3, transformAffinePoint } from '../../../../math/src/vector/vector.ts'

/**
 * What the clips playing on a root move, in the frame of the root's parent: per track name, the
 * most a unit of the track's error moves any point of the rig (`Infinity` for a property that is
 * not a node's position, rotation or scale); and the radius about the root's origin of a ball
 * that holds every point of the rig, whatever the clips' pose; and per track name, the node it
 * writes, whose points and those of its subtree are the ones its lever moves.
 */
export type RigReach = {
  levers: Map<string, number>
  radius: number
  owners: Map<string, Object3D>
}

/** One node's bounds over every pose of the clips: the largest magnitude of each component of
 *  its position and scale, and how far its own drawn points reach from its origin, in its frame. */
type Extent = { move: Float64Array; grow: Float64Array; reach: number }

/**
 * The levers of `clips` on `root`. A point of node `n`'s subtree lies, in `n`'s frame before its
 * scale, within `X(n) = max(reach(n), max over children c of |t_c| + s_c · X(c))` of its origin,
 * `|t_c|` and `s_c` the child's largest position and scale. With `S` the product of the largest
 * scales of `n`'s ancestors under the root's parent:
 * - a position error `e` moves each point by at most `S · e`;
 * - a rotation error of angle `α` (a quaternion's, an Euler angle's) by at most `α · S · s_n · X(n)`;
 * - a scale error `e` by at most `S · X(n) · e`.
 * A skinned vertex rides its joints (`Skeleton.palette`): a joint reaches each vertex it weighs,
 * `boneInverse · v` in its frame. A rigid mesh reaches the corners of its geometry's box.
 */
export function rigReach(root: Object3D, clips: readonly Clip[]): RigReach {
  const extents = new Map<Object3D, Extent>()
  root.traverse((node) => extents.set(node, restOf(node)))
  root.traverse((node) => reachSkin(node, extents))
  const targets: { tr: Track; node: Object3D; field: string }[] = []
  for (const clip of clips)
    for (const tr of clip.tracks) {
      const [name, ...fields] = tr.name.split('.')
      const node = name ? root.getObjectByName(name) : root
      if (!node || !extents.has(node)) continue
      targets.push({ tr, node, field: fields.join('.') })
      widen(extents.get(node)!, fields, tr)
    }
  const spans = new Map<Object3D, number>()
  const spanOf = (node: Object3D): number => {
    const own = extents.get(node)!
    let most = own.reach
    for (const child of node.children) {
      const e = extents.get(child)!
      most = Math.max(
        most,
        length3(e.move[0], e.move[1], e.move[2]) + Math.max(...e.grow) * spanOf(child),
      )
    }
    spans.set(node, most)
    return most
  }
  const radius = Math.max(...extents.get(root)!.grow) * spanOf(root)
  const levers = new Map<string, number>(),
    owners = new Map<string, Object3D>()
  for (const { tr, node, field } of targets) {
    owners.set(tr.name, node)
    let above = 1
    for (let up = node.parent; up && up !== root.parent; up = up.parent)
      above *= Math.max(...extents.get(up)!.grow)
    const span = spans.get(node)!,
      kind = field.split('.')[0]
    const lever =
      kind === 'position'
        ? above
        : kind === 'quaternion' || kind === 'rotation'
          ? above * Math.max(...extents.get(node)!.grow) * span
          : kind === 'scale'
            ? above * span
            : Infinity
    levers.set(tr.name, Math.max(levers.get(tr.name) ?? 0, lever))
  }
  return { levers, radius, owners }
}

/** A node's rest extent: its own position and scale, and its rigid geometry's farthest corner. */
function restOf(node: Object3D): Extent {
  const { position: p, scale: s } = node
  let reach = 0
  const mesh = node as Mesh
  if (mesh.isMesh && !mesh.skeleton) {
    const box = node.localBounds()
    if (box && box.min.x <= box.max.x)
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) reach = Math.max(reach, length3(x, y, z))
  }
  return {
    move: Float64Array.of(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)),
    grow: Float64Array.of(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)),
    reach,
  }
}

const vertex = [0, 0, 0],
  carried = new Float64Array(3)
/** Each joint of a skinned `node` under the root reaches the vertices it weighs. */
function reachSkin(node: Object3D, extents: Map<Object3D, Extent>) {
  const mesh = node as Mesh,
    skeleton = mesh.skeleton,
    position = mesh.isMesh ? mesh.geometry.attributes.position : undefined
  if (!skeleton || !position) return
  const streams = skinStreams(mesh.geometry),
    inverses = skeleton.inverses
  for (let v = 0; v < position.count; v++) {
    pointAt(position, v, vertex)
    for (let k = 0; k < streams.width; k++) {
      if (!(streams.read(v, k, true) > 0)) continue
      const j = streams.read(v, k, false),
        joint = extents.get(skeleton.bones[j])
      if (!joint) continue
      transformAffinePoint(carried, inverses[j], vertex[0], vertex[1], vertex[2])
      joint.reach = Math.max(joint.reach, length3(carried[0], carried[1], carried[2]))
    }
  }
}

/** Widens `extent` by every value `tr` gives its position or scale: a key, or for a cubic spline
 *  the Bézier points `p ± span · m / 3` whose hull holds the curve. */
function widen(extent: Extent, fields: string[], tr: Track) {
  const into = fields[0] === 'position' ? extent.move : fields[0] === 'scale' ? extent.grow : null
  if (!into || (fields.length > 1 && !'xyz'.includes(fields[1]))) return
  const first = fields.length > 1 ? 'xyz'.indexOf(fields[1]) : 0,
    { times, values } = tr,
    cubic = tr.interpolation === 'cubic',
    width = trackWidth(tr)
  for (let i = 0; i < times.length; i++)
    for (let c = 0; c < width && first + c < 3; c++) {
      const at = cubic ? i * width * 3 + width + c : i * width + c,
        before = cubic && i > 0 ? (times[i] - times[i - 1]) / 3 : 0,
        after = cubic && i + 1 < times.length ? (times[i + 1] - times[i]) / 3 : 0
      const most = Math.max(
        Math.abs(values[at]),
        Math.abs(values[at] - before * (cubic ? values[at - width] : 0)),
        Math.abs(values[at] + after * (cubic ? values[at + width] : 0)),
      )
      into[first + c] = Math.max(into[first + c], most)
    }
}
