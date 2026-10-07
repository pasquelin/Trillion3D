import test from 'node:test'
import assert from 'node:assert/strict'
import { geometry } from './index.ts'
import { drawnTriangles, readList } from './drawn.ts'
import { BufferAttribute } from '../buffer/index.ts'
import { Geometry } from './geometry.ts'
import { pendingAttribute } from '../buffer/attribute.ts'

/** The corners of a drawn quad, four per segment: `a` twice, then `b` twice. */
function corners(drawn: NonNullable<ReturnType<typeof drawnTriangles>>, quad: number) {
  const at = (v: number, from: Float32Array) => Array.from(from.subarray(v * 3, v * 3 + 3))
  return [0, 1, 2, 3].map((k) => ({
    p: at(quad * 4 + k, drawn.positions),
    n: at(quad * 4 + k, drawn.normals),
  }))
}

const attr = (values: number[], width: number) =>
  new BufferAttribute(new Float32Array(values), width)

const position = (values: number[]) => new BufferAttribute(new Float32Array(values), 3)

// A segment is two triangles whose corners all sit on its endpoints, the direction in the
// normal signed by side — the rasters widen it on screen. It was a closed prism of twelve
// triangles, as thick as a share of the geometry's diagonal.
test('a line segment draws as a quad on its endpoints, its direction signed by side', () => {
  const box = geometry.box(1, 1, 1)
  const drawn = drawnTriangles(geometry.edges(box), 'lineSegments')!
  assert.equal(drawn.lines, true)
  assert.equal(drawn.indices.length, 12 * 6, 'two triangles for each of the 12 edges')
  assert.equal(drawn.positions.length, 12 * 4 * 3, 'four corners per edge')
  assert.equal(drawn.uvs, null)
  for (let quad = 0; quad < 12; quad++) {
    const [a0, a1, b0, b1] = corners(drawn, quad)
    assert.deepEqual(a0.p, a1.p, 'both first corners on the first endpoint')
    assert.deepEqual(b0.p, b1.p, 'both last corners on the last endpoint')
    const d = b0.p.map((x, i) => x - a0.p[i])
    const length = Math.hypot(...d)
    assert.equal(length, 1, 'a unit box edge')
    for (const [corner, side] of [
      [a0, 1],
      [a1, -1],
      [b0, 1],
      [b1, -1],
    ] as const)
      corner.n.forEach((x, i) => assert.equal(x, (side * d[i]) / length))
  }
  // Every triangle has two corners on one endpoint and one on the other, sides mixed.
  for (let t = 0; t < drawn.indices.length; t += 3) {
    const quad = Math.floor(drawn.indices[t] / 4)
    const local = [0, 1, 2].map((k) => drawn.indices[t + k] - quad * 4)
    assert.ok(local.some((v) => v < 2) && local.some((v) => v >= 2))
  }
})

test('a strip, a loop and a wireframe read their segments into quads; a zero segment draws none', () => {
  const path = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 2, 0]), 3),
  })
  const strip = drawnTriangles(path, 'lineStrip')!
  assert.equal(strip.indices.length / 6, 2, 'the zero-length middle segment is skipped')
  assert.equal(drawnTriangles(path, 'lineLoop')!.indices.length / 6, 3)
  const wire = drawnTriangles(geometry.box(1, 1, 1), 'triangles', { wireframe: true })!
  assert.equal(wire.lines, true)
  assert.equal(wire.indices.length / 6, 18, 'twelve box edges and six face diagonals')
  const faces = drawnTriangles(geometry.box(1, 1, 1), 'triangles')!
  assert.equal(faces.lines, undefined, 'faces stay faces')
})

// A dashed line's quads carry each corner's distance along the line, the running length of
// the segments before it — the line-distance rule —, a loop's closing segment
// running back from the total to the first vertex's 0. Any other line keeps no coordinate, and the same quads to the byte.
test('a dashed line carries the distance along the line; a solid one is unchanged', () => {
  const path = geometry.createBuffer({
    position: new BufferAttribute(new Float32Array([0, 0, 0, 3, 0, 0, 3, 4, 0]), 3),
  })
  const u = (drawn: NonNullable<ReturnType<typeof drawnTriangles>>) =>
    Array.from(drawn.uvs!).filter((_, i) => i % 2 === 0)
  const strip = drawnTriangles(path, 'lineStrip', { dashed: true })!
  assert.deepEqual(u(strip), [0, 0, 3, 3, 3, 3, 7, 7])
  assert.ok(Array.from(strip.uvs!).every((v, i) => i % 2 === 0 || v === 0))
  assert.deepEqual(u(drawnTriangles(path, 'lineLoop', { dashed: true })!).slice(8), [7, 7, 0, 0])
  // Segments count on from the one before, as a segment list's rule says.
  const pairs = drawnTriangles(path, 'lineSegments', { dashed: true })!
  assert.deepEqual(u(pairs), [0, 0, 3, 3])
  for (const reading of ['lineStrip', 'lineLoop', 'lineSegments'] as const) {
    const solid = drawnTriangles(path, reading)!,
      dashed = drawnTriangles(path, reading, { dashed: true })!
    assert.equal(solid.uvs, null, `${reading}: a solid line pays nothing`)
    assert.deepEqual(solid.positions, dashed.positions)
    assert.deepEqual(solid.normals, dashed.normals)
    assert.deepEqual(solid.indices, dashed.indices)
  }
  const faces = drawnTriangles(geometry.box(1, 1, 1), 'triangles', { dashed: true })!
  assert.deepEqual(faces, drawnTriangles(geometry.box(1, 1, 1), 'triangles'), 'faces stay faces')
})

