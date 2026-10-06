import test from 'node:test'
import assert from 'node:assert/strict'
import type { RenderBackend } from '../../backend/types.ts'
import { hostFramingCamera } from '../../host/scene/graphObjects.ts'
import type { PartitionCells } from '../../partition/cells.ts'
import { createCellPages, withHoldings } from '../../partition/cellPages.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'
import { createPartitionFrame } from './partitionFrame.ts'

type Io = Parameters<PartitionCells['frame']>[2]

test('a still camera is drawn again until the cells it asked for within reach are placed', async () => {
  // The interactive session draws on demand: once the camera stops, only `pending` asks for the
  // frames that place the cells read after it (`hostRuntime.ts`, `pendingFrame`).
  let later = true,
    read = () => {},
    decodes: Promise<void>[] = []
  const cells = withHoldings(
    { meshes: new Map(), manifest: createCellPages(undefined, () => []) },
    {
      frame(_eye: number[], _reach: number, io: Io) {
        io.request(['near.json'], false)
        io.request(['ahead.json'], true)
        return later
      },
      decodes: () => decodes.splice(0),
    } as unknown as PartitionCells,
  )
  const streamer = {
    request: (urls: readonly string[]) =>
      new Promise<void>((resolve) => {
        if (urls[0] === 'near.json') read = resolve
      }),
  } as unknown as ReturnType<typeof createPageStreamer>
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    active: () => ({}) as RenderBackend,
    budget: { admits: () => true, spend() {} },
  })!
  frame()
  let settled = false
  const pending = frame.pending().then((again) => ((settled = true), again))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(settled, false, 'it waits on the read within reach, never on one ahead')
  read()
  assert.equal(await pending, true, 'the cell read asks for a frame')
  later = false
  frame()
  read()
  assert.equal(await frame.pending(), false, 'nothing is left to place')
  // A cell handed to the decode pool asks for the frame that places it once it lands.
  frame()
  read()
  decodes = [Promise.resolve()]
  assert.equal(await frame.pending(), true, 'a decode landed')
})

/** The frame step of a still camera over one partition holding its cells on `holder`. */
function stillFrame(holder: Parameters<typeof createCellPages>[2]) {
  const manifest = createCellPages(undefined, () => [], holder)
  const cells = withHoldings({ meshes: new Map(), manifest }, {
    frame: () => false,
    decodes: () => [],
  } as unknown as PartitionCells)
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer: {} as ReturnType<typeof createPageStreamer>,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    active: () => ({}) as RenderBackend,
    budget: { admits: () => true, spend() {} },
  })!
  return { manifest, frame }
}

test('a still camera is drawn again as each hold lands, never waiting for every placed cell', async () => {
  const lands: (() => void)[] = []
  const { manifest, frame } = stillFrame({
    hold: () => new Promise<void>((resolve) => lands.push(resolve)),
    release() {},
  })
  for (const cell of [0, 1, 2]) manifest.hold(cell)
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

test("a still camera never waits for a failed read's turn: the streamer asks the frame", async () => {
  const { manifest, frame } = stillFrame({
    async hold() {
      throw new Error('refused')
    },
    release() {},
  })
  manifest.hold(0)
  frame()
  assert.equal(await frame.pending(), true, 'the hold failed: a frame is drawn')
  frame()
  assert.equal(await frame.pending(), false, 'then nothing is on its way, and nothing is awaited')
})
