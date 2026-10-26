// What a loaded scene hands its record as its nodes (`loadPreparedScene`, `nodes`): each host node by the source
// rank `physics.json` names, a partitioned scene's too — the flag's cooked tables, its lawn and pole streaming in
// a cell, its cloth (source 2) and the root above (source 3) kept in the core, renumbered 0 and 1.
import '../../wasm/sdkWasm.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { CookedSoftBody } from '../../../../sdk-core/src/physics/cooked.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { cookedSoftSource } from '../../deformation/softSource.ts'
import type { Model } from '../../physics/tiles/tilePlace.ts'
import type { PageQueue } from '../../geometry/streaming/types.ts'
import type { MeasuredWorldOptions } from '../../session/options.ts'
import { loadPreparedScene } from './scene.ts'

const BASE = 'http://localhost/flag/'
const node = (name: string, sourceNode: string, children: number[]) => ({
  ...{ name, sourceNode, children, mesh: null, camera: null, skin: null, weights: null },
  ...{ matrix: null, translation: null, rotation: null, scale: null, visible: true },
})
/** The flag's core, as its cook writes it: no mesh here, what the node lookup reads alone. */
const flagTables = {
  ...{ version: 9, nodeTableVersion: 7, materialTableVersion: 6, geometryTableVersion: 1 },
  scene: { name: null, nodes: [1] },
  nodes: [node('flag', '00000002', []), node('flag on a pole', '00000003', [0])],
  ...{ meshPages: [], cameras: [], skins: [], animations: [], materials: [], textures: [] },
  hlodMaterials: [],
  document: { buffer: 'source.bin', views: [], accessors: [], meshes: [], images: [] },
  partition: {
    ...{ version: 13, pages: Array(8).fill('0'.repeat(168)), parents: Array(8).fill('') },
    ...{ meshes: [], cube: '4030000000000000', scheme: 'hashSet', flat: true },
    hlod: {
      grids: ['4060000000000000' + '4070000000000000' + '0'.repeat(24)],
      coarser: [null],
      cells: '00000000',
    },
  },
}

async function loaded(t: import('node:test').TestContext, replicaCount = 1) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(flagTables)))
  const queue = { readRange: () => Promise.reject(new Error('no range')) } as unknown as PageQueue
  const options = { manifestUrl: `${BASE}manifest.json`, queue, replicaCount }
  const metadata = { primitives: [] } as unknown as ClusterManifest
  return loadPreparedScene(
    options as MeasuredWorldOptions & { queue: PageQueue },
    metadata,
    BASE,
    'full',
    undefined,
    () => {},
    () => {},
  )
}

test('a partitioned scene hands its nodes by source rank: the cloth physics.json names 2 is found', async (t) => {
  const scene = await loaded(t)
  const nodes = scene.nodes!
  assert.equal(nodes[2]?.userData.name, 'flag')
  assert.equal(nodes[3]?.userData.name, 'flag on a pole')
  assert.deepEqual([0 in nodes, 1 in nodes], [false, false], 'the cell draws the lawn and the pole')
  const soft = {
    node: 2,
    vertices: 3,
    render: { version: 1, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
  } as unknown as CookedSoftBody
  const model = { record: { base: BASE }, _graphNodeAt: (i: number) => nodes[i] ?? null }
  const source = cookedSoftSource(model as unknown as Model, soft)
  assert.equal((nodes[2] as Object3D & { softSource?: unknown }).softSource, source)
})

test('a partitioned table whose node names no source rank, or two nodes one, is refused by name', async (t) => {
  const [flag, root] = flagTables.nodes
  const refused = (message: string) => ({ code: 'INVALID_SCENE_TABLES', message })
  const { sourceNode: _, ...unnamed } = flag
  flagTables.nodes = [unnamed as typeof flag, root]
  await assert.rejects(loaded(t), refused('a node of a partitioned table names no sourceNode'))
  flagTables.nodes = [flag, { ...root, sourceNode: '00000002' }]
  await assert.rejects(loaded(t), refused('two nodes name one sourceNode'))
  flagTables.nodes = [flag, root]
})
