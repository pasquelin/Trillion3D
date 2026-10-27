// The ray tracing file as the compiler lays it out: a head, the records, the nodes, the triangles.
// One record of one node whose first child holds two triangles; the reader gives the words the GPU
// reads and refuses a file whose links or sizes do not close.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_VERSION,
} from '../contracts/rayTracingAbi.ts'
import { assertRayTracingSection, parseRayTracing } from './rayTracingFile.ts'
import { fileOf, twoRecords } from './rayTracingFile.fixture.ts'

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
          v.setUint32(RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_AT.flags * 4, 64, true),
        ),
      ),
    /flags 64/,
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
  const named = (mesh: number, primitive: number) => (view: DataView, at: number) => {
    view.setUint32(at + RAY_TRACING_RECORD_AT.mesh * 4, mesh, true)
    view.setUint32(at + RAY_TRACING_RECORD_AT.primitive * 4, primitive, true)
  }
  assert.throws(() => parseRayTracing(twoRecords(named(5, 3))), /5\/3 twice/)
  const file = parseRayTracing(twoRecords(named(6, 3)))
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
