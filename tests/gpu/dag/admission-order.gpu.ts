// #1483: a pool too short for the cut has the GPU rank its requests by admission — the coarsest
// level first, the larger error within a level —, so the host admits the head of the list as it
// comes and sorts nothing (`webgpu/residency/requestAdmission.ts`). The shipped kernel, on Dawn,
// on the four-depth scene of the request tests: the levels it publishes never rise, the pages are
// the cut's own, and the error order is kept within each level, one quantization step at most.
import test from 'node:test'
import assert from 'node:assert/strict'
import { requestScene } from '../../../packages/sdk-browser/src/gpu/dag/requestScene.fixture.ts'
import { dagRecords, flagsOf } from '../../../packages/sdk-browser/src/gpu/dag/records.fixture.ts'
import { CLUSTER_LEVEL_SHIFT } from '../../../packages/sdk-browser/src/gpu/dag/clusterFlags.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import { runSelectionKernel } from './selectionKernel.ts'

test('the kernel ranks a short pool’s requests coarsest level first', async () => {
  const scene = requestScene(1)
  const uniforms = { ...scene.uni, admitByLevel: true }
  const { adapter, readings } = await runSelectionKernel([
    { name: 'by error', packed: scene.packed, uniforms: scene.uni },
    { name: 'by admission', packed: scene.packed, uniforms },
  ])
  const [byError, byLevel] = readings,
    records = dagRecords(scene.packed)
  const levelOf = (page: number) => flagsOf(records, page) >>> CLUSTER_LEVEL_SHIFT
  const levels = byLevel.requests.map(levelOf)
  console.log(JSON.stringify({ adapter, requests: levels.length, levels: new Set(levels).size }))
  assert.ok(new Set(levels).size > 2, 'the cut must span levels')
  for (let i = 1; i < levels.length; i++)
    assert.ok(levels[i] <= levels[i - 1], `rank ${i}: level ${levels[i]} after ${levels[i - 1]}`)
  // The same cut, only ranked another way; and the oracle's ranking of it, page for page in level.
  assert.deepEqual(byLevel.pages, byError.pages)
  const oracle = evaluateDagSelectionKernel(scene.packed, uniforms).pageIds
  assert.deepEqual(oracle.map(levelOf), levels, 'the device and its model rank the same levels')
  // Within a level the staged priorities never rise: the error orders what the level ties.
  for (let i = 1; i < levels.length; i++)
    if (levels[i] === levels[i - 1])
      assert.ok(byLevel.priorities[i] <= byLevel.priorities[i - 1], `rank ${i}: error rises`)
})
