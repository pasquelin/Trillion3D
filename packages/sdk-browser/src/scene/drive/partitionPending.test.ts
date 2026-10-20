import test from 'node:test'
import assert from 'node:assert/strict'
import type { Engine } from '../../session/engine/types.ts'
import { hostFramingCamera } from '../host/scan/graphObjects.ts'
import type { PartitionCells } from '../../geometry/partition/cells.ts'
import { createCellHolds } from '../../geometry/partition/cellHolds.ts'
import type { PageStreaming } from '../../geometry/streaming/pageStreamer.ts'
import { PRIORITY_VISIBLE } from '../../geometry/streaming/priority.ts'
import { createPartitionFrame } from './partitionFrame.ts'

type Io = Parameters<PartitionCells['frame']>[1]

test('a still camera is drawn again until the cells it asked for within reach are placed', async () => {
  // The interactive session draws on demand: once the camera stops, only `pending` asks for the
  // frames that place the cells read after it (`../../frame/schedule/sessionRuntime.ts`, `pendingFrame`).
  let later = true,
    read = () => {},
    decodes: Promise<void>[] = []
  const cells = {
    frame(_eye: number[], io: Io) {
      io.request(['near.json'])
      return later
    },
    decodes: () => decodes.splice(0),
    reads: () => [],
  } as unknown as PartitionCells
  const streamer = {
    readBytes: (url: string) =>
      new Promise<void>((resolve) => {
        if (url === 'near.json') read = resolve
      }),
    // Each asked page pinned while its read stands (`viewAsks.ts`).
    pin() {},
    unpin() {},
  } as unknown as PageStreaming
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    engine: { worldCells: () => undefined } as unknown as Engine,
    budget: { admits: () => true, spend() {} },
  })!
  frame()
  let settled = false
  const pending = frame.pending().then((again) => ((settled = true), again))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(settled, false, 'it waits on the read it asked')
  read()
  assert.equal(await pending, true, 'the cell read asks for a frame')
  later = false
  frame()
  read()
  assert.equal(await frame.pending(), false, 'nothing is left to place')
  // A cell handed to the page worker pool asks for the frame that places it once it lands (#575).
  frame()
  read()
  decodes = [Promise.resolve()]
  assert.equal(await frame.pending(), true, 'a decode landed')
})

/** The frame step of a still camera over one partition holding its cells on `holder`. */
function stillFrame(holder: Parameters<typeof createCellHolds>[0]) {
  const holds = createCellHolds(holder)
  const cells = {
    frame: () => false,
    decodes: () => [],
    reads: holds.reads,
  } as unknown as PartitionCells
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer: {} as PageStreaming,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    engine: { worldCells: () => undefined } as unknown as Engine,
    budget: { admits: () => true, spend() {} },
  })!
  return { holds, frame }
}

test('a still camera is drawn again as each hold lands, never waiting for every placed cell', async () => {
  const lands: (() => void)[] = []
  const { holds, frame } = stillFrame({
    hold: () => new Promise<void>((resolve) => lands.push(resolve)),
    release() {},
    lift() {},
  })
  for (const cell of [0, 1, 2]) holds.hold(cell, PRIORITY_VISIBLE)
  frame()
  const first = frame.pending()
  lands[1]()
  assert.equal(await first, true, 'one landed, two still reading: a frame')
  frame()
  const next = frame.pending()
  lands[0]()
  assert.equal(await next, true)
  lands[2]()
  frame()
  assert.equal(await frame.pending(), true)
  frame()
  assert.equal(await frame.pending(), false, 'every hold landed')
})

test('a hold that fails for good asks one frame as it settles, then nothing is awaited', async () => {
  const holder = {
    async hold() {
      throw new Error('PAGE_STREAM_FAILED: refused for good')
    },
    release() {},
    lift() {},
  }
  const { holds, frame } = stillFrame(holder)
  holds.hold(0, PRIORITY_VISIBLE)
  frame()
  assert.equal(await frame.pending(), true, 'the hold failed: a frame is drawn')
  frame()
  assert.equal(await frame.pending(), false, 'then nothing is on its way, and nothing is awaited')
})
