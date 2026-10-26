import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_VISIBLE_WGSL } from '../../geometry/dag/shader/visibleWgsl.ts'
import {
  DAG_CLIP_PLANE_WGSL,
  DAG_NO_CLIP_PLANE_WGSL,
} from '../../geometry/dag/shader/clipPlaneWgsl.ts'
import { rasterSource } from './shader.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import {
  hoisted,
  perVertex,
  IDENTITY,
  MIRROR_X,
  NEAR_SINGULAR,
  LARGE_SCALE,
  type Mat4,
  type Point,
} from '../../../../../bench/oracles/browser/mat4HoistOracle.ts'
import { linearPartDeterminant } from '../../../../math/src/matrix/matrix4.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { buildTessellationTable } from '../tessellation/table/build.ts'
import { TABLE_DATA_WORD } from '../tessellation/contract.ts'
import { patternIndex } from '../tessellation/patternIndex.fixture.ts'
import { CHILDREN_WGSL } from '../tessellation/queueWgsl.ts'

// The cluster raster (`clusterWgsl.ts`) computes viewProj*world and the linear determinant once per
// cluster (per workgroup) instead of recomputing them for every triangle, and transforms each vertex
// of the cluster once instead of once for every triangle that uses it. Structure: the sharing really
// exists in the shader. Behavior: the hoisted product and determinant equal exactly what per-triangle
// calculation would yield, on hostile matrices (mirror, near-singular, large scale) — no approximation.

test('the cluster raster computes vp/det once per group and each vertex once into the group’s memory', () => {
  const shader = rasterSource()
  assert.match(shader, /var<workgroup> corner:array<vec4f,256>;/)
  assert.match(shader, /let vp=pageTransform\(page\);/)
  assert.match(shader, /let det=pageWinding\(page\);/)
  assert.match(shader, /workgroupUniformLoad\(&groupRow\)/)
  // Each thread transforms some of the cluster's vertices once, by the precomputed product.
  assert.match(shader, /corner\[v\]=subpixelOf\(vp\*vec4f\(pagePosition\(page,h,v\),1\.0\)\);/)
  // A triangle reads its corners there and sets up from them, with the determinant it was given.
  assert.match(shader, /s0=corner\[k\.x\];s1=corner\[k\.y\];s2=corner\[k\.z\];/)
  assert.match(shader, /setupSubpixel\(t,page,det,s0,s1,s2\)/)
  // A row held in no such memory takes the product, never recomputes it.
  assert.match(shader, /subpixelOf\(vp\*vec4f\(pagePosition\(page,h,k\.x\),1\.0\)\)/)
})

function assertSameVertices(viewProj: Mat4, world: Mat4, vertices: readonly Point[]) {
  const a = hoisted(viewProj, world, vertices)
  const b = perVertex(viewProj, world, vertices)
  for (let i = 0; i < vertices.length; i++) assert.deepEqual(a[i], b[i], `vertex ${i}`)
}

const TRIANGLE: readonly Point[] = [
  [0.2, 0.4, 0.6],
  [-1, 0, 0.9],
  [3, -2, 0.1],
]

test('product hoisted once == product recomputed per vertex, identity matrix', () => {
  assertSameVertices(IDENTITY, IDENTITY, TRIANGLE)
})

test('product hoisted once == product recomputed per vertex, mirror matrix', () => {
  assertSameVertices(IDENTITY, MIRROR_X, TRIANGLE)
  assertSameVertices(MIRROR_X, MIRROR_X, TRIANGLE)
})

test('product hoisted once == product recomputed per vertex, near-singular matrix', () => {
  assertSameVertices(IDENTITY, NEAR_SINGULAR, TRIANGLE)
})

test('product hoisted once == product recomputed per vertex, large scale', () => {
  assertSameVertices(LARGE_SCALE, IDENTITY, TRIANGLE)
  assertSameVertices(LARGE_SCALE, MIRROR_X, TRIANGLE)
})

