// The ray tracing file as the compiler lays it out: a head, the records, the nodes, the triangles.
// One record of one node whose first child holds two triangles; the reader gives the words the GPU
// reads and refuses a file whose links or sizes do not close.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_LEAF_COUNT_SHIFT,
  RAY_TRACING_MAGIC,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_VERSION,
} from '../contracts/rayTracingAbi.ts'
import { assertRayTracingSection, parseRayTracing } from './rayTracingFile.ts'

/** A file of the one record of primitive `primitive` of mesh `mesh`, one node (a leaf child of
 *  `triangles` triangles at its slot 0) and two triangles, `mutate` altering the bytes. */
function fileOf(
  options: { mesh?: number; primitive?: number; triangles?: number } = {},
  mutate: (view: DataView) => void = () => {},
) {
  const { mesh = 5, primitive = 3, triangles = 2 } = options
  const nodesAt = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_BYTES
  const trianglesAt = nodesAt + RAY_TRACING_NODE_BYTES
  const bytes = new Uint8Array(trianglesAt + 2 * RAY_TRACING_TRIANGLE_BYTES)
  const view = new DataView(bytes.buffer)
  ;[RAY_TRACING_MAGIC, RAY_TRACING_VERSION, 1, 1, 2].forEach((word, k) =>
    view.setUint32(k * 4, word, true),
  )
  const record = RAY_TRACING_HEAD_BYTES
  const R = RAY_TRACING_RECORD_AT
  view.setUint32(record + R.mesh * 4, mesh, true)
  view.setUint32(record + R.primitive * 4, primitive, true)
  view.setUint32(record + R.flags * 4, RAY_TRACING_FLAG_TWO_SIDED, true)
  view.setFloat32(record + R.error * 4, 0.25, true)
  view.setUint32(record + R.nodeCount * 4, 1, true)
  view.setUint32(record + R.triangleCount * 4, 2, true)
  ;[-1, -2, -3, 1, 2, 3].forEach((v, k) => view.setFloat32(record + (R.boxMin + k) * 4, v, true))
  // The node: its corner, an exponent of 0 a side and no child that is a node, then the metas:
  // slot 0 a leaf of `triangles` triangles at offset 0, the others empty.
  // The corner is the node's words 0 to 2 and the metas start at its word 6.
  ;[-1, -2, -3].forEach((v, k) => view.setFloat32(nodesAt + k * 4, v, true))
  view.setUint8(nodesAt + 6 * 4, triangles << RAY_TRACING_LEAF_COUNT_SHIFT)
  // The triangles: the corners, then the cluster and the rank in it.
  for (let t = 0; t < 2; t++) {
    const at = trianglesAt + t * RAY_TRACING_TRIANGLE_BYTES
    ;[0, 0, 0, 1, 0, 0, 0, 1, t].forEach((v, k) => view.setFloat32(at + k * 4, v, true))
    view.setUint32(at + 36, 7 + t, true)
    view.setUint32(at + 40, t, true)
  }
  mutate(view)
  return bytes
}

test('the file is read as the records, nodes and triangles the GPU reads, the mesh and primitive naming its record', () => {
  const file = parseRayTracing(fileOf())
  assert.equal(file.records.length * 4, RAY_TRACING_RECORD_BYTES)
  assert.equal(file.nodes.length * 4, RAY_TRACING_NODE_BYTES)
  assert.equal(file.triangles.length * 4, 2 * RAY_TRACING_TRIANGLE_BYTES)
  assert.deepEqual(
    [...file.byPrimitive].map(([mesh, held]) => [mesh, [...held]]),
    [[5, [[3, 0]]]],
  )
  const R = RAY_TRACING_RECORD_AT
  assert.deepEqual([file.records[R.mesh], file.records[R.primitive]], [5, 3])
  assert.equal(file.records[R.flags], RAY_TRACING_FLAG_TWO_SIDED)
  assert.equal(file.records[R.triangleCount], 2)
  // The triangles are the file's words: the second one's last float, its cluster and its rank.
  const floats = new Float32Array(file.triangles.buffer, file.triangles.byteOffset, 24)
  assert.equal(floats[12 + 8], 1)
  assert.deepEqual([file.triangles[12 + 9], file.triangles[12 + 10]], [8, 1])
})

