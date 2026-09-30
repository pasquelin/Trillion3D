import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredLighting } from './deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { contractLighting, gpuHarness } from './contractLighting.fixture.ts';

test('composition presents and preserves the capture target in one fullscreen draw', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device);
  const capture = h.view(),
    presentation = h.view(),
    clear: GPUColor = [0.1, 0.2, 0.3, 1];
  lighting.bind(h.surface, h.view(), h.view(), false);
  lighting.compose(h.encoder, capture, clear, presentation);
  assert.equal(h.passes.length, 1);
  const pass = h.passes[0],
    attachments = Array.from(pass.descriptor.colorAttachments);
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0]!.view, capture);
  assert.equal(attachments[1]!.view, presentation);
  assert.ok(
    attachments.every((attachment) => attachment!.storeOp === 'store'),
    'both images must survive the composition pass',
  );
  assert.deepEqual(pass.draws, [3]);
  assert.equal(pass.ended, true);
  // The fake's render pipeline is its descriptor.
  const descriptor = pass.pipeline as unknown as GPURenderPipelineDescriptor;
  assert.deepEqual(
    Array.from(descriptor.fragment!.targets).map((target) => target!.format),
    ['rgba8unorm', 'bgra8unorm'],
  );
  assert.ok(
    Array.from(descriptor.fragment!.targets).every((target) => !target!.blend),
    'no additional blending may change either output',
  );
  lighting.dispose();
});

test('composition without presentation keeps its capture-only output and clear color', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device);
  const capture = h.view(),
    clear: GPUColor = [0.1, 0.2, 0.3, 1];
  lighting.bind(h.surface, h.view(), h.view(), false);
  lighting.compose(h.encoder, capture, clear);
  assert.equal(h.passes.length, 1);
  const pass = h.passes[0];
  assert.deepEqual(Array.from(pass.descriptor.colorAttachments), [
    { view: capture, loadOp: 'clear', storeOp: 'store', clearValue: clear },
  ]);
  assert.deepEqual(
    Array.from((pass.pipeline as unknown as GPURenderPipelineDescriptor).fragment!.targets).map(
      (target) => target!.format,
    ),
    ['rgba8unorm'],
  );
  assert.deepEqual(pass.draws, [3]);
  assert.equal(pass.ended, true);
  lighting.dispose();
});

test('diagnostic composition retains the display-space flag and unbound calls fail before encoding', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device),
    target = h.view();
  assert.throws(
    () => lighting.compose(h.encoder, target, [0, 0, 0, 1], h.view()),
    /SURFACE_NOT_BOUND/,
  );
  assert.equal(h.passes.length, 0);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  lighting.update(matrix, [1, 2, 3], 800, 600, 0x204060, true);
  assert.deepEqual([...h.writes[0].slice(20, 24)], [800, 600, 1, 0]);
  lighting.update(matrix, [1, 2, 3], 800, 600, 0x204060, false);
  assert.deepEqual([...h.writes[1].slice(20, 24)], [800, 600, 0, 0]);
  lighting.bind(h.surface, h.view(), h.view(), false);
  lighting.dispose();
  assert.equal(h.destroyed, true);
  assert.throws(
    () => lighting.compose(h.encoder, target, [0, 0, 0, 1], h.view()),
    /SURFACE_NOT_BOUND/,
  );
  assert.equal(h.passes.length, 0);
});

test('the rank of a sampled image rides in the fourth viewport slot, zero without one', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device),
    matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  lighting.update(matrix, [1, 2, 3], 800, 600, 0x204060, false, [3, 2, 1, 1], 7);
  assert.deepEqual([...h.writes[0].slice(20, 24)], [800, 600, 0, 7]);
  assert.deepEqual([...h.writes[0].slice(28, 32)], [3, 2, 1, 1]);
  lighting.update(matrix, [1, 2, 3], 800, 600, 0x204060, false);
  assert.deepEqual([...h.writes[1].slice(20, 24)], [800, 600, 0, 0]);
  lighting.dispose();
});

test('an image is composed with the share it read, one group per pair (#349)', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device);
  const hdr = h.view();
  lighting.bind(h.surface, h.view(), hdr, false);
  // The two TAA histories, each its colour beside its share, written in turn.
  const images = [0, 1].map(() => ({ color: h.view(), share: h.view() }));
  for (let frame = 0; frame < 4; frame++)
    lighting.compose(h.encoder, h.view(), [0, 0, 0, 1], undefined, images[frame % 2]);
  for (let frame = 0; frame < 2; frame++) lighting.compose(h.encoder, h.view(), [0, 0, 0, 1]);
  // A new surface under the same lit image: its flags are read, not the old surface's.
  const flags = [h.view(), h.view(), h.view(), h.view()],
    resized = { views: () => flags } as unknown as SurfaceBuffer;
  lighting.bind(resized, h.view(), hdr, false);
  lighting.compose(h.encoder, h.view(), [0, 0, 0, 1]);
  // The effect chain's target without TAA has no share of its own: it reads the flags.
  const target = h.view();
  lighting.compose(h.encoder, h.view(), [0, 0, 0, 1], undefined, { color: target });
  // A composition group reads three resources; the lighting groups read more.
  const composed = h.bindGroups
    .map((group) => Array.from(group.entries))
    .filter((entries) => entries.length === 3);
  assert.equal(composed.length, 5, 'each history, the lit image, its new flags, the effect target');
  assert.deepEqual(
    composed.map((entries) => [entries[0]!.resource, entries[2]!.resource]),
    [
      [images[0].color, images[0].share],
      [images[1].color, images[1].share],
      [hdr, h.surface.views()[3]],
      [hdr, flags[3]],
      [target, flags[3]],
    ],
  );
  lighting.dispose();
});

test('the light group is made again when the shadow data buffer is replaced (#1345)', async () => {
  // A second shadow-casting light grows the page table: its buffer is replaced (`shadowData.ts`).
  const h = await contractLighting(),
    lights = {} as GPUBuffer,
    [held, grown] = [{}, {}] as GPUBuffer[];
  const slicesRead = () =>
    h.bindGroups
      .map((group) => Array.from(group.entries).find((entry) => entry.binding === 8))
      .filter((entry) => entry)
      .map((entry) => (entry!.resource as GPUBufferBinding).buffer);
  h.lighting.bind(h.surface, h.target, h.target, true, { lights, slices: held });
  h.lighting.bind(h.surface, h.target, h.target, true, { lights, slices: held });
  h.lighting.bind(h.surface, h.target, h.target, true, { lights, slices: grown });
  assert.deepEqual(
    slicesRead().slice(-2),
    [held, grown],
    'made once per buffer, the grown one read',
  );
  h.lighting.dispose();
});
