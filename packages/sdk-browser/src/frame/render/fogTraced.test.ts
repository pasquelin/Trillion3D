// The lights the fog's volume traces by rays: nothing is traced in an image whose scene trace hold was dropped.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { createMaskHold } from '../../lighting/rays/sceneTrace/sceneMaskHold.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { writeFogTracedLights } from './fogTraced.ts'

test('a hold dropped leaves the fog untraced for the image: no kernel, no lights named, nothing thrown', () => {
  const hold = createMaskHold()
  hold.dispose()
  const rt = {
    run: { frame: 5 },
    lights: { vsm: { state: { maps: { shadows: {} } } } },
    surfaceCache: { lighting: { sceneTrace: { maskHold: hold }, rays: { frame: 5 } } },
  } as unknown as WebgpuPagesRuntime
  const into = {
    tracedLights: undefined,
    tracedOwners: undefined,
    tracedWords: 7,
    rays: undefined,
    tracedKernel: undefined,
  }
  writeFogTracedLights(
    rt,
    {} as GPUDevice,
    { volumetricFogInjectRaytracedLights: true } as VolumetricFogValues,
    into,
  )
  assert.equal(into.tracedWords, 0)
  assert.equal(into.rays, undefined)
  assert.equal(into.tracedKernel, undefined)
  assert.equal(into.tracedLights, undefined)
})
