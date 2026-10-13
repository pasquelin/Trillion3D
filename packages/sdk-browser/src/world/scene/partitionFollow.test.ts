// The partitions a session follows are not those it was opened with alone: one followed joins the
// frames' step, one left gives its rows and holds back (`partitionFrame.ts`, `PartitionCells.close`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { hostFramingCamera } from '../../host/scene/graphObjects.ts'
import { createPartitionFrame } from './partitionFrame.ts'
import { budget, packsNoWorld, recording, streamer } from './partitionFrame.fixture.ts'

test('a step over no partition asks nothing; a partition followed is stepped, one left is closed and stepped no more', () => {
  const { cells, seen, closed } = recording()
  const { port, asked } = streamer()
  const step = createPartitionFrame({
    partitions: [],
    streamer: port,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    engine: packsNoWorld(),
    budget,
  })
  step()
  assert.deepEqual([seen.length, asked.length], [0, 0], 'nothing followed, nothing asked')
  step.follow([cells, cells])
  step()
  assert.equal(seen.length, 1, 'followed once however often it is told')
  step.leave([cells])
  assert.deepEqual(closed, [cells], 'it gives its rows and holds back')
  step()
  assert.equal(seen.length, 1, 'stepped no more')
  step.leave([cells])
  assert.equal(closed.length, 1, 'a partition not followed is not closed again')
})
