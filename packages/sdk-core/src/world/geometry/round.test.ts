import test from 'node:test'
import assert from 'node:assert/strict'
import { SplineCurve, Path, Curve } from '../math/curves.ts'
import { Vector3 } from '../math/vector3.ts'
import { torusKnot, tube, torus } from './round.ts'
import { RECIPES } from './recipes.ts'

/** Every vertex of the last ring of a `(tubular + 1) × (radial + 1)` sweep sits on the first's. */
function assertCloses(position: ArrayLike<number>, tubular: number, radial: number) {
  for (let j = 0; j <= radial; j++) {
    const [first, last] = [j * (tubular + 1) * 3, (j * (tubular + 1) + tubular) * 3]
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(position[first + k] - position[last + k]) < 1e-9, `ring vertex ${j}`)
  }
}

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)

class Slanted extends Curve {
  getPoint(t: number, out = new Vector3()) {
    return out.set(3 * t, 4 * t, 0)
  }
}

test('a torus knot closes: its last ring lands on its first, vertex for vertex', () => {
  const [tubular, radial] = [480, 40]
  assertCloses(
    torusKnot(1.5, 0.34, tubular, radial, 2, 3).attributes.position.array,
    tubular,
    radial,
  )
})

test('a closed tube along a curve out of any plane closes on itself', () => {
  const points = [
    [1, 0, 0],
    [0, 1, 0.6],
    [-1, 0, 0],
    [0, -1, -0.8],
    [0.4, 0.3, 1],
  ].map(([x, y, z]) => new Vector3(x, y, z))
  assertCloses(
    tube(new SplineCurve(points, true), 64, 0.1, 8, true).attributes.position.array,
    64,
    8,
  )
})

test('torus tube lies at the declared distance from its central circle, with outward normals', () => {
  for (const arc of [Math.PI, Math.PI * 2]) {
    const g = torus(5, 2, 4, 8, arc),
      p = g.attributes.position,
      n = g.attributes.normal,
      uv = g.attributes.uv
    assert.equal(p.count, 45)
    assert.equal(g.index!.count, 192)
    assert.equal(RECIPES[g.recipe!.type], torus)
    assert.deepEqual(g.recipe!.args, [5, 2, 4, 8, arc])
    for (let i = 0; i < p.count; i++) {
      near(Math.hypot(Math.hypot(p.getX(i), p.getY(i)) - 5, p.getZ(i)), 2)
      near(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1)
      near(p.getZ(i), 2 * n.getZ(i))
      const cx = p.getX(i) - 2 * n.getX(i),
        cy = p.getY(i) - 2 * n.getY(i)
      near(Math.hypot(cx, cy), 5)
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1)
    }
    near(p.getX(0), 7)
    near(p.getY(0), 0)
    near(p.getZ(9), 2)
    near(p.getX(8), arc === Math.PI ? -7 : 7)
    assert.equal(uv.getX(8), 1)
    assert.equal(uv.getY(36), 1)
  }
})

test('open tubes keep translated endpoints, radius and normals across either frame seed', () => {
  for (const end of [new Vector3(8, 2, 3), new Vector3(1, 9, 3), new Vector3(5, 7, 9)]) {
    const start = new Vector3(1, 2, 3),
      path = new Path([start, end])
    const g = tube(path, 4, 0.5, 4),
      p = g.attributes.position,
      n = g.attributes.normal
    assert.equal(p.count, 25)
    assert.equal(g.index!.count, 96)
    for (let i = 0; i < p.count; i++) {
      const centre = path.getPoint((i % 5) / 4),
        delta = new Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(centre)
      near(delta.length(), 0.5)
      near(delta.dot(end.clone().sub(start)), 0)
      near(delta.x, 0.5 * n.getX(i))
      near(delta.y, 0.5 * n.getY(i))
      near(delta.z, 0.5 * n.getZ(i))
    }
  }
  const knot = torusKnot(2, 0.25, 8, 4, 1, 2)
  assert.equal(RECIPES[knot.recipe!.type], torusKnot)
  assert.deepEqual(knot.recipe!.args, [2, 0.25, 8, 4, 1, 2])
  assert.equal(knot.attributes.position.count, 45)
})

test('tube UVs run around each ring and along the path, end to end', () => {
  const g = tube(new Slanted(), 2, 0.5, 3)
  const uv = g.attributes.uv
  assert.equal(uv.count, 12)
  for (let ring = 0; ring <= 3; ring++) {
    for (let along = 0; along <= 2; along++) {
      const vertex = ring * 3 + along
      assert.equal(uv.getX(vertex), along / 2)
      assert.equal(uv.getY(vertex), ring / 3)
    }
  }
})

test('a two-three torus knot passes its independently known crossing and height landmarks', () => {
  const g = torusKnot(2, 0.25, 8, 4, 2, 3),
    p = g.attributes.position
  // Opposite vertices of the same tube ring have their midpoint on the centre curve.
  for (const [i, expected] of [
    [0, [3, 0, 0]],
    [2, [-2, 0, -1]],
    [4, [1, 0, 0]],
    [6, [-2, 0, 1]],
    [8, [3, 0, 0]],
  ] as const) {
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs((p.getComponent(i, c) + p.getComponent(18 + i, c)) / 2 - expected[c]) < 1e-8,
      )
  }
})
