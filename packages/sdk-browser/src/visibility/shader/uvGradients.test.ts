// The resolve's UV gradients (`UV_GRADIENTS_WGSL`) are the derivatives a fragment reads, exact at
// the pixel: one formula in WGSL, its CPU mirror `uvDerivatives` in TypeScript.
import test from 'node:test'
import assert from 'node:assert/strict'
import { UV_GRADIENTS_WGSL } from './uvGradientsWgsl.ts'
import { SHADE_SHADER } from './shadeWgsl.ts'
import { uvDerivatives } from '../uvDerivatives.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat, Mat3 } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import * as W from '../tessellation/prismWgsl.ts'

test('the resolve reads the one gradient formula and keeps no copy', () => {
  assert.equal(SHADE_SHADER.split(UV_GRADIENTS_WGSL.text).length - 1, 1)
  assert.match(SHADE_SHADER, /=uvGradients\(/)
  assert.doesNotMatch(SHADE_SHADER.replace(UV_GRADIENTS_WGSL.text, ''), /dUdx|dsdx/)
})

test('its CPU mirror matches central differences of perspective-correct interpolation', () => {
  const at = (x: number, y: number, invW: number) =>
    ({ x, y, z: 0, invW, worldX: 0, worldY: 0, worldZ: 0 }) as const
  const a = at(3, 5, 1),
    b = at(41, 9, 0.2),
    c = at(12, 37, 0.05)
  const [uva, uvb, uvc] = [
    [0, 0],
    [4, 0.5],
    [1, 6],
  ] as [number, number][]
  const uvAt = (x: number, y: number) => {
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    const wb = ((x - a.x) * (c.y - a.y) - (y - a.y) * (c.x - a.x)) / area
    const wc = ((y - a.y) * (b.x - a.x) - (x - a.x) * (b.y - a.y)) / area
    const q = [(1 - wb - wc) * a.invW, wb * b.invW, wc * c.invW]
    const sum = q[0]! + q[1]! + q[2]!
    return [0, 1].map((k) => (q[0]! * uva[k]! + q[1]! * uvb[k]! + q[2]! * uvc[k]!) / sum)
  }
  const [x, y, h] = [15.5, 14.5, 1e-4]
  const d = uvDerivatives(a, b, c, uva, uvb, uvc, x, y)
  const dx = [0, 1].map((k) => (uvAt(x + h, y)[k]! - uvAt(x - h, y)[k]!) / (2 * h))
  const dy = [0, 1].map((k) => (uvAt(x, y + h)[k]! - uvAt(x, y - h)[k]!) / (2 * h))
  for (const [got, want] of [
    [d.duDx, dx[0]],
    [d.dvDx, dx[1]],
    [d.duDy, dy[0]],
    [d.dvDy, dy[1]],
  ] as [number, number][]) {
    assert.ok(Math.abs(got - want) < 1e-6 * Math.max(1, Math.abs(want)), `${got} vs ${want}`)
  }
})

// A displaced row's pixel holds the source triangle, not the point of it the pixel shows: the resolve
// solves the displaced prism for the weights (`solveDisplaced`, `../tessellation/prismWgsl.ts`).
const prism = shaderRun<{
  prismWeights(...args: unknown[]): { value: number[]; dx: number[]; dy: number[]; ok: boolean }
  inverse3(m: Mat3): Mat3
  prismPixel(...args: unknown[]): { at: number[]; atX: number[]; atY: number[]; eye: number[] }
}>(
  wgslBlock('prismTest', [W.prismWeights, W.inverse3, W.prismPixel], ''),
  ['prismWeights', 'inverse3', 'prismPixel'],
  {},
)
const add = (a: number[], b: number[], k = 1) => a.map((x, i) => x + k * b[i]!)

test('the prism solve recovers the weights of a point on the displaced triangle, where the flat triangle misplaces it', () => {
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  const normals = [
    [0, 0, 1],
    [0.1, 0, 0.99],
    [0, 0.1, 0.99],
  ]
  const push = 0.2,
    weights = [0.3, 0.3, 0.4]
  const displaced = corners.map((c, i) => add(c, normals[i]!, push))
  const at = (w: number[]) => displaced.reduce((sum, c, i) => add(sum, c, w[i]!), [0, 0, 0])
  const [camera, pixel] = [[0.5, 0.5, 5], at(weights)]
  const solve = prism.prismWeights(
    camera,
    pixel,
    add(pixel, [0.02, 0, 0]),
    add(pixel, [0, 0.02, 0]),
    new Mat3(corners),
    new Mat3(normals),
  )
  assert.ok(solve.ok)
  solve.value.forEach((w, i) => assert.ok(Math.abs(w - weights[i]!) < 1e-5, `${solve.value}`))
  // The flat triangle's weights of the same pixel, by the ray through it: a parallax away.
  const flat = rayWeights(camera, add(pixel, camera, -1), corners)
  assert.ok(Math.abs(flat[0]! - weights[0]!) > 100 * Math.abs(solve.value[0]! - weights[0]!))
  // The steps to the neighbours are those of the rays through them on the displaced triangle.
  for (const [step, shift] of [
    [solve.dx, [0.02, 0, 0]],
    [solve.dy, [0, 0.02, 0]],
  ] as const) {
    const hit = rayWeights(camera, add(pixel, shift as number[], 1), displaced)
    step.forEach((s, i) => assert.ok(Math.abs(s - (hit[i]! - weights[i]!)) < 1e-3))
  }
})

/** The solve in TypeScript, step for step: the weights of the point of the triangle `v` nearest to
 *  `pixel` along its normal, clamped to the triangle and made to sum to one when `clamp`, the
 *  interpolated normal there, the distance the pixel lies along it, the corners pushed by it —
 *  twice —, then the weights of the pixel on the final triangle. */
function solveOracle(pixel: number[], v: number[][], n: number[][], clamp: boolean) {
  const sub = (a: number[], b: number[]) => add(a, b, -1)
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ]
  const closest = (p: number[], c: number[][]) =>
    rayWeights(p, add(p, cross(sub(c[2]!, c[0]!), sub(c[1]!, c[0]!))), c)
  let c = v.map((x) => [...x])
  for (let round = 0; round < 2; round++) {
    let w = closest(pixel, c)
    if (clamp) {
      w = w.map((x) => Math.max(x, 0))
      w = w.map((x) => x / (w[0]! + w[1]! + w[2]!))
    }
    const at = c.reduce((sum, x, i) => add(sum, x, w[i]!), [0, 0, 0])
    const normal = n.reduce((sum, x, i) => add(sum, x, w[i]!), [0, 0, 0])
    const push = dot(sub(pixel, at), normal) / dot(normal, normal)
    c = c.map((x, i) => add(x, n[i]!, push))
  }
  return closest(pixel, c)
}

