// A page moves the parent of placed nodes. The synthetic world of `world-partition.fixture.ts`
// hangs every placement under one scene root, `district`, and is compiled by this checkout's
// native compiler: the cells box their nodes in the district's frame. A page loads it as a world
// does (`loadModel`), finds the district by name (`getObjectByName`) and moves it 5 km, to where a
// still camera stands. The session's per-frame step (`createPartitionFrame`) then reads the cells
// there: every node within the camera's reach is drawn, on a row at its moved place.
import { composeStandIn } from '../../packages/sdk-browser/src/partition/composeStandIn.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { Object3D } from '../../packages/sdk-core/src/world/object/object3d.ts'
import type { Engine } from '../../packages/sdk-browser/src/engine/types.ts'
import type { PlacementRows } from '../../packages/sdk-browser/src/placement/rows.ts'
import { createWorldPoses } from '../../packages/sdk-browser/src/world/core/worldPoses.ts'
import { createPartitionFrame } from '../../packages/sdk-browser/src/world/scene/partitionFrame.ts'
import { compiler, SPACING, world } from './world-partition.fixture.ts'
import { assertNoneMissing, primed, served } from './world-partition-follow.fixture.ts'
import { noModels } from '../../packages/sdk-browser/src/world/core/worldModels.fixture.ts'

const SHIFT = 5000

test(
  'a page that moves the parent of placed nodes moves their cells: none is missing, camera still',
  { skip: !existsSync(compiler) },
  async (t) => {
    const model = await served(t, 'world-partition-parents-', world(96, 'district'))
    // The camera stands where the middle of the district will be, 5 km from where it is.
    const { cells, streamer, camera } = await primed(model, [48 * SPACING - SHIFT, 2, 48 * SPACING])
    assert.equal(cells.stats().held, 0, 'nothing is there yet')

    const scene = new Object3D()
    scene.add(model)
    const district = model.getObjectByName('district')!
    district.position.x -= SHIFT
    const poses = createWorldPoses()
    poses.moved(district)
    poses.apply(scene, new Map(), noModels(), () => {})

    const drawn = new Set<PlacementRows>()
    let renewed = 0
    const frame = createPartitionFrame({
      partitions: [cells],
      streamer,
      camera,
      engine: {
        worldCut: () => undefined,
        updatePlacements: (rows) => void drawn.add(rows),
        composePlacements: composeStandIn(),
      } as Partial<Engine> as Engine,
      renew: () => void renewed++,
      budget: { admits: () => true, spend() {} },
    })!
    for (let step = 0; step < 16; step++) {
      frame()
      if (!(await frame.pending())) break
    }
    const { held, waiting } = cells.stats()
    assert.ok(held > 0 && waiting === 0 && renewed === 0, JSON.stringify({ held, renewed }))

    // Every node within reach of the still camera has a live row at its moved place.
    const near = await assertNoneMissing({ cells, camera, engine: { drawn } }, ([x, y, z]) => [
      x - SHIFT,
      y,
      z,
    ])
    assert.ok(near > 100, `${near} nodes within reach`)
  },
)
