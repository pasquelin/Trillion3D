// The placements whose link moved reach the residency mirror whole and once: more moves than the
// list first holds grow it, the mirror reads the grown list at the residency, and the cut that
// follows hands it no more — the moves after it, it does. On a generated world of 300 placements,
// 120 of them placed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLinkFollower } from './worldFollow.ts'
import type { PackedDag } from './types.ts'

test('every moved link reaches the mirror, past the list’s first room', () => {
  const told: number[][] = []
  const world = {
    root: -1,
    links: new Uint32Array(300).fill(0xffffffff),
    linkBase: 0,
    linkOf: (object: number) => object,
    linksMoved: (placements: Int32Array, count: number) =>
      void told.push(Array.from(placements.subarray(0, count))),
  }
  const device = { queue: { writeBuffer: () => {} } } as unknown as GPUDevice
  const coldParts = { buffers: [{} as GPUBuffer], bytes: 4 * 300 }
  const packed = { world } as unknown as PackedDag
  const links = createLinkFollower(
    { device, packed, coldParts },
    { updateResidency: (rows) => links.residency(rows), linkMoved: () => {} },
  )!
  const view = {},
    camera = { view: new Float64Array(16), cameraWorld: [0, 0, 0] } as never
  const placed = Array.from({ length: 120 }, (_, k) => 2 * k + 7)
  for (const w of placed) links.place(w, w)
  links.residency(new Uint32Array(1))
  assert.deepEqual(told.at(-1), placed, 'at the residency')
  links.sync(camera, view)
  assert.equal(told.length, 1, 'handed once: the cut that follows hands it no more')
  // Moves after the residency reach the mirror at the cut.
  links.place(8, 8)
  links.sync(camera, view)
  assert.deepEqual(told.at(-1), [8], 'at the cut')
})
