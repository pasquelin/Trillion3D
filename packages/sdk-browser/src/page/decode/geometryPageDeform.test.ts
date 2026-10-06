// A skinned, morphed page (#357): the reference encoder of `packages/page-codec` writes it, the
// JavaScript and WebAssembly decoders read the same joints, weights and displacements, and a
// target record that names another word than its streams' refuses the page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeGeometryPage } from './geometryPage.ts'
import { decodeGeometryPageWasm, prepareSdkWasm } from './geometryPageWasm.ts'
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts'

const floats = (values: number[], itemSize: number) => ({
  itemSize,
  array: new Float32Array(values),
})

function bentPage() {
  return encodeGeometryPage(
    [0, 1, 2],
    {
      POSITION: floats([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
      JOINTS_0: floats([3, 4, 0, 0, 5, 3, 0, 0, 7, 3, 3, 3], 4),
      WEIGHTS_0: floats([0.5, 0.5, 0, 0, 0.7, 0.3, 0, 0, 0.25, 0.25, 0.25, 0.25], 4),
    },
    -8,
    undefined,
    [
      {
        POSITION: floats([0, 0.5, 0, 0, 0, 0, 0, 0, 1], 3),
        NORMAL: floats([0, 0, 0, 0, 0.25, 0, 0, 0, 0], 3),
      },
    ],
  )
}

test('joints, weights and target displacements decode from the page', () => {
  const page = decodeGeometryPage(bentPage().data)
  assert.equal(page.flags, 16 | 32)
  assert.equal(page.morphTargets, 1)
  assert.deepEqual(Object.keys(page.attributes), ['position', 'skinIndex', 'skinWeight', 'morph'])
  assert.deepEqual(Array.from(page.attributes.skinIndex.subarray(4, 8)), [5, 3, 0, 0])
  const weights = page.attributes.skinWeight
  assert.deepEqual(Array.from(weights.subarray(4, 8)), [0.7, 0.3, 0, 0].map(Math.fround))
  for (let v = 0; v < 3; v++)
    assert.ok(
      Math.abs(weights[v * 4] + weights[v * 4 + 1] + weights[v * 4 + 2] + weights[v * 4 + 3] - 1) <
        1e-6,
    )
  assert.deepEqual(Array.from(page.attributes.morph.subarray(0, 6)), [0, 0.5, 0, 0, 0, 0])
  assert.deepEqual(Array.from(page.attributes.morph.subarray(6, 12)), [0, 0, 0, 0, 0.25, 0])
})

test('a target record naming another word than its streams refuses the page', () => {
  const { data } = bentPage()
  new DataView(data.buffer).setUint32(25 * 4, 999, true)
  assert.throws(() => decodeGeometryPage(data), /GEOMETRY_PAGE_BOUNDS/)
})

test('the WebAssembly decoder reads the same deformation, bit for bit', async () => {
  assert.ok(await prepareSdkWasm(readFileSync(join(import.meta.dirname, 'pageCodec.wasm'))))
  const { data } = bentPage()
  const [wasm, js] = [await decodeGeometryPageWasm(data.slice()), decodeGeometryPage(data.slice())]
  assert.equal(wasm.morphTargets, 1)
  for (const name of Object.keys(js.attributes))
    assert.deepEqual(Array.from(wasm.attributes[name]), Array.from(js.attributes[name]), name)
})

test('joints near the top of the sixteen-bit range still encode a page the reader accepts', () => {
  const { data } = encodeGeometryPage(
    [0, 1, 2],
    {
      POSITION: floats([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
      JOINTS_0: floats(
        [65533, 65534, 65533, 65533, 65534, 65533, 65533, 65533, 65535, 65533, 65533, 65533],
        4,
      ),
      WEIGHTS_0: floats([0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0], 4),
    },
    -8,
  )
  const joints = decodeGeometryPage(data).attributes.skinIndex
  assert.deepEqual(Array.from(joints.subarray(0, 2)), [65533, 65534])
  assert.deepEqual(Array.from(joints.subarray(8, 10)), [65535, 65533])
})
