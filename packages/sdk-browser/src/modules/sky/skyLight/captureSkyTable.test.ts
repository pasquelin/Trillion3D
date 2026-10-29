// The real-time capture builds the sky table once, in a frame that does not turn with the face, before
// the faces' sky reads it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { FRAME_LAYOUT } from '../../../lighting/atmosphere/frameLayout.ts'
import { DEFAULT_AIR_SHAPE, type AirShape } from '../../../lighting/atmosphere/shape.ts'
import { createFaceDrawer } from './captureFaces.ts'
import type { SkyLightInputs } from './captureInputs.ts'
import { BLOCK_STRIDE } from './layout.ts'
import { createSkyLightPipelines } from './pipelines.ts'
import { createSkyLightTargets } from './targets.ts'

async function drawn(shape: AirShape, position: [number, number, number]) {
  const kit = fakeDevice()
  const { device } = kit
  const made = createSkyLightPipelines(device, () => {}, shape)
  await Promise.all(Object.values(made.pipelines).map((p) => p.prepare()))
  const t = createSkyLightTargets(device, made, 8, 4)
  const buffer = (usage: number) => device.createBuffer({ size: BLOCK_STRIDE, usage })
  const view = () =>
    device
      .createTexture({
        size: { width: 4, height: 4 },
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView()
  const input = {
    part: {
      light: {
        lowerHemisphereIsSolidColor: false,
        lowerHemisphereColor: [0, 0, 0],
        lowerHemisphereCoverage: 1,
      },
      quality: { skyLightAlwaysClear: false, skyLightShadowFromOpaque: false },
    },
    atmosphere: true,
    fogShown: false,
    preExposure: 1,
    frame: 0,
    position,
    air: {
      resolved: { planetRadius: 6360, groundHeight: 0, groundPosition: [0, 0] },
      buffer: buffer(GPUBufferUsage.STORAGE),
      transmittance: view(),
      multiScatter: view(),
      sampler: device.createSampler(),
    },
  } as unknown as SkyLightInputs
  const encoder = device.createCommandEncoder()
  createFaceDrawer(device, made).draw(encoder, t, 0, 6, true, false, input)
  return { kit, t }
}

test('the sky table is built once, before the six faces that read it', async () => {
  const { kit } = await drawn(DEFAULT_AIR_SHAPE, [10, 20, 30])
  assert.deepEqual(kit.commands, [
    'compute Trillion3D sky light sky table',
    ...Array(6).fill('render Trillion3D sky light face'),
  ])
  const [dispatch] = kit.dispatches
  const { width, height } = DEFAULT_AIR_SHAPE.skyView
  assert.equal(dispatch.entryPoint, 'skyViewMain')
  assert.deepEqual([dispatch.direct, dispatch.rows], [Math.ceil(width / 8), Math.ceil(height / 8)])
})

test('the table’s frame holds the capture’s place and an axis that is no face’s', async () => {
  const { kit, t } = await drawn(DEFAULT_AIR_SHAPE, [10, 20, 30])
  const writes = kit.writes.filter((w) => w.buffer === t.blocks.skyFrame)
  assert.equal(writes.length, 1)
  const floats = new Float32Array(writes[0].data.buffer.slice(writes[0].data.byteOffset))
  const { at } = FRAME_LAYOUT
  assert.deepEqual([...floats.slice(at.eye, at.eye + 3)], [10, 20, 30])
  // The look of the first face, across the planet's up (the scene's y): forward and left are unit
  // and orthogonal to the up.
  const axis = (name: 'forward' | 'left' | 'up') => [...floats.slice(at[name], at[name] + 3)]
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0)
  assert.ok(Math.abs(dot(axis('forward'), axis('up'))) < 1e-3)
  assert.ok(Math.abs(dot(axis('left'), axis('up'))) < 1e-3)
  assert.ok(Math.abs(dot(axis('left'), axis('forward'))) < 1e-3)
})

test('no table is built where the quality settings ask for none', async () => {
  const shape = {
    ...DEFAULT_AIR_SHAPE,
    skyView: { ...DEFAULT_AIR_SHAPE.skyView, fast: false },
  }
  const { kit } = await drawn(shape, [0, 0, 0])
  assert.deepEqual(kit.commands, Array(6).fill('render Trillion3D sky light face'))
})