test('drawn triangles preserve attributes, pad alpha and omit incomplete triangles', () => {
  const g = new Geometry().setAttribute('position', attr([1, 2, 3, 4, 2, 3, 1, 6, 3, 7, 8, 9], 3))
  g.setAttribute('normal', attr([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  g.setAttribute('uv', attr([0, 0, 1, 0, 0, 1, 1, 1], 2))
  g.setAttribute('color', attr([1, 0, 0, 0, 1, 0, 0, 0, 1, 0.5, 0.5, 0.5], 3))
  const drawn = drawnTriangles(g, 'triangles')!
  assert.deepEqual([...drawn.indices], [0, 1, 2])
  assert.deepEqual([...drawn.positions], [1, 2, 3, 4, 2, 3, 1, 6, 3, 7, 8, 9])
  assert.deepEqual([...drawn.normals], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
  assert.deepEqual([...drawn.uvs!], [0, 0, 1, 0, 0, 1, 1, 1])
  assert.deepEqual([...drawn.colors!], [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0.5, 0.5, 0.5, 1])
  const out = new Float32Array(16).fill(99)
  assert.equal(readList(g, 'color', 4, 4, out), out)
  assert.deepEqual(out, drawn.colors)
  assert.equal(readList(g, 'missing', 3, 4), null)
  assert.equal(readList(g, 'normal', 3, 5), null)
  g.setIndex([2, 0])
  assert.equal(drawnTriangles(g, 'triangles'), null)
  assert.equal(drawnTriangles(new Geometry(), 'points'), null)
  assert.equal(
    drawnTriangles(new Geometry().setAttribute('position', attr([], 3)), 'triangles'),
    null,
  )
})

test('point solids preserve source deformation per original point and material size', () => {
  const g = new Geometry().setAttribute('position', attr([1, 2, 3, 8, 9, 10], 3))
  g.morphAttributes.position = [attr([2, 3, 4, 9, 10, 11], 3)]
  const drawn = drawnTriangles(g, 'points', { size: 4 })!
  assert.equal(drawn.indices.length, 48)
  assert.equal(drawn.positions.length, 144)
  assert.deepEqual([...drawn.sourceVertices!], [...Array(24).fill(0), ...Array(24).fill(1)])
  const points = new Set<string>()
  for (let i = 0; i < drawn.positions.length; i += 3)
    points.add(Array.from(drawn.positions.slice(i, i + 3)).join(','))
  assert.deepEqual(
    points,
    new Set([
      '3,2,3',
      '-1,2,3',
      '1,4,3',
      '1,0,3',
      '1,2,5',
      '1,2,1',
      '10,9,10',
      '6,9,10',
      '8,11,10',
      '8,7,10',
      '8,9,12',
      '8,9,8',
    ]),
  )
  assert.ok([...drawn.deformation!.targets[0].positions].every((x) => x === 1))
})

test('empty pending positions draw nothing without demanding unavailable vertex storage', () => {
  const g = new Geometry().setAttribute(
    'position',
    pendingAttribute(
      {
        length: 0,
        type: 'Float32Array',
        read: async () => new Float32Array(),
      },
      3,
      false,
    ),
  )
  for (const primitive of ['triangles', 'points', 'lineStrip', 'sprite'] as const)
    assert.equal(drawnTriangles(g, primitive), null)
})

test('attribute extraction leaves a caller-provided tail untouched', () => {
  const g = new Geometry().setAttribute('normal', position([1, 2, 3, 4, 5, 6]))
  const out = new Float32Array(9).fill(99)
  assert.equal(readList(g, 'normal', 3, 2, out), out)
  assert.deepEqual(Array.from(out), [1, 2, 3, 4, 5, 6, 99, 99, 99])
  out.fill(77)
  assert.equal(readList(g, 'normal', 3, 0, out), out)
  assert.deepEqual(Array.from(out), Array(9).fill(77))
})
