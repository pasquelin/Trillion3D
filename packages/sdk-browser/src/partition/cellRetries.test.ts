// A placed cell whose hold failed is asked again by the plan once the wait of the read that failed
// it is over — the streamer's one clock, never frame after frame before —, at the priority its view
// gives it then; one another read would meet again (a 404, a file that does not decode) is never asked again.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
import { EngineError } from '../../../sdk-core/src/index.ts'
import type { PageAsk } from '../../../sdk-core/src/manifest/paged.ts'
import { cellHoldings } from './cellPages.ts'
import { createPartitionCells } from './cells.ts'
import { io, noBudget, opened } from './cells.fixture.ts'
import { paged } from './paged.fixture.ts'
import { holdPriority } from './plan.ts'
import { placedMesh } from './rows.ts'
import type { WorldRootsHold } from '../scene/worldRoots.ts'

/** A partition of one cell, its world bundles held on `world`: the cell and its file read. */
function oneCell(world: Pick<WorldRootsHold, 'hold' | 'release'>) {
  const box = [10, 0, 0, 11, 1, 1]
  const record = { url: 'a.json', sha256: '', bytes: 1, meshes: [[7, 1] as const], meshPages: [] }
  const { partition, files } = paged([{ ...record, parents: [[null, box] as const] }], 1)
  const cells = createPartitionCells({
    ...{ partition, base: 'https://cache.test/key/', root: new Group(), parents: [] },
    meshes: new Map([[7, placedMesh([{ meshes: 7, primitives: 0 }])]]),
    world,
  })
  const node = { parent: null, mesh: 7, matrix: null, translation: [10, 0, 0] }
  const cell = { version: 2, nodes: [{ ...node, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }] }
  const file = new TextEncoder().encode(JSON.stringify(cell))
  const bytes = (url: string) => files.get(url.split('/').at(-1)!) ?? file
  const { manifest } = cellHoldings(cells)
  return { cells, bytes, manifest, landed: () => Promise.all(manifest.reads()) }
}

/** One cell whose world hold throws `failure` while `refusing()`, framed by a clock in the test's
 *  hands: the priorities its holds were asked at, and a frame from `eye` at time `at`. */
async function failing(t: TestContext, failure: (now: number) => Error, refusing: () => boolean) {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const priorities: number[] = []
  const world = {
    async hold(_cell: number, asked?: PageAsk) {
      priorities.push(asked!.priority!)
      if (refusing()) throw failure(now)
    },
    release() {},
  }
  const { cells, bytes, manifest, landed } = oneCell(world)
  await opened(cells, bytes, 100) // placed from the origin: its hold refused
  await landed()
  const { port } = io(bytes)
  const frame = async (at: number, eye = [5, 0, 0]) => {
    now = at
    cells.frame(eye, 100, port, noBudget)
    await landed()
  }
  return { priorities, manifest, frame, due: () => cells.due() }
}

test('a failed hold is asked again once its own wait is over, at its priority then', async (t) => {
  let refuse = true
  const { priorities, manifest, frame, due } = await failing(
    t,
    (now) => Object.assign(new Error('refused'), { due: now + 500 }), // its read's wait
    () => refuse,
  )
  for (const at of [0, 250, 499]) await frame(at)
  assert.equal(priorities.length, 1, 'never asked again frame after frame')
  assert.equal(due(), 500)
  refuse = false
  await frame(500)
  assert.equal(manifest.held(), 1, 'held once asked again')
  const at = (eye: number[]) =>
    holdPriority({ distance: () => 10 - eye[0] }, { eye, reach: 100 }, 0)
  assert.deepEqual(priorities, [at([0, 0, 0]), at([5, 0, 0])], 'at the priority its view gives it')
})

test('a hold failed by no read — a file that does not decode — is never asked again: it would fail again', async (t) => {
  const { priorities, frame, due } = await failing(
    t,
    () => new Error('INVALID_CACHE: a mesh page that does not decode'),
    () => true,
  )
  for (let at = 0; at <= 20_000; at += 1000) await frame(at)
  assert.deepEqual([priorities.length, due()], [1, Infinity])
})

test('a hold another request would meet again (404) is never asked again', async (t) => {
  const missing = new EngineError('RESOURCE_HTTP_ERROR', 'absent', { status: 404 })
  const { priorities, frame, due } = await failing(
    t,
    () => Object.assign(new Error('PAGE_STREAM_FAILED', { cause: missing }), { due: Infinity }),
    () => true,
  )
  for (let at = 0; at <= 20_000; at += 1000) await frame(at)
  assert.deepEqual([priorities.length, due()], [1, Infinity])
})
