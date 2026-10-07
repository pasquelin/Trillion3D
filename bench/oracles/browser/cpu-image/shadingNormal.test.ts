// `shadingNormal.ts` is written on the core's flat vectors (`packages/sdk-core/src/math/primitives/vector.ts`),
// without the host library. Oracle: `bench/oracles/browser/shading-normals.ts`, the file written on the host library, copied
// as-is with its `Vector3`/`Matrix3`. The `shading-normals.perf.ts` bench replays 42 000 frames;
// this test hard-codes a handful, two of which show the operation order:
//   — a pose whose first row is (1e16, −1e16, 3), crossed by all-ones tangents:
//     the sum is 3 in the reference order, 4 if an add reassociates;
//   — a pose whose normal matrix is exactly [[1, 1, 1], [0, 1, 0], [0, 0, 1]],
//     combined with vertex normals (1e16, 1, 1).
import type { Texture } from '../../../../packages/sdk-core/src/index.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { shadingNormal } from './shadingNormal.ts'
import { referenceShadingNormal } from '../shading-normals.ts'
import type { VisMaterial, VisPage } from '../../../../packages/sdk-browser/src/visibility/types.ts'
import { litMaterial } from '../../../../packages/sdk-browser/src/visibility/shader/material.fixture.ts'

const attribute = (values: number[], itemSize: number) =>
  new G.BufferAttribute(Float32Array.from(values), itemSize)

const material = (overrides: Partial<VisMaterial> = {}) =>
  litMaterial({ baseColor: [0.8, 0.6, 0.4], metalness: 0.3, roughness: 0.4, ...overrides })

/** Minimal 2×2 normal map: enough to exercise `sampleLinear` without a spare allocation. */
function normalMap2x2(): Texture {
  const data = Uint8Array.from([10, 200, 250, 255, 5, 90, 200, 255, 250, 5, 5, 255, 1, 1, 1, 255])
  return {
    image: { data, width: 2, height: 2 },
    wrapS: 'repeat',
    wrapT: 'clamp',
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  } as unknown as Texture
}

const TRI = {
  a: { x: 0, y: 0, z: 0, invW: 1, worldX: 0, worldY: 0, worldZ: 0 },
  b: { x: 0, y: 0, z: 0, invW: 1, worldX: 1, worldY: 0, worldZ: 0 },
  c: { x: 0, y: 0, z: 0, invW: 1, worldX: 0, worldY: 1, worldZ: 0 },
  triangleIndex: 0,
  i0: 0,
  i1: 1,
  i2: 2,
}
/** The triangle of `page`, placed by the world its test built it with. */
const triOf = (page: VisPage) => ({
  ...TRI,
  page,
  world: (page as unknown as { matrix: G.Matrix4 }).matrix,
})
const BARY = { w0: 0.5, w1: 0.3, w2: 0.2 }
const UV: [number, number] = [0.3, 0.6]

/** Compares `shadingNormal` (optimised) to `referenceShadingNormal` (oracle) on the same frame,
 *  component by component, `Object.is` — signed zero and NaN count as the reference. */
function assertSameNormal(page: VisPage, mat: VisMaterial, screenFace: number, label: string) {
  const tri = triOf(page)
  const optimised = shadingNormal(page, tri, BARY, UV, mat, screenFace)
  const reference = referenceShadingNormal(page, tri, BARY, UV, mat, screenFace)
  const expected = [reference.x, reference.y, reference.z]
  for (let c = 0; c < 3; c++)
    assert.ok(
      Object.is(optimised[c], expected[c]),
      `${label}, component ${c}: ${optimised[c]} != ${expected[c]}`,
    )
}

test('pose whose row (1e16, −1e16, 3) is crossed by an all-ones tangent', () => {
  const matrix = new G.Matrix4().fromArray([1e16, 1, 1, 0, -1e16, 1, 1, 0, 3, 1, 1, 0, 0, 0, 0, 1])
  const normal = attribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
  const tangent = attribute([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 4)
  const uv = attribute([0, 0, 1, 0, 0, 1], 2)
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { normal, tangent, uv },
    matrix,
  } as unknown as VisPage
  const mat = material({ normalMap: normalMap2x2() })
  for (const screenFace of [1, -1])
    assertSameNormal(page, mat, screenFace, `1e16/-1e16/3, screenFace ${screenFace}`)
})

