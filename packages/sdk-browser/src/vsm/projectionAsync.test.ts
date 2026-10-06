import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmResources } from './resources.ts'
import { encodeVirtualShadowProjection, type VsmProjectionLight } from './projectionPass.ts'
import { camera, sun } from './projectionScene.fixture.ts'

const view = {} as GPUTextureView
const lamp: VsmProjectionLight = {
  type: 'point',
  mapId: 8192,
  direction: [0, -1, 0],
  position: [0, 2, 3],
  radius: 10,
}

test('a new light mix compiles off the frame while the twin projects; no frame skips its projection', async () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { fullMapCapacity: 63, poolPages: 256 })
  const sync: string[] = [],
    asked: Record<string, number>[] = [],
    used: Record<string, number>[] = []
  const create = device.createComputePipelineAsync.bind(device)
  device.createComputePipeline = (d) => (sync.push('at once'), d.compute as never)
  device.createComputePipelineAsync = (d) => (
    asked.push(d.compute.constants as Record<string, number>),
    create(d)
  )
  const encoder = {
    beginComputePass: () => ({
      setPipeline: (p: GPUProgrammableStage) => used.push(p.constants as Record<string, number>),
      setBindGroup() {},
      dispatchWorkgroups() {},
      end() {},
    }),
  } as unknown as GPUCommandEncoder
  let frame = 0
  const project = (lights: VsmProjectionLight[]) =>
    encodeVirtualShadowProjection(
      encoder,
      res,
      {
        device,
        depth: view,
        normalRough: view,
        flags: view,
        mask: view,
        maskTiles: view,
        width: 8,
        height: 8,
        camera,
        frameIndex: ++frame,
        subgroups: false,
      },
      lights,
    )
  project([sun, lamp])
  assert.deepEqual(
    used.map((c) => [c.VSM_PROJECTION_ONE_LIGHT, c.VSM_PROJECTION_KINDS]),
    [[0, 0]],
    'the first frame draws its projection, with the twin; the asked mix compiles off the frame',
  )
  assert.deepEqual(sync, ['at once'], 'the twin alone is made at once, once')
  assert.deepEqual(asked, [{ VSM_PROJECTION_ONE_LIGHT: 0, VSM_PROJECTION_KINDS: 3 }])
  await new Promise(setImmediate)
  used.length = 0
  project([sun, lamp])
  assert.deepEqual(
    used.map((c) => [c.VSM_PROJECTION_ONE_LIGHT, c.VSM_PROJECTION_KINDS]),
    [[0, 3]],
    'then the specific one',
  )
  assert.equal(sync.length, 1, 'no other synchronous createComputePipeline')
})
