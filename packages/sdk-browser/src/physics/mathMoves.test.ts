// The physics page's formulas in their packages/math homes, each against the expression it
// replaced (`hypot3`/`hypot2`, `Math.hypot` to the bit, is the old length in every oracle).
//
// The view's facing leaves `−w / hypot3(w)` for `normalizeVector3`'s `−w · (1 / length3(w))`, its
// half cone `(fov · π) / 360` and `hypot2(1, aspect)` for `perspectiveDiagonalSlope`'s
// `fov · (π / 360)` and `length2`: last bits can move, and both reach the VIEW command's float32
// words, which the sweep holds the same. A tile's mover reach leaves `hypot3` for `length3`: it
// is a float64 streaming margin, and the sweep holds every `nearness` it decides the same. A
// joint's length leaves `hypot3` for `distanceVector3`: it reaches the JOINT command's float32
// limits, held the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'
import { hypot2, hypot3 } from '../../../math/src/float/hypot.ts'
import type { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import { Joint } from '../../../sdk-core/src/physics/joint.ts'
import type { Camera } from '../../../sdk-core/src/world/camera/camera.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { Bodied } from './bodies.ts'
import { framesOf } from './jointFrames.ts'
import { moversOf, nearness, type Placed } from './tilePlace.ts'
import { createPhysicsView } from './view.ts'

/** What the last VIEW command carried. */
const sent = { facing: [0, 0, 0], halfCone: 0 }
const writer = {
  view(_eye: ArrayLike<number>, facing: ArrayLike<number>, halfCone: number) {
    sent.facing = Array.from(facing)
    sent.halfCone = halfCone
  },
} as unknown as CommandWriter

/** A camera of world matrix `elements` and the given optics, its world already resolved. */
const cameraOf = (elements: Float64Array, fov: number, aspect: number) =>
  ({
    updateWorldMatrix() {},
    matrixWorld: { elements },
    projection: 'perspective',
    fov,
    aspect,
    far: 100,
  }) as unknown as Camera

test('the view command carries the old facing and half cone in float32', () => {
  const columns = edgeValues(-1, 1)
  for (let i = 1; i <= HALTON_SWEEP; i++) columns.push(haltonSpan(i, 2, -1, 1))
  const w = new Float64Array(16)
  for (let i = 0; i < columns.length; i++) {
    const k = i + 1,
      scale = 10 ** haltonSpan(k, 7, -3, 3)
    w[8] = columns[i] * scale
    w[9] = haltonSpan(k, 3, -1, 1) * scale
    w[10] = haltonSpan(k, 5, -1, 1) * scale
    const fov = haltonSpan(k, 11, 1, 179),
      aspect = haltonSpan(k, 13, 0.05, 8)
    createPhysicsView()(cameraOf(w, fov, aspect), writer, null)
    const length = hypot3(w[8], w[9], w[10]) || 1
    for (let c = 0; c < 3; c++) assertSameFloat32(-w[8 + c] / length, sent.facing[c], `facing ${i}`)
    const old = Math.atan(Math.tan((fov * Math.PI) / 360) * hypot2(1, aspect))
    assertSameFloat32(old, sent.halfCone, `half cone ${i}`)
  }
  // A zero axis faces nowhere, its zeros signed as before.
  w.fill(0)
  createPhysicsView()(cameraOf(w, 60, 1), writer, null)
  for (let c = 0; c < 3; c++) assert.ok(Object.is(sent.facing[c], -0), `zero facing ${c}`)
})

test('a mover reach on length3 decides every tile nearness the old one decided', () => {
  const velocity = new Float32Array(6),
    node = new Object3D(),
    movers: number[] = [],
    tile = { id: -1, box: new Float64Array(6) } as unknown as Placed
  const spans = edgeValues(-50, 50)
  for (let i = 1; i <= HALTON_SWEEP; i++) spans.push(haltonSpan(i, 2, -50, 50))
  for (let i = 0; i < spans.length; i++) {
    const k = i + 1
    for (let c = 0; c < 3; c++) velocity[c] = haltonSpan(k, [2, 3, 5][c], -50, 50)
    velocity[0] = spans[i]
    const v = { x: velocity[0], y: velocity[1], z: velocity[2] }
    const mesh = {
      physics: { type: 'dynamic', velocity: v },
      localBounds: () => null,
      matrixWorld: null,
      position: { x: 0, y: 0, z: 0 },
    } as unknown as Bodied
    const nested = new Map([[0, { node, reach: 0.5 }]])
    const count = moversOf([mesh], nested as never, velocity, movers)
    // The old reaches: half size 0, then 0.5, plus the speed over `LOOKAHEAD_S`, 1 s.
    const speed = hypot3(velocity[0], velocity[1], velocity[2]) * 1
    const old = [0, 0, 0, 0 + speed, 0, 0, 0, 0.5 + speed]
    for (const id of [-1, 0]) {
      // A tile a fraction of the reach away, resident or not.
      const at = speed * haltonSpan(k, 7, 0.5, 1.5)
      tile.box.set([at, 0, 0, at, 0, 0])
      ;(tile as { id: number }).id = id
      const now = nearness(tile, [1e9, 0, 0], 0, movers, count)
      assert.ok(Object.is(now, nearness(tile, [1e9, 0, 0], 0, old, count)), `nearness ${i}`)
    }
  }
})

test('a distance or pulley joint length is the old one in float32', () => {
  const a = new Object3D(),
    b = new Object3D()
  const points = edgeValues(-100, 100)
  for (let i = 1; i <= HALTON_SWEEP; i++) points.push(haltonSpan(i, 2, -100, 100))
  for (let i = 0; i < points.length; i++) {
    const k = i + 1,
      p = (base: number) => haltonSpan(k, base, -100, 100)
    const anchor: [number, number, number] = [points[i], p(3), p(5)],
      anchorB: [number, number, number] = [p(7), p(11), p(13)],
      wheel: [number, number, number] = [p(17), p(19), p(23)],
      ratio = haltonSpan(k, 29, 0.25, 4)
    const between = (u: number[], v: number[]) => hypot3(v[0] - u[0], v[1] - u[1], v[2] - u[2])
    const distance = new Joint('distance', a, b, { anchor, anchorB })
    assertSameFloat32(between(anchor, anchorB), framesOf(distance).length, `distance ${i}`)
    const pulley = new Joint('pulley', a, b, { anchor, anchorB, over: [wheel, anchor], ratio })
    const old = between(anchor, wheel) * ratio + between(anchorB, anchor)
    assertSameFloat32(old, framesOf(pulley).length, `pulley ${i}`)
  }
})
