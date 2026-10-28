import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../../../tests/kit/fakeDevice/globals.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'
import { localsPipeline, pipelinesFor, sunsHairPass, sunsPipeline } from './projectionPipelines.ts'
import { perLightPipelinesOf } from './perLightPipelines.ts'
import { dfaoPrograms } from '../../../distanceField/ao/pipelines.ts'
import type { VsmInputType } from '../inputType.ts'

installGpuGlobals()

// The fake device refuses a pipeline whose layout lacks, or holds of another kind, a binding its entry point reads
// (`checkPipelineShaders`): making every pass of the projection is the check.
test("the projection's suns and local lights passes bind what their text reads, for every input, mask format and cut", () => {
  const { device } = fakeDevice({ asyncPipelines: false } as never)
  for (const input of ['gbuffer', 'strands'] as VsmInputType[]) {
    const p = pipelinesFor(device, SUNS_LAYOUT)
    assert.ok(sunsPipeline(p, input))
    assert.ok(sunsHairPass(p, input))
    for (const format of ['r32uint', 'rg32uint', 'rgba32uint'] as const)
      for (const capsule of [false, true])
        for (const hair of [false, true])
          assert.ok(localsPipeline(p, format as never, input, capsule, hair))
  }
})

test("the per-light projection passes bind what their text reads, with and without the strands' shadow", async () => {
  const { device } = fakeDevice({ asyncPipelines: true } as never)
  const p = pipelinesFor(device, SUNS_LAYOUT)
  for (const hair of [false, true]) await perLightPipelinesOf(p, hair).projection.prepare()
})

test("the distance field occlusion's passes bind what their text reads", async () => {
  const { device } = fakeDevice({ asyncPipelines: true } as never)
  const programs = dfaoPrograms(device)
  for (const stage of Object.values(programs.single)) await stage.prepare()
  for (const objects of [false, true]) await programs.coneGlobal(objects).prepare()
  await programs.countTiles.prepare()
  await programs.writeTiles.prepare()
})
