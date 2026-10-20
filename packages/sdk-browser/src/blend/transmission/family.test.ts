import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuBlendPipelines } from '../pipelines.ts'
import { mountDevice } from '../translucentScene.fixture.ts'
import { families } from '../../session/host/families.ts'
import type { BlendGpuItem } from '../state.ts'

const items = (transmissive: boolean) =>
  [{ transmissive, surface: { blending: 'normal' } }] as unknown as BlendGpuItem[]

test("glass loads transmission's code at prepare, never the particles'", async () => {
  await createWebgpuBlendPipelines(mountDevice().device, items(false))
  await families.transmission.settled()
  assert.equal(families.transmission.arrived, false, 'a scene that transmits nothing loads none')
  const glass = await createWebgpuBlendPipelines(mountDevice().device, items(true))
  assert.ok(
    glass.blendPipelines.transmission,
    'the transmissive stages are made of the code the prepare awaited',
  )
  await families.particles.settled()
  assert.equal(families.particles.arrived, false, 'no particle code for a glass')
})
