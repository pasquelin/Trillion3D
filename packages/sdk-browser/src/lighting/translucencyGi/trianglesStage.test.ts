// The cones cast through the scene's triangles: no stage in an image whose scene trace hold was dropped.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createMaskHold } from '../rays/sceneTrace/sceneMaskHold.ts'
import type { TranslucencyGiState } from './gpu.ts'
import { trianglesStageOf } from './trianglesStage.ts'

test('a hold dropped leaves the cones to the distance field: no stage, nothing thrown', () => {
  const hold = createMaskHold()
  hold.dispose()
  const rt = {
    run: { frame: 2 },
    surfaceCache: { lighting: { rays: { frame: 2, sceneTrace: { maskHold: hold } } } },
  } as unknown as WebgpuPagesRuntime
  const values = {
    translucencyGiTraceFromVolume: true,
    translucencyGiHardwareRayTracing: true,
  } as TranslucencyGiValues
  assert.equal(
    trianglesStageOf(
      rt,
      {} as GPUDevice,
      {} as TranslucencyGiState,
      values,
      'rgba16float',
      'rgba16f' as never,
    ),
    undefined,
  )
})
