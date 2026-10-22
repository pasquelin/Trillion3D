import test from 'node:test'
import assert from 'node:assert/strict'
import { binSource } from './binWgsl.ts'
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

// The binning (`binWgsl.ts`) computes viewProj*world and the linear determinant once per page (per
// workgroup) instead of recomputing them for every triangle. Structure: the sharing really exists in
// the shader. Behavior: the hoisted product and determinant equal exactly what per-triangle
// calculation would yield, on hostile matrices (mirror, near-singular, large scale) — no approximation.

test('binning computes vp/det once per workgroup and rereads them per triangle', () => {
  const shader = binSource(4096)
  assert.match(shader, /var<workgroup> rowVp:mat4x4f;/)
  assert.match(shader, /var<workgroup> rowDet:f32;/)
  assert.match(shader, /rowVp=pageTransform\(page\);rowDet=pageWinding\(page\);/)
  assert.match(shader, /workgroupUniformLoad\(&rowSoftware\)/)
  assert.match(shader, /setupTriangle\(row,page,h,t,rowVp,rowDet\)/)
  // The setup takes the precomputed product, it never recomputes it.
  assert.match(shader, /subpixelOf\(vp\*vec4f\(pagePosition\(page,h,t\.corners\.x\),1\.0\)\)/)
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

/** The shipped split's verdict for a row of box `centre` ± 1 under a view whose clip depth is a
 *  constant (every corner within the near and far planes), its plane `plane` and its route flag. */
function splitsToSoftware(centre: number[], plane: number[], clipRoute: number) {
  const uni = {
    viewProj: new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 1]),
    clipPlane: plane,
    clipRoute,
    perspective: 0,
    hardwareEdge: 0,
  }
  const run = shaderRun<{ rasteredInSoftware(page: object, b: object, moving: boolean): boolean }>(
    binSource(4),
    ['rasteredInSoftware'],
    // The row's world is the identity: its product with the view's is the view's.
    { uni, pageTransform: () => uni.viewProj },
  )
  const page = {
    world: new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    lodSphere: [0, 0, 0, -1],
  }
  return run.rasteredInSoftware(page, { center: centre, extent: [1, 1, 1], edge: 1 }, false)
}

test('a cluster that reaches behind the view’s plane is the hardware raster’s while the cut culls by it', () => {
  const plane = [0, 0, 1, -5]
  // Wholly in front of z = 5, across it, wholly behind it.
  assert.equal(splitsToSoftware([0, 0, 10], plane, 1), true, 'in front: software')
  assert.equal(splitsToSoftware([0, 0, 5], plane, 1), false, 'across the plane: hardware')
  assert.equal(
    splitsToSoftware([0, 0, 0], plane, 1),
    false,
    'behind it: hardware, which cuts it all',
  )
  // The route off, or no plane: the split is the one without plane.
  assert.equal(splitsToSoftware([0, 0, 5], plane, 0), true, 'the cull off')
  assert.equal(splitsToSoftware([0, 0, 5], [0, 0, 0, 0], 1), true, 'no plane')
  assert.match(binSource(4), /if\(uni\.clipRoute!=0u\)\{behind=min\(behind,/)
})
