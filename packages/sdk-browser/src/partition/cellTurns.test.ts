// A placed cell whose hold failed is asked again by the plan once a failed read's wait ended since it
// was held — never frame after frame before —, at the priority its view gives it then.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
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

test("a failed hold is asked again once a failed read's wait is over, at its priority then", async () => {
  const priorities: number[] = []
  let refuse = true
  const world = {
    async hold(_cell: number, asked?: PageAsk) {
      priorities.push(asked!.priority!)
      if (refuse) throw new Error('refused')
    },
    release() {},
  }
  const { cells, bytes, manifest, landed } = oneCell(world)
  await opened(cells, bytes, 100) // placed from the origin: its hold refused
  await landed()
  const { port } = io(bytes)
  let turns = 0
  port.turns = () => turns
  for (let frame = 0; frame < 3; frame++) cells.frame([5, 0, 0], 100, port, noBudget)
  await landed()
  assert.equal(priorities.length, 1, 'never asked again frame after frame')
  ;[refuse, turns] = [false, 1]
  cells.frame([5, 0, 0], 100, port, noBudget)
  await landed()
  assert.equal(manifest.held(), 1, 'held once asked again')
  const at = (eye: number[]) =>
    holdPriority({ distance: () => 10 - eye[0] }, { eye, reach: 100 }, 0)
  assert.deepEqual(priorities, [at([0, 0, 0]), at([5, 0, 0])], 'at the priority its view gives it')
})

test("a hold whose failed read's wait ends before the hold settles is still asked again", async () => {
  let fail = () => {}
  const failing = new Promise<void>((resolve) => (fail = resolve))
  const asks: number[] = []
  const world = {
    async hold() {
      if (asks.push(1) > 1) return
      await failing
      throw new Error('refused')
    },
    release() {},
  }
  const { cells, bytes, manifest, landed } = oneCell(world)
  await opened(cells, bytes, 100)
  const { port } = io(bytes)
  port.turns = () => 1
  cells.frame([5, 0, 0], 100, port, noBudget) // the wait ended while the hold still reads
  fail()
  await landed()
  cells.frame([5, 0, 0], 100, port, noBudget)
  await landed()
  assert.deepEqual([asks.length, manifest.held()], [2, 1], 'asked again, held')
})
