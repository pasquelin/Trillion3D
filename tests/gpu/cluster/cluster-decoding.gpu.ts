// The WGSL decode of a quantized cluster page, run through the accessors the engine's raster,
// shadow and resolve stages call — a page-table row over a pool slot —, against the JavaScript
// decoder of the same bytes, a flat-shaded page among them (its positions stored once and read
// through each vertex's link): positions, texture coordinates and colours bit for bit — the
// format's arithmetic is one multiply and one add, both correctly rounded in WGSL —, normals within
// what WGSL grants `normalize`, indices exact, and the cotangent frame every lighting pass bends its
// normal map with, against the same formula in JavaScript.
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeGeometryPage } from '../../../packages/sdk-browser/src/page/decode/geometryPage.ts'
import { encodeGeometryPage } from '../../../packages/page-codec/src/geometryPage.ts'
import type {
  PageAttribute,
  PageAttributes,
} from '../../../packages/page-codec/src/pageAttributes.ts'
import { ringMesh } from '../../../bench/perf/browser/support/pagesWasm.ts'
import { decodeOnGpu, TRIANGLE_WORDS, VERTEX_WORDS } from './decodingKernel.ts'

/** A ring page of `triangles` at `exponent`, flat-shaded or not, with the JavaScript decode. */
function page(triangles: number, exponent: number, flat = false) {
  const ring = ringMesh(triangles, exponent)
  const { encoded, indices } = flat ? flatShaded(ring, exponent) : ring
  const decoded = decodeGeometryPage(encoded.data)
  return {
    bytes: encoded.data,
    vertexCount: decoded.vertexCount,
    indexCount: indices.length,
    decoded,
  }
}

/** The ring flat-shaded: every triangle on three vertices of its own under its first corner's
 *  normal, so the page stores each position once and links its vertices to them (#960). */
function flatShaded(
  { indices, attributes }: { indices: number[]; attributes: PageAttributes },
  exponent: number,
) {
  const corners = indices.map((_, k) => k)
  const flat = Object.fromEntries(
    (Object.entries(attributes) as [string, PageAttribute][]).map(([name, { itemSize, array }]) => {
      const source = (k: number) => (name === 'NORMAL' ? indices[k - (k % 3)] : indices[k])
      const values = corners.flatMap((k) =>
        Array.from(array).slice(source(k) * itemSize, (source(k) + 1) * itemSize),
      )
      return [name, { itemSize, array: new Float32Array(values) }]
    }),
  )
  const encoded = encodeGeometryPage(corners, flat, exponent),
    words = new DataView(encoded.data.buffer, encoded.data.byteOffset)
  assert.ok(words.getUint32(88, true) < words.getUint32(8, true), 'positions stored once')
  return { encoded, indices: corners }
}

const cross = (a: readonly number[], b: readonly number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const minus = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - b[i])

/** A triangle's frame as the shader computes it: `p·du1 + q·du2`, scaled by the longer unit. */
function cotangentFrame(N: number[], e1: number[], e2: number[], duv1: number[], duv2: number[]) {
  const p = cross(e2, N),
    q = cross(N, e1)
  const T = p.map((v, i) => v * duv1[0] + q[i] * duv2[0]),
    B = p.map((v, i) => v * duv1[1] + q[i] * duv2[1])
  const scale = 1 / Math.sqrt(Math.max(Math.hypot(...T) ** 2, Math.hypot(...B) ** 2, 1e-20))
  return [...T.map((v) => v * scale), ...B.map((v) => v * scale)]
}

test('the WGSL decode reads every page as the JavaScript decoder does', async () => {
  const pages = [page(126, -12), page(5, -3), page(40, -20), page(40, -12, true)]
  const { adapter, words, errors } = await decodeOnGpu(pages)
  assert.deepEqual(errors, [])
  let worstNormal = 0,
    worstFrame = 0
  for (const [k, { decoded, vertexCount, indexCount }] of pages.entries()) {
    const ints = words[k],
      values = new Float32Array(ints.buffer, ints.byteOffset, ints.length)
    const { position, normal, uv, uv2, color } = decoded.attributes
    /** `count` exact floats of vertex `i` at `offset` in the output, against `array`. */
    const exact = (
      name: string,
      array: ArrayLike<number>,
      i: number,
      offset: number,
      count: number,
    ) => {
      for (let c = 0; c < count; c++)
        assert.ok(
          Object.is(values[i * VERTEX_WORDS + offset + c], array[i * count + c]),
          `page ${k} ${name} ${i}.${c}`,
        )
    }
    for (let i = 0; i < vertexCount; i++) {
      exact('position', position, i, 0, 3)
      exact('uv', uv, i, 6, 2)
      exact('uv2', uv2, i, 8, 2)
      exact('colour', color, i, 10, 4)
      for (let c = 0; c < 3; c++)
        worstNormal = Math.max(
          worstNormal,
          Math.abs(values[i * VERTEX_WORDS + 3 + c] - normal[i * 3 + c]),
        )
    }
    const at = (array: Float32Array, i: number, n: number) =>
      Array.from(array.subarray(i * n, i * n + n))
    for (let t = 0; t < indexCount / 3; t++) {
      const base = vertexCount * VERTEX_WORDS + t * TRIANGLE_WORDS
      const corners = Array.from(ints.subarray(base, base + 3))
      assert.deepEqual(
        corners,
        Array.from(decoded.indices.subarray(t * 3, t * 3 + 3)),
        `page ${k} triangle ${t}`,
      )
      const [a, b, c] = corners,
        p0 = at(position, a, 3),
        t0 = at(uv, a, 2)
      const expected = cotangentFrame(
        at(normal, a, 3),
        minus(at(position, b, 3), p0),
        minus(at(position, c, 3), p0),
        minus(at(uv, b, 2), t0),
        minus(at(uv, c, 2), t0),
      )
      for (let j = 0; j < 6; j++)
        worstFrame = Math.max(worstFrame, Math.abs(values[base + 3 + j] - expected[j]))
    }
  }
  console.log(JSON.stringify({ adapter, pages: pages.length, worstNormal, worstFrame }))
  // `normalize` and the frame's `inverseSqrt` are granted a few ulps by WGSL: the format does not
  // promise bit-exact normals.
  assert.ok(worstNormal < 1e-6, `a normal off by ${worstNormal}`)
  assert.ok(worstFrame < 1e-5, `a frame off by ${worstFrame}`)
})
