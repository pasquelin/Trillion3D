import { clamp } from '../../../math/src/scalar/reals.ts'
import { length3, transformPointRow } from '../../../math/src/vector/vector.ts'
import { clipPixelX, clipPixelY } from '../../../math/src/projection/clip.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { expandInto, unionInto, type BoxSphere } from './boxSphere.ts'

/** The macro groups a view holds at most; the instances past them join the nearest. */
export const MAX_MACRO_GROUPS = 16
/** How much of the strands' length widens the bounds of an instance: half of it. */
const LENGTH_SHARE = 0.5
/** The distance in front of the camera a point nearer than the near plane is brought to, past it. */
const NEAR_MARGIN = 1e-8

/** What a macro group reads of an instance. */
export interface MacroMember {
  /** Its rank among the registered instances: the order the macro groups are made in. */
  readonly registeredIndex: number
  /** Its bounds in the world, the groom's. */
  readonly bounds: BoxSphere
  /** The longest of its strands. */
  readonly length: number
  /** Whether its strands are voxelized for the shadows. */
  readonly supportsVoxelization: boolean
}

/** A set of instances close enough to share their voxel volume and their screen allocation. A group's
 *  rank in the list `createMacroGroups` returns is its identifier. */
export interface MacroGroup<M extends MacroMember = MacroMember> {
  /** The bounds of its members, each widened by half the length of its strands. */
  readonly bounds: BoxSphere
  /** The instances the view sees: those the visibility draws. */
  readonly members: M[]
  /** The instances the view does not see and a light that casts reaches: they cast, they are not drawn. */
  readonly shadowMembers: M[]
  /** Whether at least one member, drawn or not, voxelizes. */
  supportsVoxelization: boolean
  /** The pixels its bounds cover, `[x0, y0, x1, y1]`, in the view. */
  readonly screenRect: [number, number, number, number]
}

/** The corners of the box being projected in the camera's space, and the least and greatest pixel of
 *  what is seen of it so far: refilled for each box, never kept. */
const eyeCorners = new Float64Array(24)
const extent = new Float64Array(4)

/** Adds to `extent` the pixel of the point (`x`, `y`, `z`) of the camera's space under `projection`,
 *  in an image of `width` by `height`; a point the projection puts behind the eye adds none. */
function extendRect(
  projection: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
) {
  const w = transformPointRow(projection, 3, x, y, z)
  if (!(w > 0)) return
  const px = clipPixelX(transformPointRow(projection, 0, x, y, z), w, width),
    py = clipPixelY(transformPointRow(projection, 1, x, y, z), w, height)
  extent[0] = Math.min(extent[0]!, px)
  extent[1] = Math.min(extent[1]!, py)
  extent[2] = Math.max(extent[2]!, px)
  extent[3] = Math.max(extent[3]!, py)
}

/** The corners of `box` in front of `plane`, projected into the extent; their eye-space places are kept in `eyeCorners`. Returns how many are in front. */
function extendCorners(
  projection: EngineCamera['projection'],
  view: EngineCamera['view'],
  box: ArrayLike<number>,
  width: number,
  height: number,
  plane: number,
) {
  let front = 0
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? box[3]! : box[0]!,
      y = corner & 2 ? box[4]! : box[1]!,
      z = corner & 4 ? box[5]! : box[2]!
    const at = corner * 3
    eyeCorners[at] = transformPointRow(view, 0, x, y, z)
    eyeCorners[at + 1] = transformPointRow(view, 1, x, y, z)
    eyeCorners[at + 2] = transformPointRow(view, 2, x, y, z)
    if (-eyeCorners[at + 2]! > plane) {
      front++
      extendRect(
        projection,
        width,
        height,
        eyeCorners[at]!,
        eyeCorners[at + 1]!,
        eyeCorners[at + 2]!,
      )
    }
  }
  return front
}

/** The points where the twelve edges of the box, in `eyeCorners`, cross `plane`, projected into the extent. */
function extendEdges(
  projection: EngineCamera['projection'],
  width: number,
  height: number,
  plane: number,
) {
  for (let corner = 0; corner < 8; corner++)
    for (let axis = 1; axis < 8; axis <<= 1) {
      if (corner & axis) continue
      const a = corner * 3,
        b = (corner | axis) * 3
      const da = -eyeCorners[a + 2]!,
        db = -eyeCorners[b + 2]!
      if (da > plane === db > plane) continue
      const t = (plane - da) / (db - da)
      extendRect(
        projection,
        width,
        height,
        eyeCorners[a]! + t * (eyeCorners[b]! - eyeCorners[a]!),
        eyeCorners[a + 1]! + t * (eyeCorners[b + 1]! - eyeCorners[a + 1]!),
        -plane,
      )
    }
}

/**
 * Writes into `out` the pixels the six bounds `box` cover in `camera`'s image of `width` by `height`:
 * what of the box lies in front of the near plane, projected — its corners in front, and where each of
 * its twelve edges crosses the plane (a corner behind it is not moved to it, which would leave out the
 * part of an edge between the plane and the corner's place) —, the least and greatest pixel rounded
 * outward and held to the image. A box with no point in front of the plane is held to it whole: its
 * corners at the plane's depth.
 */
