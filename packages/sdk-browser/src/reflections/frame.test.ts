import test from 'node:test';
import assert from 'node:assert/strict';
import { reflectionFrame } from './frame.ts';
import { noteShadowFrame } from '../webgpu/pages/state/lights.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';

test('a shadow page landing changes the reflected source epoch without a host mutation', () => {
  const rt = settledRt();
  rt.gpu.reflection = { history: {} } as NonNullable<typeof rt.gpu.reflection>;
  rt.gpu.depthTexture = {} as GPUTexture;
  rt.gpu.surfaces = { normalRough: {} } as NonNullable<typeof rt.gpu.surfaces>;
  rt.vis.visTexture = {} as GPUTexture;
  rt.vis.pageTable = {} as GPUBuffer;
  rt.lights.shadowPagesTotal = 4;
  const previous = reflectionFrame(rt)!.epoch;
  const revisions = { ...rt.run.gate.revisions };
  rt.lights.shadowPages = 2;
  noteShadowFrame(rt.lights);
  assert.deepEqual(rt.run.gate.revisions, revisions);
  assert.notEqual(reflectionFrame(rt)!.epoch, previous);
  const landed = reflectionFrame(rt)!.epoch;
  rt.lights.shadowPages = 0;
  noteShadowFrame(rt.lights);
  assert.equal(reflectionFrame(rt)!.epoch, landed, 'unchanged shadow contents permit convergence');
  const deformation = { revision: 1 };
  rt.vis.deformation = { frame: deformation } as NonNullable<typeof rt.vis.deformation>;
  const pose = reflectionFrame(rt)!.epoch;
  deformation.revision++;
  assert.notEqual(
    reflectionFrame(rt)!.epoch,
    pose,
    'a changed deformation invalidates the reflected source',
  );
  const current = reflectionFrame(rt)!.epoch;
  assert.equal(reflectionFrame(rt)!.epoch, current, 'an unchanged pose permits convergence');
});
