// A read that may pass waits its turn in the read layer, the cell's hold still on its way; a hold
// that fails for good (a 404, a file that does not decode) stays failed while its cell is placed:
// another read would meet it again, so no frame asks it again.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
import { EngineError } from '../../../sdk-core/src/index.ts'
import { createPartitionCells } from './cells.ts'
import { io, noBudget, opened } from './cells.fixture.ts'
import { paged } from './paged.fixture.ts'
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
  return { cells, bytes, landed: () => Promise.all(cells.reads()) }
}

/** One cell whose world hold throws `failure`, framed by a clock in the test's hands: the
 *  priorities its holds were asked at, and a frame from `eye` at time `at`. */
async function failing(t: TestContext, failure: Error) {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const priorities: number[] = []
  const world = {
    async hold(_cell: number, asked?: { priority?: number }) {
      priorities.push(asked!.priority!)
      throw failure
    },
    release() {},
  }
  const { cells, bytes, landed } = oneCell(world)
  await opened(cells, bytes, 100) // placed from the origin: its hold refused
  await landed()
  const { port } = io(bytes)
  const frame = async (at: number, eye = [5, 0, 0]) => {
    now = at
    cells.frame(eye, 100, port, noBudget)
    await landed()
  }
  return { priorities, frame }
}

for (const [cause, failure] of [
  ['a file that does not decode', new Error('INVALID_CACHE: a mesh page that does not decode')],
  [
    'a 404',
    new Error('PAGE_STREAM_FAILED', {
      cause: new EngineError('RESOURCE_HTTP_ERROR', 'absent', { status: 404 }),
    }),
  ],
] as const)
  test(`a hold failed for good — ${cause} — stays failed while its cell is placed: never asked again`, async (t) => {
    const { priorities, frame } = await failing(t, failure)
    for (let at = 0; at <= 20_000; at += 1000) await frame(at)
    assert.equal(priorities.length, 1)
  })
