// The catalogue a partition reads through: the files of the pages the view left are let go, those
// of a placed cell kept, and a file two placements name kept until neither does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
import { createPartitionCells } from './cells.ts'
import { io, noBudget, opened, settled } from './cells.fixture.ts'
import { grid } from './cellGrid.fixture.ts'
import { paged } from './paged.fixture.ts'
import { placedMesh } from './rows.ts'

test('pages the view left are closed, their files let go; those holding a placed cell stay', async () => {
  const { cells, files: bodies } = grid(16)
  const { partition, files } = paged(cells, 4, undefined, undefined, [12, 12, 12])
  const partitioned = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root: new Group(),
    parents: [],
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
  })
  const port = io((url) => files.get(url.split('/').at(-1)!) ?? bodies.get(url.split('/').at(-1)!)!)
  cells.forEach(({ url }) => port.held.add(`https://cache.test/key/${url}`))
  await opened(partitioned, () => new Uint8Array(), false, [1e9, 0, 0])
  await settled(partitioned, [5, 0.5, 5], port.port, noBudget)
  const near = partitioned.stats()
  await settled(partitioned, [155, 0.5, 155], port.port, noBudget)
  const far = partitioned.stats()
  assert.equal(far.held, near.held, 'the cells around the camera, placed')
  assert.ok(port.forgotten.length > 0, 'the files of the pages closed leave the catalogue')
  assert.ok(far.cells <= 2 * near.cells, JSON.stringify([near, far]))
})

test('a file two placements name leaves the catalogue once neither names it', async () => {
  const { cells, files: bodies } = grid(16)
  const { partition, files } = paged(cells, 4, undefined, undefined, [12, 12, 12])
  const first = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root: new Group(),
    parents: [],
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
  })
  const second = first.placement()
  const port = io((url) => files.get(url.split('/').at(-1)!) ?? bodies.get(url.split('/').at(-1)!)!)
  cells.forEach(({ url }) => port.held.add(`https://cache.test/key/${url}`))
  await opened(first, () => new Uint8Array(), false, [1e9, 0, 0])
  await opened(second, () => new Uint8Array(), false, [1e9, 0, 0])
  await settled(first, [5, 0.5, 5], port.port, noBudget)
  await settled(second, [5, 0.5, 5], port.port, noBudget)
  const admitted = port.admitted.map(({ url }) => url)
  assert.equal(new Set(admitted).size, admitted.length, 'each file admitted once')
  // The first walks away: the files near the origin stay, the second names them.
  await settled(first, [155, 0.5, 155], port.port, noBudget)
  const near = new Set(port.admitted.slice(0, admitted.length).map(({ url }) => url))
  assert.ok(!port.forgotten.some((url) => near.has(url)), 'kept while the second names them')
  // The second walks away too: they leave.
  await settled(second, [155, 0.5, 155], port.port, noBudget)
  assert.ok(
    port.forgotten.some((url) => near.has(url)),
    'let go once neither names them',
  )
})