test('the closest point is held to the triangle, as the reference holds it, where the pixel lies past an edge', () => {
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  const normals = [
    [0, 0, 1],
    [0.5, 0, 0.86],
    [0, 0.5, 0.86],
  ]
  const pixel = [1.3, 0.2, 0.4]
  const solve = prism.prismWeights(
    [0.5, 0.5, 5],
    pixel,
    add(pixel, [0.02, 0, 0]),
    add(pixel, [0, 0.02, 0]),
    new Mat3(corners),
    new Mat3(normals),
  )
  const held = solveOracle(pixel, corners, normals, true)
  solve.value.forEach((w, i) => assert.ok(Math.abs(w - held[i]!) < 1e-5, `${solve.value} ${held}`))
  // Not the weights of a solve that holds nothing: the pixel is a case where the two differ.
  const free = solveOracle(pixel, corners, normals, false)
  assert.ok(
    free.some((w, i) => Math.abs(w - held[i]!) > 1e-2),
    `${free} ${held}`,
  )
})

/** The weights of the point where the ray from `o` through `at` meets the triangle `v`, by Cramer. */
function rayWeights(o: number[], at: number[], v: number[][]) {
  const d = add(at, o, -1),
    e1 = add(v[1]!, v[0]!, -1),
    e2 = add(v[2]!, v[0]!, -1)
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ]
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const p = cross(d, e2),
    s = add(o, v[0]!, -1),
    det = dot(e1, p)
  const y = dot(s, p) / det,
    z = dot(d, cross(s, e1)) / det
  return [1 - y - z, y, z]
}

test('a pixel is placed in the object’s space from its depth, the eye with it, and a matrix is inverted by its cofactors', () => {
  const world = new Mat([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1])
  // A reversed infinite perspective, and the inverse the host writes for it.
  const [f, aspect, near] = [1.7, 2, 0.1]
  const viewProj = new Mat([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, near, 0])
  const inverse = new Mat(Array.from(invertMatrix4(new Float64Array(16), viewProj.m)))
  const point = [1.5, 2.5, -4]
  const clip = [0, 1, 2, 3].map(
    (r) =>
      viewProj.m[r]! * point[0]! +
      viewProj.m[4 + r]! * point[1]! +
      viewProj.m[8 + r]! * point[2]! +
      viewProj.m[12 + r]!,
  )
  const [width, height] = [640, 320]
  const ndc = clip.slice(0, 3).map((x) => x / clip[3]!)
  const pixel = [((ndc[0]! + 1) / 2) * width, ((1 - ndc[1]!) / 2) * height]
  const half = new Mat3([
    [0.5, 0, 0],
    [0, 0.5, 0],
    [0, 0, 0.5],
  ])
  const px = prism.prismPixel(world, half, inverse, [0, 0, 0], [width, height], pixel, ndc[2])
  // The point in the object's own space, and the eye: the placement undone.
  px.at.forEach((x, i) => assert.ok(Math.abs(x - (point[i]! - [1, 2, 3][i]!) / 2) < 1e-5))
  px.eye.forEach((x, i) => assert.ok(Math.abs(x + [1, 2, 3][i]! / 2) < 1e-9))
  // A neighbour a pixel to the right lies right of it, at the same height, the same depth.
  assert.ok(px.atX[0]! > px.at[0]! && Math.abs(px.atX[1]! - px.at[1]!) < 1e-9)
  assert.ok(Math.abs(px.atY[0]! - px.at[0]!) < 1e-9 && px.atY[1]! < px.at[1]!)
  const m = new Mat3([
    [2, 0, 0],
    [1, 3, 0],
    [0, 0.5, 4],
  ])
  const product = [0, 1, 2].map((c) =>
    [0, 1, 2].map((r) =>
      m.columns.reduce((s, col, k) => s + col[r]! * prism.inverse3(m).columns[c]![k]!, 0),
    ),
  )
  product.forEach((col, c) =>
    col.forEach((x, r) => assert.ok(Math.abs(x - (r === c ? 1 : 0)) < 1e-12)),
  )
})
