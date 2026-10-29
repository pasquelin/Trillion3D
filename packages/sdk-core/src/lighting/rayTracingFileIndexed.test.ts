// The ray tracing file as the compiler writes it: each corner once among the vertices, each triangle naming its
// corners by rank. The reader lays its triangles out as the flat format holds them, the same words, and refuses a
// triangle naming a vertex the file does not have; it still reads the flat format.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_FLAT_VERSION,
  RAY_TRACING_HEAD_BYTES,
  RAY_TRACING_INDEXED_TRIANGLE_BYTES,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_VERSION,
  RAY_TRACING_VERTEX_BYTES,
} from '../contracts/rayTracingAbi.ts'
import { assertRayTracingSection, parseRayTracing } from './rayTracingFile.ts'
import { fileOf, indexedOf, twoRecords } from './rayTracingFile.fixture.ts'

/** What the reader gives of a file, as plain values to compare. */
const read = (bytes: Uint8Array) => {
  const { records, nodes, triangles, byPrimitive, world, actorCells } = parseRayTracing(bytes)
  const lists = [records, nodes, triangles].map((words) => [...words])
  return {
    lists,
    byPrimitive: [...byPrimitive].map(([m, held]) => [m, [...held]]),
    world,
    actorCells,
  }
}

test('a file with vertices is read as the same words as the flat file it shares the corners of', () => {
  for (const flat of [
    fileOf(),
    fileOf({ triangles: 1 }),
    twoRecords((view, at) => view.setUint32(at + RAY_TRACING_RECORD_AT.mesh * 4, 6, true)),
  ])
    assert.deepEqual(read(indexedOf(flat)), read(flat))
  // The two triangles share their first two corners: four vertices, each held once.
  const bytes = indexedOf(fileOf())
  const view = new DataView(bytes.buffer)
  assert.deepEqual([view.getUint32(4, true), view.getUint32(20, true)], [RAY_TRACING_VERSION, 4])
  const verticesAt = RAY_TRACING_HEAD_BYTES + RAY_TRACING_RECORD_BYTES + RAY_TRACING_NODE_BYTES
  assert.equal(
    bytes.length,
    verticesAt + 4 * RAY_TRACING_VERTEX_BYTES + 2 * RAY_TRACING_INDEXED_TRIANGLE_BYTES,
  )
})

test('a corner before the first vertex or past the last, vertices no triangle names, or a file of another size are refused', () => {
  // The second triangle's third corner is the fourth vertex, written zero: nine back is before the first.
  const before = indexedOf(fileOf())
  new DataView(before.buffer).setUint32(
    before.length - RAY_TRACING_INDEXED_TRIANGLE_BYTES + 8,
    9,
    true,
  )
  assert.throws(() => parseRayTracing(before), {
    code: 'INVALID_CACHE',
    message: /names a vertex 9 before the next, 3/,
  })
  // One vertex more than the triangles name, the head counting it.
  const flat = indexedOf(fileOf())
  const trianglesAt = flat.length - 2 * RAY_TRACING_INDEXED_TRIANGLE_BYTES
  const extra = new Uint8Array(flat.length + RAY_TRACING_VERTEX_BYTES)
  extra.set(flat.subarray(0, trianglesAt))
  extra.set(flat.subarray(trianglesAt), trianglesAt + RAY_TRACING_VERTEX_BYTES)
  new DataView(extra.buffer).setUint32(20, 5, true)
  assert.throws(() => parseRayTracing(extra), {
    code: 'INVALID_CACHE',
    message: /1 vertices that no triangle names/,
  })
  // The second triangle names one vertex fewer than the head counts: its new corner is past the last.
  const past = indexedOf(fileOf({ triangles: 2 }))
  const shorter = new Uint8Array(past.length - RAY_TRACING_VERTEX_BYTES)
  const at = past.length - 2 * RAY_TRACING_INDEXED_TRIANGLE_BYTES
  shorter.set(past.subarray(0, at - RAY_TRACING_VERTEX_BYTES))
  shorter.set(past.subarray(at), at - RAY_TRACING_VERTEX_BYTES)
  new DataView(shorter.buffer).setUint32(20, 3, true)
  assert.throws(() => parseRayTracing(shorter), {
    code: 'INVALID_CACHE',
    message: /names the vertex 3 of 3/,
  })
  const longer = new Uint8Array(indexedOf(fileOf()).length + 4)
  longer.set(indexedOf(fileOf()))
  assert.throws(() => parseRayTracing(longer), { code: 'INVALID_CACHE' })
})

test('a file of another version than its manifest section names, or a section of a version not whole, is refused', () => {
  assert.equal(
    parseRayTracing(indexedOf(fileOf()), RAY_TRACING_VERSION).records.length * 4,
    RAY_TRACING_RECORD_BYTES,
  )
  assert.throws(() => parseRayTracing(fileOf(), RAY_TRACING_VERSION), {
    code: 'INVALID_CACHE',
    message: /a file of version 3, its manifest's section of 4/,
  })
  assert.throws(
    () => assertRayTracingSection({ version: 3.5, file: 'rayTracing.bin', bytes: 10 }),
    {
      code: 'UNSUPPORTED_FORMAT',
    },
  )
})

test('the manifest section and the file are read in the flat format and in the one with vertices, no other', () => {
  for (const version of [RAY_TRACING_FLAT_VERSION, RAY_TRACING_VERSION]) {
    const section = { version, file: 'rayTracing.bin', bytes: 10 }
    assert.deepEqual(assertRayTracingSection(section), section)
  }
  for (const version of [RAY_TRACING_FLAT_VERSION - 1, RAY_TRACING_VERSION + 1]) {
    assert.throws(() => assertRayTracingSection({ version, file: 'rayTracing.bin', bytes: 10 }), {
      code: 'UNSUPPORTED_FORMAT',
    })
    const bytes = indexedOf(fileOf())
    new DataView(bytes.buffer).setUint32(4, version, true)
    assert.throws(() => parseRayTracing(bytes), { code: 'UNSUPPORTED_FORMAT' })
  }
})