test('a file at an odd byte of its buffer is read as one at an even byte', () => {
  const bytes = fileOf()
  const shifted = new Uint8Array(bytes.length + 1)
  shifted.set(bytes, 1)
  const file = parseRayTracing(shifted.subarray(1))
  assert.deepEqual([...file.records], [...parseRayTracing(bytes).records])
  assert.deepEqual([...file.triangles], [...parseRayTracing(bytes).triangles])
})

test('a file whose head, sizes or records do not close is refused', () => {
  const bytes = fileOf()
  assert.throws(() => parseRayTracing(bytes.subarray(0, 20)), /shorter/)
  assert.throws(() => parseRayTracing(bytes.subarray(0, bytes.length - 4)), /not its head/)
  assert.throws(() => parseRayTracing(fileOf({}, (v) => v.setUint32(0, 1, true))), /not a ray/)
  assert.throws(() => parseRayTracing(fileOf({}, (v) => v.setUint32(4, 99, true))), {
    code: 'UNSUPPORTED_FORMAT',
  })
  // Records out of the order of the tables, a flag no format names, a box turned over.
  assert.throws(
    () =>
      parseRayTracing(
        fileOf({}, (v) =>
          v.setUint32(RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.firstNode * 4, 1, true),
        ),
      ),
    /nodes out of the order/,
  )
  assert.throws(
    () =>
      parseRayTracing(
        fileOf({}, (v) =>
          v.setUint32(RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.triangleCount * 4, 3, true),
        ),
      ),
    /triangles out of the order/,
  )
  assert.throws(
    () =>
      parseRayTracing(
        fileOf({}, (v) =>
          v.setUint32(RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.flags * 4, 8, true),
        ),
      ),
    /flags 8/,
  )
  assert.throws(
    () =>
      parseRayTracing(
        fileOf({}, (v) =>
          v.setFloat32(RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.boxMin * 4, 9, true),
        ),
      ),
    /not a box/,
  )
})

test('a primitive named twice is refused, in two meshes it is two', () => {
  const twice = (second: { mesh: number; primitive: number }) => {
    const one = fileOf()
    const bytes = new Uint8Array(one.length + RAY_TRACING_RECORD_BYTES)
    const record = RAY_TRACING_HEAD_BYTES
    const nodesAt = record + RAY_TRACING_RECORD_BYTES
    // The head, the first record, a second one that holds no node and no triangle, then the rest.
    bytes.set(one.subarray(0, nodesAt))
    bytes.set(one.subarray(nodesAt), nodesAt + RAY_TRACING_RECORD_BYTES)
    const view = new DataView(bytes.buffer)
    view.setUint32(8, 2, true)
    bytes.set(one.subarray(record, nodesAt), nodesAt)
    const R = RAY_TRACING_RECORD_AT
    view.setUint32(nodesAt + R.mesh * 4, second.mesh, true)
    view.setUint32(nodesAt + R.primitive * 4, second.primitive, true)
    view.setUint32(nodesAt + R.firstNode * 4, 1, true)
    view.setUint32(nodesAt + R.nodeCount * 4, 0, true)
    view.setUint32(nodesAt + R.firstTriangle * 4, 2, true)
    view.setUint32(nodesAt + R.triangleCount * 4, 0, true)
    return bytes
  }
  assert.throws(() => parseRayTracing(twice({ mesh: 5, primitive: 3 })), /5\/3 twice/)
  const file = parseRayTracing(twice({ mesh: 6, primitive: 3 }))
  assert.deepEqual([file.byPrimitive.get(5)?.get(3), file.byPrimitive.get(6)?.get(3)], [0, 1])
})

test('the manifest section is absent, or of this version and naming its file', () => {
  assert.equal(assertRayTracingSection(undefined), undefined)
  const section = { version: RAY_TRACING_VERSION, file: 'rayTracing.bin', bytes: 10 }
  assert.deepEqual(assertRayTracingSection(section), section)
  assert.throws(() => assertRayTracingSection({ ...section, version: 0 }), {
    code: 'UNSUPPORTED_FORMAT',
  })
  assert.throws(() => assertRayTracingSection({ version: RAY_TRACING_VERSION }), {
    code: 'INVALID_CACHE',
  })
})
