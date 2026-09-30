import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBlendPipelines } from '../blend/pipelines.ts';
import { mountDevice } from './pass.fixture.ts';
import { families } from '../../host/families.ts';
import type { BlendGpuItem } from '../blend/state.ts';

const items = (transmissive: boolean) =>
  [{ transmissive, surface: { blending: 'normal' } }] as unknown as BlendGpuItem[];

test("glass loads transmission's code at prepare, never the particles' (#1353)", async () => {
  await createWebgpuBlendPipelines(mountDevice().device, items(false));
  await families.transmission.settled();
  assert.equal(families.transmission.arrived, false, 'a scene that transmits nothing loads none');
  const glass = await createWebgpuBlendPipelines(mountDevice().device, items(true));
  assert.ok(glass.water, 'the pass is mounted on the code the prepare awaited');
  await families.particles.settled();
  assert.equal(families.particles.arrived, false, 'no particle code for a glass');
});