test('determinant hoisted once per page equals the linear part determinant, including mirror', () => {
  // Each linear part is triangular: its determinant is its diagonal's product, taken by hand.
  const cases: [Mat4, number][] = [
    [IDENTITY, 1],
    [MIRROR_X, -1],
    [NEAR_SINGULAR, 1e-9 * 1e-6],
    [LARGE_SCALE, 1e15],
  ]
  for (const [world, determinant] of cases) assert.equal(linearPartDeterminant(world), determinant)
})

/** The cut's verdict for a cluster of box `centre` ± 1 (`needsClipping`, `../../geometry/dag/shader/visibleWgsl.ts`)
 *  under a view whose clip depth is a constant (every corner within the near and far planes), its
 *  plane `plane`, from the cut made for the project switch (`clipping`) or the plain one, `off`
 *  the host's switch of the plane's cull: whether the hardware raster takes it, which cuts it. */
function needsClipping(centre: number[], plane: number[], off = false, clipping = true) {
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const views = [
    { viewProj: new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1]), clipPlane: plane },
  ]
  const run = shaderRun<{ needsClipping(w: number, c: number[], e: number[]): boolean }>(
    wgslBlock(
      'NEEDS_CLIPPING',
      [DAG_VISIBLE_WGSL, clipping ? DAG_CLIP_PLANE_WGSL : DAG_NO_CLIP_PLANE_WGSL],
      '',
    ),
    ['needsClipping'],
    {
      views,
      // The cut reads its one view as `cutView` (the descent's uniform), no longer `views[0]`.
      cutView: views[0],
      // The placement is the identity: its pose and its plane's matrix.
      placed: () => {},
      placedPose: identity,
      placedT: identity,
      cullOff: () => off,
      CULL_CLIP_PLANE_OFF: 0,
      // The finite stand-in for infinity the cut's `INF` takes.
      FINITE_SENTINEL: 3.4e38,
    },
  )
  return run.needsClipping(0, centre, [1, 1, 1])
}

test('a cluster that reaches behind the view’s plane is the hardware raster’s while the cut culls by it', () => {
  const plane = [0, 0, 1, -5]
  // Wholly in front of z = 5, across it, wholly behind it.
  assert.equal(needsClipping([0, 0, 10], plane), false, 'in front: none')
  assert.equal(needsClipping([0, 0, 5], plane), true, 'across the plane: hardware')
  assert.equal(needsClipping([0, 0, 0], plane), true, 'behind it: hardware, which cuts it all')
  // The cull off, or a view with no plane: the verdict without it.
  assert.equal(needsClipping([0, 0, 5], plane, true), false, 'the cull off')
  assert.equal(needsClipping([0, 0, 5], [0, 0, 0, 0]), false, 'no plane')
  // Without the project switch the cut holds none of it, whatever the uniform says.
  assert.equal(needsClipping([0, 0, 5], plane, false, false), false, 'the switch off')
})

/** The tessellation's table as the kernels read it: the offsets, then the patterns' words. */
const tessTable = () => {
  const table = buildTessellationTable()
  const tess = new Uint32Array(TABLE_DATA_WORD + table.data.length)
  tess.set(table.offsets, 0)
  tess.set(table.data, TABLE_DATA_WORD)
  return { table, tess }
}

/** FNV-1a over the bytes of the words. */
function digest(...arrays: Uint32Array[]) {
  let h = 0x811c9dc5
  for (const words of arrays)
    for (const word of words)
      for (let shift = 0; shift < 32; shift += 8)
        h = Math.imul(h ^ ((word >>> shift) & 255), 0x01000193) >>> 0
  return h
}

