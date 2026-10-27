// The scene trace's culling pass (`sceneCullPass.ts`): encoded each image while a mode culls; the switch to no culling
// clears the words an earlier mode wrote, once, whatever the placements now; not again while the mode stays off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { DagReadTables } from '../../../geometry/dag/shader/bindings.ts'
import { createCullGroups, encodeSceneCull } from './sceneCullPass.ts'
import { SCENE_CULL_MODE } from './sceneCullWgsl.ts'

test('with no culling the words an earlier mode wrote are cleared once, all of them; the words of a fresh table are zero already', async () => {
  const gpu = fakeDevice()
  const { device } = gpu
  const buffer = (usage: number) => device.createBuffer({ size: 256, usage })
  const bound = {
    params: buffer(GPUBufferUsage.UNIFORM),
    table: buffer(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
    views: { nodes: {}, frames: {}, worlds: {}, tree: {} } as unknown as DagReadTables,
  }
  const cullWord = 7
  const groups = createCullGroups()
  const encode = (mode: number, placements = 3) =>
    encodeSceneCull(
      device,
      device.createCommandEncoder(),
      groups,
      bound,
      placements,
      mode,
      cullWord,
    )
  const passes = () => gpu.computePasses.length
  const culling = SCENE_CULL_MODE.distanceAndSolidAngle
  // A fresh table: nothing to clear, and the first culling call starts the compile, no pass until it lands.
  assert.equal(encode(SCENE_CULL_MODE.disabled), false, 'a fresh table: nothing to zero')
  assert.equal(encode(culling), false)
  await new Promise((done) => setTimeout(done, 0))
  assert.equal(encode(culling, 5), true)
  assert.equal(encode(culling), true, 'each image while a mode culls')
  assert.equal(passes(), 2)
  // The cut shrank to 2 placements: the clear still covers the 5 words the mode wrote, once.
  assert.equal(
    encode(SCENE_CULL_MODE.disabled, 2),
    true,
    'the switch to no culling clears the words',
  )
  assert.equal(encode(SCENE_CULL_MODE.disabled, 2), false)
  assert.equal(encode(SCENE_CULL_MODE.disabled, 2), false)
  assert.equal(passes(), 2, 'no pass to clear')
  assert.deepEqual(
    gpu.clears.map(({ offset, size }) => [offset, size]),
    [[cullWord * 4, 5 * 4]],
  )
})