test('pose whose normal matrix is [[1,1,1],[0,1,0],[0,0,1]], normals (1e16,1,1)', () => {
  // 3×3 block such that transpose(inverse(block)) === [[1,1,1],[0,1,0],[0,0,1]]: checked
  // directly against `normalMatrix3` before writing this test.
  const matrix = new G.Matrix4().fromArray([1, -1, -1, 0, -0, 1, -0, 0, 0, -0, 1, 0, 5, -3, 2, 1])
  const normal = attribute([1e16, 1, 1, 1e16, 1, 1, 1e16, 1, 1], 3)
  const uv = attribute([0, 0, 1, 0, 0, 1], 2)
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { normal, uv },
    matrix,
  } as unknown as VisPage
  for (const doubleSided of [false, true])
    for (const withMap of [false, true]) {
      const mat = material({ doubleSided, normalMap: withMap ? normalMap2x2() : undefined })
      for (const screenFace of [1, -1])
        assertSameNormal(page, mat, screenFace, `ds${doubleSided} map${withMap} sf${screenFace}`)
    }
})

test('negative scale and shear, with no vertex normal or map: the geometric normal alone', () => {
  const matrix = new G.Matrix4().fromArray([2, 0.5, 0, 0, 0, -3, 0, 0, 0.25, 0, 0.5, 0, 1, 2, 3, 1])
  const uv = attribute([0, 0, 1, 0, 0, 1], 2)
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { uv },
    matrix,
  } as unknown as VisPage
  for (const backSide of [false, true])
    for (const screenFace of [1, -1])
      assertSameNormal(page, material({ backSide }), screenFace, `bs${backSide} sf${screenFace}`)
})

// The three normal-map components (`mapN`) do not go through a
// literal array, which would be allocated at every shaded pixel of a surface that carries a map. `shadingNormal`
// always returns `frameOut`, the same module buffer (documented at the top of the file: “no
// allocation, [...] returned in one of them”); checking that on many chained calls, each with a
// normal map and different frames, is the same method as the “allocation” test of
// `packages/sdk-core/src/math/transform-tree/update.test.ts`: the identity of the returned buffer, not an allocation
// count, attests that no buffer is built along the way.
test('normal-mapped surface: a thousand shaded pixels in a row always return the same buffer', () => {
  const matrix = new G.Matrix4().fromArray([
    1, 0.2, 0, 0, -0.1, 1, 0.3, 0, 0, -0.2, 1, 0, 1, 2, 3, 1,
  ])
  const normal = attribute([0, 0, 1, 0.1, 0, 1, 0, 0.1, 1], 3)
  const tangent = attribute([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1], 4)
  const uv = attribute([0, 0, 1, 0, 0, 1], 2)
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { normal, tangent, uv },
    matrix,
  } as unknown as VisPage
  const mat = material({ normalMap: normalMap2x2(), normalScale: 1.3, normalScaleY: 0.7 })
  const tri = triOf(page)
  let firstBuffer: Float64Array | undefined
  for (let i = 0; i < 1000; i++) {
    const bary = { w0: (i % 7) / 7, w1: ((i + 1) % 5) / 5, w2: ((i + 2) % 3) / 3 }
    const uvPixel: [number, number] = [(i % 11) / 11, (i % 13) / 13]
    const rendered = shadingNormal(page, tri, bary, uvPixel, mat, i % 2 === 0 ? 1 : -1)
    if (i === 0) firstBuffer = rendered
    assert.equal(rendered, firstBuffer, `pixel ${i}: a new buffer was built`)
  }
})

test('NaN and infinities in barycentric weights and tangents, map with no vertex normal', () => {
  const matrix = new G.Matrix4()
  const uv = attribute([0, 0, 1, 0, 0.5, 1], 2)
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: { uv },
    matrix,
  } as unknown as VisPage
  const mat = material({ normalMap: normalMap2x2() })
  const baryHostile = { w0: NaN, w1: Infinity, w2: -Infinity }
  const tri = triOf(page)
  const optimised = shadingNormal(page, tri, baryHostile, UV, mat, 1)
  const reference = referenceShadingNormal(page, tri, baryHostile, UV, mat, 1)
  const expected = [reference.x, reference.y, reference.z]
  for (let c = 0; c < 3; c++)
    assert.ok(Object.is(optimised[c], expected[c]), `hostile bary, component ${c}`)
})
