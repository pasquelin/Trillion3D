// The fields' file names what each record stands for: a compiled mesh, or an HLOD cell's actors,
// and whether its triangles are mostly two-sided.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DISTANCE_FIELD_FLAG_HLOD_CELL,
  DISTANCE_FIELD_FLAG_TWO_SIDED,
  DISTANCE_FIELD_HEAD_BYTES,
  DISTANCE_FIELD_MAGIC,
  DISTANCE_FIELD_MESH_BYTES,
  DISTANCE_FIELD_MIPS,
  DISTANCE_FIELD_MIP_BYTES,
  DISTANCE_FIELD_PARTS_VERSION,
  DISTANCE_FIELD_VERSION,
} from '../contracts/distanceFieldAbi.ts'
import { parseDistanceFields } from './distanceFieldFile.ts'

/** What a cell of an indirection table holds when its brick is not stored. */
const NO_DISTANCE_BRICK = 0xffffffff

/** A file of version 2 of the records `(mesh or cell, flags, low corner)`, each of three mips of
 *  one empty brick cell, its mips' data after its records. */
function fileOf(records: readonly [number, number, number][]) {
  const head = DISTANCE_FIELD_HEAD_BYTES + records.length * DISTANCE_FIELD_MESH_BYTES
  const bytes = new Uint8Array(head + records.length * DISTANCE_FIELD_MIPS * 4)
  const view = new DataView(bytes.buffer)
  ;[DISTANCE_FIELD_MAGIC, DISTANCE_FIELD_PARTS_VERSION, records.length, 0].forEach((word, k) =>
    view.setUint32(k * 4, word, true),
  )
  records.forEach(([owner, flags, low], k) => {
    const at = DISTANCE_FIELD_HEAD_BYTES + k * DISTANCE_FIELD_MESH_BYTES
    view.setUint32(at, owner, true)
    view.setUint32(at + 4, flags, true)
    ;[low, low, low, low + 2, low + 2, low + 2].forEach((v, i) =>
      view.setFloat32(at + 8 + i * 4, v, true),
    )
    for (let m = 0; m < DISTANCE_FIELD_MIPS; m++) {
      const mip = at + 32 + m * DISTANCE_FIELD_MIP_BYTES
      ;[1, 1, 1].forEach((side, i) => view.setUint32(mip + i * 4, side, true))
      const data = head + (k * DISTANCE_FIELD_MIPS + m) * 4
      view.setUint32(mip + 44, 0, true)
      view.setUint32(mip + 48, data, true)
      view.setUint32(mip + 52, 4, true)
      view.setUint32(data, NO_DISTANCE_BRICK, true)
    }
  })
  return bytes
}

test('a record says whether it is a compiled mesh’s field or an HLOD cell’s, and whether it is mostly two-sided', () => {
  const fields = parseDistanceFields(
    fileOf([
      [4, 0, -1],
      [4, DISTANCE_FIELD_FLAG_HLOD_CELL, 10],
      [9, DISTANCE_FIELD_FLAG_TWO_SIDED, 0],
      [2, DISTANCE_FIELD_FLAG_HLOD_CELL | DISTANCE_FIELD_FLAG_TWO_SIDED, 5],
    ]),
  )
  assert.deepEqual(
    fields.map(({ mesh, hlodCell, mostlyTwoSided }) => [mesh, hlodCell, mostlyTwoSided]),
    [
      [4, false, false],
      [4, true, false],
      [9, false, true],
      [2, true, true],
    ],
  )
  // The box lies in the space the record stands for: an HLOD cell's in the world’s.
  assert.deepEqual(
    [fields[1].min, fields[1].max],
    [
      [10, 10, 10],
      [12, 12, 12],
    ],
  )
  assert.equal(fields[0].mips.length, DISTANCE_FIELD_MIPS)
})

test('a file read by parts holds no table or bricks: each mip reads its own bytes when asked', async () => {
  const file = fileOf([
    [4, 0, -1],
    [9, 0, 3],
  ])
  const head = DISTANCE_FIELD_HEAD_BYTES + 2 * DISTANCE_FIELD_MESH_BYTES
  const asked: number[][] = []
  const fields = parseDistanceFields(file.subarray(0, head), {
    fileBytes: file.byteLength,
    read: async (rank, offset, length) => {
      asked.push([rank, offset, length])
      return file.slice(offset, offset + length).buffer
    },
  })
  const mip = fields[1].mips[2]
  assert.equal(mip.indirection.length + mip.bricks.length, 0)
  const data = await mip.read!()
  assert.deepEqual([...data.indirection], [NO_DISTANCE_BRICK])
  assert.equal(data.bricks.length, 0)
  assert.deepEqual(asked, [[5, head + 5 * 4, 4]], 'the mip of rank 5, nothing else')
  assert.throws(
    () =>
      parseDistanceFields(file.subarray(0, head), {
        fileBytes: head,
        read: async () => file.slice().buffer,
      }),
    /past the end/,
  )
})

test('a file whose mips are objects of their own names each from its first byte, and reads it when asked', async () => {
  const flat = fileOf([[4, 0, -1]])
  const head = DISTANCE_FIELD_HEAD_BYTES + DISTANCE_FIELD_MESH_BYTES
  const file = flat.slice(0, head)
  const view = new DataView(file.buffer)
  view.setUint32(4, DISTANCE_FIELD_VERSION, true)
  const offsetAt = (m: number) => DISTANCE_FIELD_HEAD_BYTES + 32 + m * DISTANCE_FIELD_MIP_BYTES + 48
  for (let m = 0; m < DISTANCE_FIELD_MIPS; m++) view.setUint32(offsetAt(m), 0, true)
  const asked: number[] = []
  const object = Uint32Array.of(NO_DISTANCE_BRICK).buffer
  const fields = parseDistanceFields(file, {
    read: async (rank) => (asked.push(rank), object.slice(0)),
  })
  const data = await fields[0].mips[1].read!()
  assert.deepEqual([...data.indirection], [NO_DISTANCE_BRICK])
  assert.deepEqual(asked, [1], 'the mip of rank 1, nothing else')
  // A record naming its mip past the first byte of its object is refused.
  view.setUint32(offsetAt(2), 4, true)
  assert.throws(
    () => parseDistanceFields(file, { read: async () => object }),
    /past the end of its data/,
  )
})

test('a file of version 3 is read by its objects alone, one of version 2 never so', () => {
  const head = DISTANCE_FIELD_HEAD_BYTES + DISTANCE_FIELD_MESH_BYTES
  const v2 = fileOf([[4, 0, -1]])
  const v3 = v2.slice(0, head)
  new DataView(v3.buffer).setUint32(4, DISTANCE_FIELD_VERSION, true)
  const read = async () => new ArrayBuffer(4)
  assert.throws(() => parseDistanceFields(v3), /version 3 read whole or by ranges/)
  assert.throws(() => parseDistanceFields(v3, { fileBytes: head, read }), /version 3 read whole/)
  assert.throws(() => parseDistanceFields(v2, { read }), /version 2 read by objects/)
})
