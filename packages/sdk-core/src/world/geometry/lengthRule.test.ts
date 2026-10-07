// The length rule on the generators (docs/MATHS.md "Lengths"): an extrusion's offset outline and a
// polyhedron's latitude, swept over Halton inputs against their former expression — `hypot2`, then
// a division by the length —, every value the drawn copy narrows to f32 identical.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Path, Shape } from '../math/curves.ts'
import { extrude } from './shape.ts'
import { polyhedron } from './polyhedron.ts'
import { signedArea } from './triangulate.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { hypot2 } from '../../../../math/src/float/hypot.ts'
import { oldOffset } from '../../../../../bench/oracles/core/length-rule.ts'
import { HALF_PI, TAU } from '../../../../math/src/constants.ts'

type P = [number, number]

/** A star-shaped ring of `count` points about `(cx, cy)`, counter-clockwise, its radii in
 *  `[inner, outer]` and its angles jittered, from the Halton terms from `from`. */
function star(from: number, count: number, cx: number, cy: number, inner: number, outer: number) {
  return Array.from({ length: count }, (_, i): P => {
    const angle = (TAU * (i + 0.8 * halton(from + i, 2))) / count,
      radius = inner + (outer - inner) * halton(from + i, 3)
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
  })
}

/** The `x, y` of every drawn position, narrowed to f32, as keys. */
function drawnPoints(g: ReturnType<typeof extrude>) {
  const p = g.attributes.position.array,
    keys = new Set<string>()
  for (let i = 0; i < p.length; i += 3) keys.add(`${Math.fround(p[i])},${Math.fround(p[i + 1])}`)
  return keys
}

test('an extrusion draws the offset outline of the former normalise, every f32 the same', () => {
  // 16 outlines of 192 points, each with a hole of 64: 4096 swept points, and the edges: a square
  // with a collinear corner (two equal unit edges) and a sharp notch (the miter clamped at 0.25).
  const shapes: { outline: P[]; hole: P[] | null; size: number; segments: number }[] = []
  for (let s = 0; s < 16; s++) {
    const from = 1 + s * 256,
      cx = 4 * halton(s + 1, 5) - 2,
      cy = 4 * halton(s + 1, 7) - 2
    shapes.push({
      outline: star(from, 192, cx, cy, 0.5 + halton(s + 1, 2), 2 + 3 * halton(s + 1, 3)),
      hole: star(from + 192, 64, cx, cy, 0.05, 0.4).reverse(),
      size: 0.02 + 0.3 * halton(s + 1, 11),
      segments: 1 + (s % 5),
    })
  }
  const square: P[] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 2],
    [1, 0.02],
    [0, 2],
  ]
  shapes.push({ outline: square, hole: null, size: 0.1, segments: 3 })
  let swept = 0
  for (const { outline, hole, size, segments } of shapes) {
    assert.ok(signedArea(outline) > 0, 'the outline runs counter-clockwise, as extrude keeps it')
    if (hole) assert.ok(signedArea(hole) < 0, 'the hole runs clockwise, as extrude keeps it')
    const shape = new Shape(outline)
    if (hole) shape.holes.push(new Path(hole))
    const g = extrude(shape, {
      depth: 1,
      bevelSize: size,
      bevelThickness: 0.2,
      bevelSegments: segments,
    })
    // The pushes `extrude` makes: `size · sin a` over its bevel's quarter turn.
    const grows = Array.from(
      { length: segments + 1 },
      (_, s) => size * Math.sin((s / segments) * HALF_PI),
    )
    const expected = new Set<string>()
    for (const ring of hole ? [outline, hole] : [outline])
      for (const grow of grows)
        for (const [x, y] of oldOffset(ring, grow)) {
          expected.add(`${Math.fround(x)},${Math.fround(y)}`)
          swept++
        }
    assert.deepEqual(drawnPoints(g), expected)
  }
  assert.ok(swept > 4096 * 2)
})

test('a polyhedron’s latitude of the former length, every f32 texture point the same', () => {
  // The build keeps each corner's unit normal and texture point at full precision: the former
  // `v` is taken on the very normal each texture point was made from.
  const vertices: number[] = [0, 1, 0, 0, -1, 0, 1, 0, 0, -0, 0, 1, 0, 0, -1, 0.6, 0.8, 0]
  for (let i = 1; vertices.length < 3 * 4098; i++)
    for (const base of [2, 3, 5]) vertices.push(4 * halton(i, base) - 2)
  const indices = Array.from({ length: vertices.length / 3 }, (_, i) => i)
  for (const detail of [1, 2]) {
    const g = polyhedron(vertices, indices, 1.7, detail),
      n = g.attributes.normal.array,
      uv = g.attributes.uv.array
    assert.ok(uv instanceof Float64Array && n instanceof Float64Array, 'held at full precision')
    for (let i = 0; i < uv.length / 2; i++) {
      const old = Math.atan2(n[3 * i + 1], hypot2(n[3 * i], n[3 * i + 2])) / Math.PI + 0.5
      assert.ok(Object.is(Math.fround(old), Math.fround(uv[2 * i + 1])), `vertex ${i}`)
    }
  }
})
