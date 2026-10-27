// The macro groups of a view: instances gathered by their spheres in the order they are registered,
// and the pixels a group's box covers.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxSphereOf } from './boxSphere.ts'
import { createMacroGroups, MAX_MACRO_GROUPS, type MacroMember } from './macroGroups.ts'

/** A camera at the origin looking down −z with a field of 90 degrees, for an image of 64 by 64. */
const CAMERA: Parameters<typeof createMacroGroups>[2] = {
  view: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  projection: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0]),
  near: 0.1,
}

/** An instance whose box is the unit cube about `x`, its strands `length` long. */
const member = (registeredIndex: number, x: number, length = 0, voxelizes = true): MacroMember => ({
  registeredIndex,
  bounds: boxSphereOf([x - 0.5, -0.5, -0.5, x + 0.5, 0.5, 0.5]),
  length,
  supportsVoxelization: voxelizes,
})

const groupsOf = (visible: MacroMember[], shadowOnly: MacroMember[] = []) =>
  createMacroGroups(visible, shadowOnly, CAMERA, 64, 64)
const ranks = (groups: ReturnType<typeof groupsOf>) =>
  groups.map((group) => group.members.map((one) => one.registeredIndex))

test('instances whose spheres meet share a group, the others start their own', () => {
  const groups = groupsOf([member(0, 0), member(1, 0.5), member(2, 100)])
  assert.deepEqual(ranks(groups), [[0, 1], [2]])
  // The first group's box holds both members.
  assert.deepEqual(Array.from(groups[0]!.bounds.box), [-0.5, -0.5, -0.5, 1, 0.5, 0.5])
})

test('the instances are taken in the order of their registered index, whatever the order given', () => {
  const groups = groupsOf([member(2, 100), member(1, 0.5), member(0, 0)])
  assert.deepEqual(ranks(groups), [[0, 1], [2]])
})

test('half the strands length widens an instance, so two that are apart by less meet', () => {
  const apart = [member(0, 0), member(1, 4)]
  assert.equal(groupsOf(apart).length, 2)
  // Each sphere, √0.75 wide, widened by 1.5, reaches 2.37 from its centre: centres 4 apart meet.
  const long = [member(0, 0, 3), member(1, 4, 3)]
  assert.equal(groupsOf(long).length, 1)
})

test('past the most groups, an instance joins the group whose sphere is nearest', () => {
  const far = Array.from({ length: MAX_MACRO_GROUPS }, (_, k) => member(k, k * 100))
  // At x = 1030, 30 from the group at 1000 and 70 from the one at 1100, meeting neither.
  const groups = groupsOf([...far, member(MAX_MACRO_GROUPS, 1030)])
  assert.equal(groups.length, MAX_MACRO_GROUPS)
  assert.deepEqual(
    groups[10]!.members.map((one) => one.registeredIndex),
    [10, MAX_MACRO_GROUPS],
  )
})

test('a group voxelizes when any of its members does', () => {
  assert.equal(
    groupsOf([member(0, 0, 0, false), member(1, 0.5, 0, true)])[0]!.supportsVoxelization,
    true,
  )
  assert.equal(groupsOf([member(0, 0, 0, false)])[0]!.supportsVoxelization, false)
})

test('a groom the view does not see joins the groups after those it sees, and is not drawn', () => {
  const groups = groupsOf([member(1, 0)], [member(0, 0.5), member(2, 100)])
  assert.deepEqual(ranks(groups), [[1], []])
  assert.deepEqual(
    groups.map((group) => group.shadowMembers.map((one) => one.registeredIndex)),
    [[0], [2]],
  )
  assert.equal(groups[1]!.members.length, 0, 'a group of shadow casters draws nothing')
})

/** The pixels the box of a lone instance covers, as its macro group says. */
const screenRectOf = (box: number[]) => {
  const bounds = boxSphereOf(box)
  const [group] = groupsOf([{ registeredIndex: 0, bounds, length: 0, supportsVoxelization: true }])
  return group!.screenRect
}

test('the screen rectangle of a box in front of the camera is the pixels its corners cover', () => {
  // x and y from −1 to 1, z from −16 to −8: 1/8 of the depth at the nearest, 1/16 at the farthest.
  assert.deepEqual(screenRectOf([-1, -1, -16, 1, 1, -8]), [28, 28, 36, 36])
})

test('a box behind the camera is brought to the near plane and held to the image', () => {
  assert.deepEqual(screenRectOf([-1, -1, 5, 1, 1, 10]), [0, 0, 64, 64])
})

test('a box across the near plane covers where its edges cross it, not where its corners behind are put', () => {
  // A camera at the origin, near plane at 1, turned about y so that a box's edge along z runs in its
  // space from (1, 0, −2), in front, to (0.9, 0, 100), behind it: the edge crosses the plane at x = 0.999.
  const [dx, dz] = [-0.1, 102]
  const length = Math.hypot(dx, dz)
  const sin = dx / length,
    cos = dz / length
  // The camera's space from the world's: a turn about y taking the world's z to the edge's direction.
  const view = Float64Array.from([cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, 0, 0, 0, 1])
  // The edge's front end in the world: the turn undone.
  const front = [cos * 1 - sin * -2, 0, sin * 1 + cos * -2]
  const box = [front[0]!, -0.01, front[2]!, front[0]! + 1e-9, 0.01, front[2]! + length]
  const bounds = boxSphereOf(box)
  const camera = { view, projection: CAMERA.projection, near: 1 }
  const [group] = createMacroGroups(
    [{ registeredIndex: 0, bounds, length: 0, supportsVoxelization: true }],
    [],
    camera,
    64,
    64,
  )
  // The crossing, at x = 1 + (1 − 2)/(−100 − 2) · (0.9 − 1) at a distance of 1: pixel (0.999 + 1) · 32.
  const crossing = (1 + (-1 / -102) * -0.1 + 1) * 32
  assert.ok(crossing > 63.9, `${crossing}`)
  assert.equal(group!.screenRect[2], Math.ceil(crossing), 'the right side holds the crossing')
  // The corner behind, put at the plane where it is, would have ended the rectangle at (0.9 + 1) · 32.
  assert.ok(group!.screenRect[2] > Math.ceil(1.9 * 32))
})
