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
  DISTANCE_FIELD_VERSION,
} from '../contracts/distanceFieldAbi.ts'
import { parseDistanceFields } from './distanceFieldFile.ts'

/** What a cell of an indirection table holds when its brick is not stored. */
const NO_DISTANCE_BRICK = 0xffffffff

/** A file of the records `(mesh or cell, flags, low corner)`, each of three mips of one empty
 *  brick cell, as the compiler lays it out (`distance_field/encode.rs`). */
function fileOf(records: readonly [number, number, number][]) {
  const head = DISTANCE_FIELD_HEAD_BYTES + records.length * DISTANCE_FIELD_MESH_BYTES
  const bytes = new Uint8Array(head + records.length * DISTANCE_FIELD_MIPS * 4)
  const view = new DataView(bytes.buffer)
  ;[DISTANCE_FIELD_MAGIC, DISTANCE_FIELD_VERSION, records.length, 0].forEach((word, k) =>
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
