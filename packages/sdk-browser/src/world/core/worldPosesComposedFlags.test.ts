// A child composed on the GPU under its parent is shown, hidden, made to cast or not, removed and
// added as a child whose row the CPU writes: its flags go through the one row write, the session
// parks or takes it from that write, and the GPU composes only roots linked to a parent it holds
// (modelled here by the product the pass computes: its parent's world times its local).
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createPlacementRows, placementWorld } from '../../placement/rows.ts'
import { followPlacementRows } from '../../placement/update.ts'
import { composeWebgpuPlacements, type ComposeState } from '../../placement/gpuCompose.ts'
import { composeRuntime } from '../../placement/composeRuntime.fixture.ts'
import { MATRIX_DOUBLES, NONE } from '../../placement/gpuComposeWgsl.ts'
import { createWorldPoses, type PoseComposer } from './worldPoses.ts'
import type { Seat } from './worldBatches.ts'

const N = 12000,
  SHOWN = 500
/** A parent of `N` seated children, one spare row, a session that composes them. */
function galaxy(under?: Object3D) {
  const scene = object.group(),
    parent = object.group(),
    shape = geometry.box(1, 1, 1),
    rows = createPlacementRows(N + 1),
    batch = { rows },
    seats = new Map<Mesh, Seat>()
  ;(under ?? scene).add(parent)
  if (under) scene.add(under)
  const children: Mesh[] = []
  for (let i = 0; i < N; i++) {
    const mesh = object.mesh(shape)
    mesh.position.set(i % 100, 0, Math.floor(i / 100))
    mesh.rotation.set(i * 0.01, 0, 0)
    parent.add(mesh)
    children.push(mesh)
    seats.set(mesh, { batch, row: i } as unknown as Seat)
  }
  const roots = Array.from({ length: N + 1 }, (_, index) => ({
    placement: { rows, index },
    world: placementWorld(rows, index),
    pages: [],
  })) as { world: { elements: ArrayLike<number> }; parked?: boolean; mark?: number }[]
  const rt = composeRuntime(roots)
  const poses = createWorldPoses()
  const composer: PoseComposer = {
    key: rt,
    epoch: 0,
    link: (node, world, links, whole) => composeWebgpuPlacements(rt, node, world, links, whole),
  }
  // The session's follow of written rows: parks, takes, marks.
  const send = (written: typeof rows, from: number, to: number) =>
    void followPlacementRows(roots as never, written, from, to)
  const frame = () => poses.apply(scene, seats, new Map(), send, composer)
  return { scene, parent, rows, batch, seats, children, roots, rt, poses, composer, frame }
}

const local = new Float64Array(16),
  composedWorld = new Float64Array(16),
  cell = new Float64Array(1),
  words = new Uint32Array(cell.buffer)
type Galaxy = ReturnType<typeof galaxy>

/** The world the frame draws root `rank` at: composed when linked, its row otherwise. */
function drawnWorld(state: ComposeState | undefined, roots: Galaxy['roots'], rank: number) {
  const slot = state?.parentOf[rank] ?? NONE
  if (slot === NONE) return roots[rank].world.elements
  for (let k = 0; k < 16; k++) {
    const at = (rank * MATRIX_DOUBLES + k) * 2
    words[1] = state!.locals[at]
    words[0] = state!.locals[at + 1]
    local[k] = cell[0]
  }
  return multiplyMatrix4(composedWorld, state!.worlds.subarray(slot * 16, slot * 16 + 16), local)
}

/** The drawable roots — neither parked nor hidden — each at its mesh's world, to the bit. */
function drawable(g: Galaxy) {
  const state = g.rt.compose
  let count = 0
  g.children.forEach((mesh, rank) => {
    if (!g.seats.has(mesh) || g.roots[rank].parked) return
    count++
    const world = drawnWorld(state, g.roots, rank)
    assert.deepEqual(Array.from(world), [...mesh.matrixWorld.elements], `root ${rank} at its pose`)
  })
  return count
}

const turn = (g: Galaxy, angle: number) => {
  g.parent.rotation.y = angle
  g.poses.moved(g.parent)
}
const sum = (flags: Uint8Array) => flags.reduce((a, b) => a + b, 0)
/** A galaxy whose first frame wrote every row whole and linked them. */
function linked(under?: Object3D) {
  const g = galaxy(under)
  turn(g, 0)
  g.frame()
  return g
}

