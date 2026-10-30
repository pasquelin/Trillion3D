import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { layoutProblems } from '../../gpu/core/wgslLayoutMatch.fixture.ts'
import { storageBufferCount, withinDefaults } from '../../gpu/core/stageLimits.fixture.ts'
import { NO_SCENE_MASKS } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { skyLightTracedKit } from './skyLightTracedKit.ts'
import {
  SKY_COMPOSITE_ENTRY,
  SKY_RAYS_ENTRY,
  SKY_TRACE_ENTRY,
  SKY_TRACE_STORAGE_WITH_HAIR,
  skyCompositeProgram,
  skyRaysProgram,
  skyTraceProgram,
} from './skyLightTracedWgsl.ts'

test("the sky light's passes fit WebGPU's default limits in every stage", () => {
  const { device, pipelineLayouts: layouts } = fakeDevice()
  const kit = skyLightTracedKit(device)
  kit.stageOf(NO_SCENE_MASKS)
  withinDefaults(layouts, 'the ray-traced sky light')
})

test('the trace with the strands’ voxels binds the nine storage buffers a stage must grant, three more than the trace without them', () => {
  const countOf = (hair: boolean) => {
    const { device, pipelineLayouts } = fakeDevice({
      limits: { maxStorageBuffersPerShaderStage: SKY_TRACE_STORAGE_WITH_HAIR },
    })
    const kit = skyLightTracedKit(device)
    ;(hair ? kit.hairStageOf : kit.stageOf)(NO_SCENE_MASKS)
    return storageBufferCount(pipelineLayouts.at(-1)!)
  }
  assert.equal(countOf(false), 6)
  assert.equal(countOf(true), SKY_TRACE_STORAGE_WITH_HAIR)
})

test('the passes bind what their texts declare: each binding a pass reaches is in its layout, of the kind and format it reads', () => {
  const { device, bindGroupLayouts } = fakeDevice()
  const kit = skyLightTracedKit(device)
  const entriesOf = (label: string) =>
    bindGroupLayouts.find((layout) => layout.label === label)!.entries as GPUBindGroupLayoutEntry[]
  const trace = [
    entriesOf('Trillion3D sky light trace'),
    entriesOf('Trillion3D sky light trace view'),
    entriesOf('Trillion3D sky light trace scene trace'),
  ]
  assert.ok(kit.trace && kit.view && kit.scene && kit.voxels)
  assert.deepEqual(layoutProblems(skyTraceProgram(), trace, SKY_TRACE_ENTRY), [])
  assert.deepEqual(
    layoutProblems(
      skyTraceProgram(NO_SCENE_MASKS, true),
      [...trace, entriesOf('Trillion3D sky light trace hair voxels')],
      SKY_TRACE_ENTRY,
    ),
    [],
  )
  assert.deepEqual(
    layoutProblems(
      skyRaysProgram(),
      [entriesOf('Trillion3D sky light directions')],
      SKY_RAYS_ENTRY,
    ),
    [],
  )
  assert.deepEqual(
    layoutProblems(
      skyCompositeProgram(),
      [entriesOf('Trillion3D sky light composite')],
      SKY_COMPOSITE_ENTRY,
    ),
    [],
  )
})
