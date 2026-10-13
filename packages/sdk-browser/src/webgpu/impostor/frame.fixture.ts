// The WebGPU runtime the impostor frame tests plan and draw on (`frame.test.ts`): reduced to what the
// plan and the card pass read, on a recording device.
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createEngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { planWebgpuImpostors } from './frame.ts'
import { prepareImpostorPipelines } from './pipelines.ts'
import {
  VIEWPORT,
  engineAt,
  impostorScene,
  impostorSection,
  settle,
} from '../../impostor/section.fixture.ts'

/** A WebGPU runtime reduced to what the plan and the card pass read, on a recording device whose
 *  card pipelines its prepare checked. */
export async function bench() {
  const gpu = fakeDevice()
  assert.ok(await prepareImpostorPipelines(gpu.device, () => {}))
  const { fixture, roots, reader, asked } = impostorScene()
  const marked: Array<[number, number]> = []
  let landed = 0
  const rt = {
    context: { metadata: { impostors: impostorSection }, readTextureLevel: reader },
    vis: { visView: { label: 'ids' } },
    setup: { viewport: VIEWPORT, texturePoolBudget: 1 << 20 },
    layout: { selectionRoots: roots },
    diag: { diagnosticFailure: () => undefined },
    gpu: {
      device: gpu.device,
      impostors: undefined,
      targetSize: VIEWPORT,
      depthView: { label: 'depth' },
      surfaces: { views: () => [0, 1, 2, 3].map((label) => ({ label })) },
    },
    run: {
      frame: 0,
      gate: { resourcesChanged: () => landed++, cam: createEngineCamera() },
      gpuDrawCalls: 0,
      gpuSelection: {
        markWorld: (rank: number, mark: number) => marked.push([rank, mark]),
        worldStandsIn: () => false,
      },
    },
  } as unknown as WebgpuPagesRuntime
  return { gpu, rt, roots, fixture, asked, marked, landed: () => landed }
}

/** Images drawn until the atlas landed and was made: each lands what the one before asked. */
export async function imagesUntilResident(rt: WebgpuPagesRuntime, z: number) {
  for (let image = 0; image < 3; image++) {
    planWebgpuImpostors(rt, engineAt(z))
    await settle()
  }
}
