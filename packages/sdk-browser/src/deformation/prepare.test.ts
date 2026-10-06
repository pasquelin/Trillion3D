import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { families } from '../host/families.ts'
import { prepareDeformationGeometry } from './prepare.ts'

/** A WebGPU session's prepare state, over `pages`, with no root nor copy. */
const session = (pages: object[]) => ({
  vis: { geometryBlocks: new Map() } as Record<string, unknown> & {
    geometryBlocks: Map<never, never>
  },
  layout: { selectionRoots: [] },
  setup: { worlds: { of: () => undefined }, blendCopies: [], allPages: pages },
  blendState: { blendGpu: [] },
  run: { gate: { resourcesChanged() {} } },
})

test('a session that deforms nothing loads no deformation code; one whose page deforms does', async () => {
  const { device } = fakeDevice()
  const still = session([{ attributes: G.triangleAttributes() }])
  await prepareDeformationGeometry(still as never, device)
  await families.deformation.settled()
  assert.deepEqual([still.vis.deformationCode, families.deformation.arrived], [undefined, false])
  assert.ok(still.vis.concatPos, 'its vertices are pooled all the same')
  const skinned = session([
    { attributes: G.triangleAttributes(), deformationOutput: { from: 0, count: 3 } },
  ])
  await prepareDeformationGeometry(skinned as never, device)
  assert.equal(skinned.vis.deformationCode, families.deformation.get(), 'awaited at prepare')
})