function projectedScreenRect(
  out: [number, number, number, number],
  box: ArrayLike<number>,
  camera: Pick<EngineCamera, 'view' | 'projection' | 'near'>,
  width: number,
  height: number,
) {
  const { view, projection, near } = camera
  // The plane, just past the near one, so that every point added has a positive w.
  const plane = near + NEAR_MARGIN
  extent[0] = extent[1] = Infinity
  extent[2] = extent[3] = -Infinity
  const front = extendCorners(projection, view, box, width, height, plane)
  extendEdges(projection, width, height, plane)
  if (!front)
    for (let corner = 0; corner < 8; corner++)
      extendRect(
        projection,
        width,
        height,
        eyeCorners[corner * 3]!,
        eyeCorners[corner * 3 + 1]!,
        -plane,
      )
  out[0] = clamp(Math.floor(extent[0]!), 0, width)
  out[1] = clamp(Math.floor(extent[1]!), 0, height)
  out[2] = clamp(Math.ceil(extent[2]!), 0, width)
  out[3] = clamp(Math.ceil(extent[3]!), 0, height)
}

/** The widened bounds of the member being placed: refilled for each, never kept. */
const widened: BoxSphere = { box: new Float64Array(6), sphere: new Float64Array(4) }

/** The macro groups of the image, and the records they are made in: kept from one image to the next and
 *  refilled in place, so that an image allocates none. A result is valid until the next call. */
const scratch: MacroGroup[] = []
const pool: MacroGroup[] = []

/** The macro groups the last call of `createMacroGroups` made: what the debug views read of the image (valid until the next call). */
export const lastMacroGroups = (): readonly MacroGroup[] => scratch

/** The order the macro groups are made in. */
const byRegisteredIndex = (a: MacroMember, b: MacroMember) => a.registeredIndex - b.registeredIndex

/** `members` by their registered index: themselves when they already go so, else a sorted copy. */
function inRegisteredOrder<M extends MacroMember>(members: readonly M[]) {
  for (let k = 1; k < members.length; k++)
    if (members[k - 1]!.registeredIndex > members[k]!.registeredIndex)
      return [...members].sort(byRegisteredIndex)
  return members
}

/** Puts `member` in the first of `groups` whose sphere meets its widened bounds' (the group's bounds then
 *  join them), else in a group of its own, or, when `MAX_MACRO_GROUPS` exist, in the nearest; among the
 *  members the view draws where `drawn`, among those that only cast else. */
function place<M extends MacroMember>(groups: MacroGroup<M>[], member: M, drawn: boolean) {
  expandInto(widened, member.bounds, member.length * LENGTH_SHARE)
  let hit = -1,
    nearest = -1,
    gap = Infinity
  for (let k = 0; k < groups.length; k++) {
    const sphere = groups[k]!.bounds.sphere
    const apart = length3(
      sphere[0]! - widened.sphere[0]!,
      sphere[1]! - widened.sphere[1]!,
      sphere[2]! - widened.sphere[2]!,
    )
    const reach = Math.max(0, sphere[3]! + widened.sphere[3]!)
    if (apart <= reach) {
      hit = k
      break
    }
    if (apart - reach < gap) {
      gap = apart - reach
      nearest = k
    }
  }
  const joined = hit >= 0 ? hit : groups.length === MAX_MACRO_GROUPS ? nearest : -1
  if (joined < 0) {
    const group = (pool[groups.length] ??= {
      bounds: { box: new Float64Array(6), sphere: new Float64Array(4) },
      members: [],
      shadowMembers: [],
      supportsVoxelization: false,
      screenRect: [0, 0, 0, 0],
    }) as MacroGroup<M>
    group.bounds.box.set(widened.box)
    group.bounds.sphere.set(widened.sphere)
    group.members.length = group.shadowMembers.length = 0
    ;(drawn ? group.members : group.shadowMembers).push(member)
    group.supportsVoxelization = member.supportsVoxelization
    groups.push(group)
    return
  }
  const group = groups[joined]!
  unionInto(group.bounds, group.bounds, widened)
  ;(drawn ? group.members : group.shadowMembers).push(member)
  group.supportsVoxelization ||= member.supportsVoxelization
}

/**
 * The macro groups of the instances of a view: those it sees (`visible`) in the order of their
 * registered index, so the groups are the same from one image to the next, then those it does not see
 * and a light that casts reaches (`shadowOnly`), in theirs. Each instance is taken by the first group
 * whose sphere meets that of its bounds widened by half its strands' length (the group's bounds then
 * join them); one met by none starts a group, or, when `MAX_MACRO_GROUPS` exist, joins the group whose
 * sphere is nearest. A group's screen rectangle is that of its box. The array returned, and the groups
 * in it, are refilled by the next call.
 */
export function createMacroGroups<M extends MacroMember>(
  visible: readonly M[],
  shadowOnly: readonly M[],
  camera: Pick<EngineCamera, 'view' | 'projection' | 'near'>,
  width: number,
  height: number,
): MacroGroup<M>[] {
  const groups = scratch as MacroGroup<M>[]
  groups.length = 0
  for (const member of inRegisteredOrder(visible)) place(groups, member, true)
  for (const member of inRegisteredOrder(shadowOnly)) place(groups, member, false)
  for (const group of groups)
    projectedScreenRect(group.screenRect, group.bounds.box, camera, width, height)
  return groups
}
