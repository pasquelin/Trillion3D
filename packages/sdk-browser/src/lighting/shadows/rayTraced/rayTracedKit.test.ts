import assert from 'node:assert/strict'
import test from 'node:test'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { lastTracedAt, runRayTracedShadow } from './rayTracedKit.ts'

const view = {} as GPUTextureView

/** A runtime that has everything the kernel asks but its pipeline. */
const runtimeOf = (device: GPUDevice) =>
  ({
    gpu: {
      device,
      targetSize: [8, 8],
      deferred: { uniform: {} },
      reflection: {},
      surfaces: {},
    },
    vis: { gpuHiz: { depth: () => view } },
    lights: { buffer: {} },
    run: { frame: 7 },
  }) as unknown as WebgpuPagesRuntime

test('a view that got no pipeline is not stamped as having traced', () => {
  const { device } = fakeDevice()
  const rt = runtimeOf(device)
  const rays = { sceneTrace: { maskHold: { use: () => undefined } } } as unknown as SceneRays
  const ran = runRayTracedShadow(
    rt,
    {} as GPUCommandEncoder,
    {} as ShadowValues,
    rays,
    { rank: 0, samples: 1, output: view },
    [view],
  )
  assert.equal(ran, false)
  assert.equal(lastTracedAt(rt.gpu), undefined, 'nothing traced, nothing to let go')
})