// A triangle's pattern is its three edges' factors: the edge of factor n is cut in n pieces, so that
// two triangles sharing an edge cut it alike and no crack opens. The table holds one for every
// ordered triple up to 14, the pattern of the reference's table to the word.
test('the tessellation table holds a pattern for each ordered triple of factors, the reference’s word for word', () => {
  const { table } = tessTable()
  const at = (x: number, y: number, z: number) => 2 * patternIndex(x, y, z)
  let patterns = 0
  for (let z = 1; z <= 14; z++)
    for (let y = z; y <= 14; y++)
      for (let x = y; x <= 14; x++) {
        patterns++
        const packed = table.offsets[at(x, y, z) + 1]!
        const base = table.offsets[at(x, y, z)]!
        const [vertices, triangles] = [(packed >>> 13) & 0x1ff, packed >>> 22]
        const corner = (i: number) => {
          const word = table.data[base + i]!
          const [a, b] = [(word & 0xffff) / 32768, (word >>> 16) / 32768]
          return [a, b, 1 - a - b]
        }
        // Each edge holds its factor's pieces, a vertex a piece's end; the triangles, wound the
        // same way, tile the whole.
        const on = (axis: number) =>
          [...Array(vertices).keys()].filter((i) => Math.abs(corner(i)[axis]!) < 1e-9).length
        assert.deepEqual([on(2) - 1, on(0) - 1, on(1) - 1], [x, y, z], `edges of ${x},${y},${z}`)
        let area = 0
        for (let t = 0; t < triangles; t++) {
          const word = table.data[base + vertices + t]!
          const [a, b, c] = [word & 1023, (word >> 10) & 1023, (word >> 20) & 1023].map(corner)
          const twice =
            (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!)
          assert.ok(twice > 0, `triangle ${t} of ${x},${y},${z} is wound the other way`)
          area += twice / 2
        }
        assert.ok(Math.abs(area - 0.5) < 1e-3, `${x},${y},${z} covers ${area} of the triangle`)
      }
  assert.equal(patterns, 560)
  assert.equal(table.data.length, 43598)
  // The tables' words, as the reference's own file holds them.
  assert.equal(digest(table.offsets, table.data), 0x8bd5821a)
})

type Children = {
  queueChildren(id: number, parent: number[][], requested: number[], skipSame: boolean): void
}

/** A patch's corners as the queue holds them, and the twice area they span on the source triangle. */
const cornersOf = (words: Uint32Array, at: number) =>
  [1, 2, 3].map((k) => {
    const e = words[at + k]!
    const [x, y] = [(e & 0xffff) / 32768, (e >>> 16) / 32768]
    return [x, y, 1 - x - y]
  })
const twice = ([a, b, c]: number[][]) =>
  (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!)

test('a patch too large for one pattern is cut into the children of its pattern, which tile it and keep its winding', () => {
  const { tess: table } = tessTable()
  const queue = 40_000
  for (const [parent, requested] of [
    [
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [2.2, 1.4, 0.7],
    ],
    [
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [8, 8, 8],
    ],
    [
      [
        [0.5, 0.5, 0],
        [0, 0.5, 0.5],
        [0.25, 0, 0.75],
      ],
      [3, 5.5, 2],
    ],
    [
      [
        [0, 0.5, 0.5],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [1, 4, 1],
    ],
  ] as const) {
    const tess = new Uint32Array(table.length + 16 + 4 * queue)
    tess.set(table)
    const args = table.length
    const tu = { maxCandidate: queue, args, queue: args + 16, visible: 0, dispatch: 0 }
    const run = shaderRun<Children>(wgslBlock('children', [CHILDREN_WGSL], ''), ['queueChildren'], {
      tess,
      tu,
    })
    run.queueChildren(
      0xabc,
      parent.map((c) => [...c]),
      [...requested],
      false,
    )
    const count = tess[args]!
    assert.ok(count > 1, 'more than the patch itself')
    // The patch's corners as columns: the whole it is cut from has this area.
    const whole = Math.abs(twice(parent.map((c) => [...c])))
    let sum = 0
    for (let i = 0; i < count; i++) {
      assert.equal(tess[args + 16 + 4 * i], 0xabc, 'each child names the source triangle')
      const area = twice(cornersOf(tess, args + 16 + 4 * i))
      assert.ok(
        area * Math.sign(twice(parent.map((c) => [...c]))) > 0,
        `child ${i} is wound as the patch is`,
      )
      sum += Math.abs(area)
    }
    assert.ok(Math.abs(sum - whole) < 2e-3, `${count} children cover ${sum} of ${whole}`)
  }
})
