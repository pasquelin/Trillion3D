import test from 'node:test'
import assert from 'node:assert/strict'
import { cellUrl, decodeHere, io, noBudget, settled, sizedWhole, world } from './cells.fixture.ts'
import { createDecodes, takeDecoded } from './decodes.ts'

test('a frame says when a cell within reach is left for a later one, read or decoded', async () => {
  const { cells, bytes } = await sizedWhole(world())
  const { port, held } = io(bytes)
  await settled(cells, [0, 0, 0], 100, port, noBudget) // the pages of the index it reaches
  const unread = cells.frame([0, 0, 0], 100, port, noBudget)
  held.add(cellUrl('near.json'))
  const decoding = cells.frame([0, 0, 0], 100, port, noBudget)
  assert.equal(cells.stats().held, 0, 'nothing is placed before its decode lands')
  await Promise.all(cells.decodes())
  assert.deepEqual(
    [unread, decoding, cells.frame([0, 0, 0], 100, port, noBudget)],
    [true, true, false],
  )
})

test('a cell file is never parsed by the frame: its bytes go to the decode, its rows are placed', async () => {
  const { cells, bytes } = await sizedWhole(world())
  const { port, held } = io(bytes)
  const decoded: Uint8Array[] = []
  // The decode runs later, as the pool answers: whatever it parses is not the frame's.
  port.decode = (read) => (decoded.push(read), Promise.resolve().then(() => decodeHere(read)))
  await settled(cells, [0, 0, 0], 100, port, noBudget)
  held.add(cellUrl('near.json'))
  const parse = JSON.parse
  let parsed = 0
  const frame = () => {
    JSON.parse = (...args: Parameters<typeof parse>) => (parsed++, parse(...args))
    try {
      cells.frame([0, 0, 0], 100, port, noBudget)
    } finally {
      JSON.parse = parse
    }
  }
  frame()
  await Promise.all(cells.decodes())
  frame()
  assert.deepEqual([parsed, decoded.length, cells.stats().held], [0, 1, 1])
  // A file the decode refused is thrown by the frame that reads it.
  const refused = await sizedWhole(world())
  const other = io(refused.bytes)
  other.held.add(cellUrl('far.json'))
  other.port.decode = () => Promise.reject(new Error('INVALID_SCENE_TABLES'))
  await assert.rejects(
    settled(refused.cells, [5000, 0, 0], 100, other.port, noBudget),
    /INVALID_SCENE_TABLES/,
  )
})

test('a cell file refused for good is never asked again, and leaves no frame waiting on it', async () => {
  const { cells, bytes } = await sizedWhole(world())
  const { port, asked } = io(bytes)
  await settled(cells, [0, 0, 0], 100, port, noBudget) // the pages of the index it reaches
  const refused = new Set(asked.filter((url) => url.endsWith('.json')))
  assert.ok(refused.size > 0, 'the cells within reach were asked')
  const frame = { ...port, failed: (url: string) => refused.has(url) }
  asked.length = 0
  for (let i = 0; i < 3; i++)
    assert.equal(cells.frame([0, 0, 0], 100, frame, noBudget), false, 'no frame waits on it')
  assert.deepEqual(
    asked.filter((url) => refused.has(url)),
    [],
    'refused at once by the streamer, never asked a frame',
  )
})

test('a cell within reach whose read is on its way is asked again: its frame waits on that read', () => {
  const asked: string[] = []
  // A read already a job — waiting its turn after a failure, say — whoever asked it first.
  const port = {
    bytes: () => undefined,
    failed: () => false,
    loading: () => true,
    request: (urls: readonly string[]) => void asked.push(...urls),
  }
  const at = { io: port, budget: noBudget, ahead: false }
  const later = takeDecoded(
    [7],
    at,
    createDecodes<number, object>(),
    () => 'c7.json',
    async () => ({}),
    () => true,
  )
  assert.deepEqual([later, asked], [true, ['c7.json']])
})
