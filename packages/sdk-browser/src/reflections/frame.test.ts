import test from 'node:test';
import assert from 'node:assert/strict';
import { noteShadowFrame } from '../webgpu/pages/render/encodeShadowBatches.ts';
import { settledRt } from '../webgpu/frame/hold.fixture.ts';
import { createShadowPlan } from '../../../sdk-core/src/scene/light-shadow/plan.ts';
import { reflectionFrame } from './reflectionFrame.ts';

/** The source versions a frame carries, copied: the frame's own array is rewritten in place. */
const epochOf = (rt: Parameters<typeof reflectionFrame>[0]) => [...reflectionFrame(rt)!.epoch];
const lightingOf = (rt: Parameters<typeof reflectionFrame>[0]) => [
  ...reflectionFrame(rt)!.lighting,
];

/** A settled runtime with every surface its reflection reads, 4 shadow pages drawn so far. */
function reflectingRt() {
  const rt = settledRt();
  rt.gpu.reflection = { active: true } as NonNullable<typeof rt.gpu.reflection>;
  rt.gpu.depthTexture = {} as GPUTexture;
  rt.gpu.surfaces = { normalRough: {} } as NonNullable<typeof rt.gpu.surfaces>;
  rt.vis.visTexture = {} as GPUTexture;
  rt.vis.visView = {} as GPUTextureView;
  rt.vis.pageTable = {} as GPUBuffer;
  rt.lights.shadowPagesTotal = 4;
  return rt;
}

test('a shadow page landing changes the reflected source epoch without a host mutation', () => {
  const rt = reflectingRt();
  const previous = epochOf(rt);
  const lighting = lightingOf(rt);
  const revisions = { ...rt.run.gate.revisions };
  rt.lights.shadowPages = 2;
  noteShadowFrame(rt.lights);
  assert.deepEqual(rt.run.gate.revisions, revisions);
  assert.notDeepEqual(epochOf(rt), previous);
  // #1342: a shadow page follows a placement or the camera; only lights and materials relight.
  assert.deepEqual(lightingOf(rt), lighting, 'a shadow page keeps the lighting');
  const landed = epochOf(rt);
  rt.lights.shadowPages = 0;
  noteShadowFrame(rt.lights);
  assert.deepEqual(epochOf(rt), landed, 'unchanged shadow contents permit convergence');
  const deformation = { revision: 1 };
  rt.vis.deformation = { frame: deformation } as NonNullable<typeof rt.vis.deformation>;
  const pose = epochOf(rt);
  deformation.revision++;
  assert.notDeepEqual(epochOf(rt), pose, 'a changed deformation invalidates the reflected source');
  const current = epochOf(rt);
  assert.deepEqual(epochOf(rt), current, 'an unchanged pose permits convergence');
});

test('pages the GPU draws itself change the reflected source epoch, a lost snapshot included', () => {
  const rt = reflectingRt();
  const plan = (rt.lights.plan = createShadowPlan(4)),
    // A frame's snapshot: the pages it listed, and those every frame listed since the seed.
    snapshot = (drawn: number, listings: number) =>
      ({
        frame: 0,
        pool: { owner: new Int32Array(0), requested: new Int32Array(0), drawn, listings },
      }) as unknown as Parameters<typeof plan.gpu.hear>[0];
  const before = epochOf(rt);
  plan.gpu.hear(snapshot(3, 3));
  const landed = epochOf(rt);
  assert.notDeepEqual(landed, before, 'the GPU drew pages the host never drew');
  plan.gpu.hear(snapshot(0, 3));
  assert.deepEqual(epochOf(rt), landed, 'a snapshot that lists none permits convergence');
  // Frame 3 listed 2 pages; its snapshot never came back (every readback slot busy, or replaced).
  plan.gpu.hear(snapshot(0, 5));
  const lost = epochOf(rt);
  assert.notDeepEqual(lost, landed, 'the next snapshot shows the draw its lost one listed');
  plan.resize(plan.pool.side, plan.pool.layers);
  assert.deepEqual(epochOf(rt), lost, 'a resized pool keeps the count');
});