/** The resolution seating `mesh` on `row`: its row written, the seats moved on. */
function seatNew(g: Galaxy, mesh: Mesh, row: number) {
  g.children[row] = mesh
  g.seats.set(mesh, { batch: g.batch, row } as unknown as Seat)
  mesh.updateWorldMatrix(true, false)
  g.poses.writeSeat(mesh, g.seats.get(mesh)!, true)
  g.composer.epoch++
}

test('hiding 11 500 linked children while the parent turns parks them; shown again, they draw composed', () => {
  const g = linked()
  assert.equal(drawable(g), N)
  turn(g, 0.7)
  g.frame()
  assert.equal(drawable(g), N, 'the turn composes every child')
  turn(g, 1.1)
  g.children.forEach((mesh, i) => {
    mesh.visible = i < SHOWN
    if (i >= SHOWN) g.poses.moved(mesh)
  })
  g.frame()
  assert.equal(drawable(g), SHOWN, 'hidden in the frame the parent turns: parked')
  assert.equal(sum(g.rows.live), SHOWN)
  turn(g, 1.5)
  g.frame()
  assert.equal(drawable(g), SHOWN, 'turned again: still parked, the shown ones composed')
  g.children.forEach((mesh) => ((mesh.visible = true), g.poses.moved(mesh)))
  turn(g, 1.9)
  g.frame()
  assert.equal(drawable(g), N, 'shown back: every child drawn at its composed pose')
})

test('castShadow flipped on linked children while the parent turns reaches their rows and roots', () => {
  const g = linked()
  turn(g, 0.4)
  g.children.forEach((mesh, i) => i >= SHOWN && ((mesh.castShadow = false), g.poses.moved(mesh)))
  g.frame()
  const shadowless = () => g.roots.filter((root) => root.mark).length
  assert.equal(sum(g.rows.shadowless), N - SHOWN)
  assert.equal(shadowless(), N - SHOWN, 'each root casts as its mesh says')
  g.children.forEach((mesh) => ((mesh.castShadow = true), g.poses.moved(mesh)))
  turn(g, 0.8)
  g.frame()
  assert.equal(shadowless(), 0)
  assert.equal(drawable(g), N)
})

test('a child removed from a linked parent is unlinked, its row taken by another mesh; a child added is linked', () => {
  const g = linked()
  // The resolution of the removal: the mesh leaves its seat, its row is parked, the seats move on.
  const gone = g.children[7]
  g.parent.remove(gone)
  g.seats.delete(gone)
  g.rows.live[7] = 0
  g.poses.touch(g.batch as never, 7)
  g.composer.epoch++
  turn(g, 0.6)
  g.frame()
  assert.equal(g.roots[7].parked, true)
  assert.equal(g.rt.compose!.parentOf[7], NONE, 'the removed child follows no parent')
  assert.equal(drawable(g), N - 1)
  // Another mesh, under the scene, takes the freed row: it draws at its own world.
  const other = object.mesh(geometry.box(1, 1, 1))
  other.position.set(-40, 3, 9)
  g.scene.add(other)
  seatNew(g, other, 7)
  turn(g, 0.9)
  g.frame()
  assert.equal(drawable(g), N, 'the new mesh at its own world, the others composed')
  assert.equal(g.rt.compose!.parentOf[7], NONE)
  const added = object.mesh(geometry.box(1, 1, 1))
  added.position.set(5, 6, 7)
  g.parent.add(added)
  seatNew(g, added, N)
  turn(g, 1.2)
  g.frame()
  assert.notEqual(g.rt.compose!.parentOf[N], NONE, 'linked')
  turn(g, 1.6)
  g.frame()
  assert.equal(drawable(g), N + 1)
})

test("a grandparent's turn sends the linked parent's new world", () => {
  const grand = object.group()
  const g = linked(grand)
  grand.rotation.z = 0.8
  grand.position.x = 4
  g.poses.moved(grand)
  g.frame()
  assert.equal(drawable(g), N, 'every child composed under the moved parent')
})
