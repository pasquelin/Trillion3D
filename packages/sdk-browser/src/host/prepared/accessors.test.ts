import test from 'node:test'
import assert from 'node:assert/strict'
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts'
import { preparedAccessors } from './accessors.ts'

// #457: a sparse accessor over an interleaved base copied the whole interleaved array and read it
// as if packed: the colour between two positions became a position.
test('a sparse accessor over an interleaved base substitutes into its own elements alone', async () => {
  // View 0: two vertices of six floats, a position then a colour; view 1: rank 1; view 2: (7, 8, 9).
  const floats = new Float32Array([1, 2, 3, 0.5, 0.5, 0.5, 4, 5, 6, 0.5, 0.5, 0.5])
  const binary = new Uint8Array(48 + 4 + 12)
  binary.set(new Uint8Array(floats.buffer), 0)
  binary[48] = 1
  binary.set(new Uint8Array(new Float32Array([7, 8, 9]).buffer), 52)
  const document = {
    views: [
      { offset: 0, length: 48, stride: 24 },
      { offset: 48, length: 1, stride: null },
      { offset: 52, length: 12, stride: null },
    ],
    accessors: [
      {
        view: 0,
        offset: 0,
        componentType: 5126,
        normalized: false,
        count: 2,
        type: 'VEC3',
        min: null,
        max: null,
        sparse: {
          count: 1,
          indices: { view: 1, offset: 0, componentType: 5121 },
          values: { view: 2, offset: 0 },
        },
      },
    ],
  } as unknown as TableDocument
  const position = preparedAccessors(document, async () => binary.buffer)(0)
  assert.equal(position.count, 2)
  await position._load()
  assert.deepEqual(Array.from(position.array), [1, 2, 3, 7, 8, 9])
})

// #846: the source document a class change cuts pages from is read view by view, never whole.
test('a ranged binary reads each view alone, and refuses one it answers short', async () => {
  const bytes = new Uint8Array(new Float32Array([9, 9, 9, 1, 2, 3]).buffer)
  const document = {
    views: [{ offset: 12, length: 12, stride: null }],
    accessors: [
      { view: 0, offset: 0, componentType: 5126, normalized: false, count: 1, type: 'VEC3' },
    ],
  } as unknown as TableDocument
  const asked: [number, number][] = []
  const range = async (offset: number, length: number) => {
    asked.push([offset, length])
    return bytes.slice(offset, offset + length).buffer
  }
  const position = preparedAccessors(document, { range })(0)
  await position._load()
  assert.deepEqual(Array.from(position.array), [1, 2, 3])
  assert.deepEqual(asked, [[12, 12]])
  const short = preparedAccessors(document, { range: async () => new ArrayBuffer(4) })(0)
  await assert.rejects(short._load(), /view 0 lies outside the binary/)
})
