// The CPU half of the WebGPU particle step (#420): a still frame is held until one of the world's
// pools moves. What the GPU does with the pools is the recette's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { holdWebgpuFrame, keepWebgpuFrame } from '../webgpu/frame/hold.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';

test("WebGPU: a still frame is held until one of the world's pools moves", () => {
  const rt = settledRt(),
    { device } = fakeDevice();
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  assert.equal(holdWebgpuFrame(rt, device), true, 'still, and no pool: held');
  const idle = new ParticlePool({ capacity: 8 });
  Object.assign(rt.context, { particles: [idle] });
  assert.equal(holdWebgpuFrame(rt, device), true, 'an idle pool changes nothing');
  idle.emit(0, 0, 0, 0, 1, 0, 2);
  assert.equal(holdWebgpuFrame(rt, device), false, 'a moving one does');
  assert.equal(rt.run.frameHeld, false);
});
