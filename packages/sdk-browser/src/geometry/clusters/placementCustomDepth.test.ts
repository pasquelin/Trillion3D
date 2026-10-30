import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementInfo, type PlacementInfoSource } from './placementInfo.ts'
import { objectOffsetRow } from '../rows/page/offsetRow.ts'
import {
  PLACEMENT_INFO,
  PLACEMENT_INFO_BYTES,
  PLACEMENT_INFO_WORDS,
} from '../dag/info/placementInfoLayout.ts'
import { customDepthWord } from '../../../../sdk-core/src/contracts/customDepthAbi.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'

/** The custom depth words of the records written for `rows`, by rank. */
function customDepthWords(rows: (ReturnType<typeof objectOffsetRow> | undefined)[]) {
  const info = createPlacementInfo()
  const source: PlacementInfoSource = {
    deformWord: () => 0,
    offsets: (rank) => rows[rank],
    hlod: () => 0,
    infoShift: () => 0,
    pageBase: () => 0,
    outputs: () => undefined,
    pageCount: () => 0,
  }
  info.bind(source)
  info.markAll(rows.length)
  const written: number[] = []
  const device = {
    queue: {
      writeBuffer: (_: GPUBuffer, at: number, data: Uint32Array) => {
        for (let k = 0; k * PLACEMENT_INFO_WORDS < data.length; k++)
          written[at / PLACEMENT_INFO_BYTES + k] =
            data[k * PLACEMENT_INFO_WORDS + PLACEMENT_INFO.at.customDepth]
      },
    },
  } as unknown as GPUDevice
  info.flush(
    device,
    { size: rows.length * PLACEMENT_INFO_BYTES } as GPUBuffer,
    { size: 0 } as GPUBuffer,
    true,
  )
  return written
}

test('a placement carries the custom depth word of its object, zero for an object that does not ask', () => {
  const plain = object.mesh(geometry.box(1, 1, 1))
  const outlined = object.mesh(geometry.box(1, 1, 1))
  outlined.renderCustomDepth = true
  outlined.customDepthStencilValue = 9
  outlined.customDepthStencilWriteMask = 2
  const rowOf = (node: typeof plain) => objectOffsetRow(node, [0, 0, 0])
  assert.deepEqual(customDepthWords([rowOf(plain), rowOf(outlined), undefined]), [
    0,
    customDepthWord(true, 9, 2),
    0,
  ])
})
