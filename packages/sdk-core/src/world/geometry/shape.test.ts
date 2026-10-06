import test from 'node:test'
import assert from 'node:assert/strict'
import { Path, Shape } from '../math/curves.ts'
import { extrude, shape } from './shape.ts'

type G = ReturnType<typeof shape>
const arrays = (g: G) => ({
  position: Array.from(g.attributes.position.array),
  normal: Array.from(g.attributes.normal.array),
  uv: Array.from(g.attributes.uv.array),
  index: Array.from(g.index!.array),
})

/** The signed volume a closed mesh encloses, positive when its faces turn outward. */
function volume(g: G) {
  const { position: p, index } = arrays(g)
  let sum = 0
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]].map((i) => p.slice(3 * i, 3 * i + 3))
    sum +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
  }
  return sum / 6
}

function bounds(g: G) {
  const p = arrays(g).position
  return [0, 1, 2].map((k) => {
    const axis = p.filter((_, i) => i % 3 === k)
    return [Math.min(...axis), Math.max(...axis)].map((v) => Math.round(v * 1e6) / 1e6)
  })
}

const square = (x0: number, y0: number, side: number, clockwise = false) => {
  const s = new Shape([
    [x0, y0],
    [x0 + side, y0],
    [x0 + side, y0 + side],
    [x0, y0 + side],
  ])
  return clockwise ? new Shape([...s.getPoints()].reverse().map((p) => [p.x, p.y] as const)) : s
}
const near = (a: number, b: number, label: string) =>
  assert.ok(Math.abs(a - b) < 1e-5, `${label}: ${a} ≠ ${b}`)

test('a flat shape faces +z, its uv its plane position, either way round', () => {
  for (const clockwise of [false, true]) {
    const { position, normal, uv, index } = arrays(shape(square(0, 0, 2, clockwise)))
    assert.equal(index.length, 6)
    assert.deepEqual(
      normal,
      Array(position.length / 3)
        .fill([0, 0, 1])
        .flat(),
    )
    assert.deepEqual(
      uv,
      position.filter((_, i) => i % 3 !== 2),
    )
    assert.ok(position.every((v, i) => i % 3 !== 2 || v === 0))
    let area = 0
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t], index[t + 1], index[t + 2]].map((i) =>
        uv.slice(2 * i, 2 * i + 2),
      )
      area += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
    }
    assert.equal(area, 4, 'counter-clockwise triangles covering the square')
  }
})

test('a hole, either way round, is left open', () => {
  for (const clockwise of [false, true]) {
    const s = square(0, 0, 4)
    const hole = new Path([
      [1, 2],
      [2.5, 1.5],
      [1, 1],
    ])
    s.holes.push(
      clockwise
        ? hole
        : new Path([
            [1, 1],
            [2.5, 1.5],
            [1, 2],
          ]),
    )
    near(volume(extrude(s, { bevelEnabled: false })), 16 - 0.75, `extruded, ${clockwise}`)
  }
})

test('an extrusion without bevel is the shape pushed over its depth, in slices', () => {
  const g = extrude(square(0, 0, 1, true), { depth: 2, steps: 3, bevelEnabled: false })
  near(volume(g), 2, 'volume')
  assert.deepEqual(bounds(g), [
    [0, 1],
    [0, 1],
    [0, 2],
  ])
  assert.equal(arrays(g).index.length / 3, 2 * 2 + 2 * 4 * 3, 'two caps and three slices of walls')
  near(volume(extrude(square(0, 0, 1))), volumeOfBevel(1, 1, 0.2, 0.1, 3), 'default bevel')
  near(volume(extrude(square(0, 0, 1), { steps: 0, bevelEnabled: false })), 1, 'one slice at least')
})

/** A square of side `side` beveled as `extrude` does: a stack of square frustums. */
function volumeOfBevel(
  side: number,
  depth: number,
  thickness: number,
  size: number,
  segments: number,
) {
  const layers: [number, number][] = []
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * (Math.PI / 2)
    layers.push([-thickness * Math.cos(a), size * Math.sin(a)])
  }
  layers.push([depth, size])
  for (let s = segments - 1; s >= 0; s--) {
    const a = (s / segments) * (Math.PI / 2)
    layers.push([depth + thickness * Math.cos(a), size * Math.sin(a)])
  }
  let v = 0
  for (let l = 0; l + 1 < layers.length; l++) {
    const [[z0, g0], [z1, g1]] = [layers[l], layers[l + 1]]
    const [a0, a1] = [(side + 2 * g0) ** 2, (side + 2 * g1) ** 2]
    v += ((z1 - z0) / 3) * (a0 + a1 + Math.sqrt(a0 * a1))
  }
  return v
}

test('a bevel rounds the rims as its thickness, size and segments say', () => {
  const options = { depth: 2, bevelThickness: 0.3, bevelSize: 0.25, bevelSegments: 5 }
  const g = extrude(square(0, 0, 1), options)
  near(volume(g), volumeOfBevel(1, 2, 0.3, 0.25, 5), 'volume')
  assert.deepEqual(bounds(g), [
    [-0.25, 1.25],
    [-0.25, 1.25],
    [-0.3, 2.3],
  ])
  // Rings: 6 on the front bevel, 1 at the back of the slice, 5 on the back bevel: 11 bands.
  assert.equal(arrays(g).index.length / 3, 2 * 4 * 11 + 2 * 2, 'walls and caps')
  const flat = extrude(square(0, 0, 1), { bevelSegments: 0 })
  near(volume(flat), volumeOfBevel(1, 1, 0.2, 0.1, 1), 'one bevel step at least')
  assert.deepEqual(bounds(extrude(square(0, 0, 1), { bevelSize: 0 }))[0], [0, 1], 'no reach')
})

test('a repeated corner and a spike stay finite, the spike offset at most four sizes', () => {
  const repeated = new Shape([
    [0, 0],
    [1, 0],
    [1, 0],
    [1, 1],
  ])
  assert.ok(arrays(extrude(repeated)).position.every(Number.isFinite))
  const spike = new Shape([
    [0, 0],
    [10, 0.1],
    [0, 0.2],
  ])
  const [x] = bounds(extrude(spike, { bevelSize: 0.1 }))
  assert.ok(x[1] > 10.1 && x[1] <= 10.4 + 1e-6, `the spike reaches ${x[1]}`)
})

test('walls map each quad corner to its uv corner; curves sample as curveSegments say', () => {
  const { position, uv, index } = arrays(extrude(square(0, 0, 1), { bevelEnabled: false }))
  const walls: number[][] = []
  for (let t = 0; t < index.length; t += 3) {
    const corners = [index[t], index[t + 1], index[t + 2]]
    if (new Set(corners.map((i) => position[3 * i + 2])).size > 1)
      walls.push(corners.flatMap((i) => uv.slice(2 * i, 2 * i + 2)))
  }
  assert.equal(walls.length, 8)
  for (const w of walls)
    assert.ok(
      [
        [0, 0, 1, 0, 1, 1],
        [0, 0, 1, 1, 0, 1],
      ].some((quad) => quad.every((v, k) => v === w[k])),
      `wall uv ${w}`,
    )
  const curved = new Shape().moveTo(0, 0).lineTo(2, 0).quadraticCurveTo(2, 2, 0, 2)
  const caps = (segments?: number) =>
    arrays(extrude(curved, { bevelEnabled: false, curveSegments: segments })).index.length / 3
  // A ring of n points: n − 2 triangles per cap, 2 n per slice of wall.
  assert.equal(caps(2), 2 * 2 + 2 * 4)
  assert.equal(caps(), 2 * 12 + 2 * 14)
})
