// The narrow resolve (#849): a scene of at most `TILE_LIGHTS` lights is lit by a program whose light
// array is that long, and never a wider scene by it; its cells' lists are in the pool as a wide
// scene's (#1369), walked by the same loop. A scene with no shadow slot by the program with no
// shadow code (#1249).
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { contractLightingShader } from './shaders.ts';
import { createDeferredLighting } from './deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test("the narrow resolve bounds its light array, the rest of its program the wide one's", () => {
  for (const bounce of [false, true]) {
    const narrow = contractLightingShader(bounce, true),
      wide = contractLightingShader(bounce, false);
    assert.match(narrow, new RegExp(`items:array<DirectLight,${LIGHT_SETTINGS.tileLights}>`));
    assert.match(wide, /items:array<DirectLight>/);
    // That both give the same sum, bit for bit, runs on the GPU:
    // `tests/browser/probes/narrow-resolve-gpu.ts`.
    const outside = (code: string) => code.replace(/items:array<DirectLight(,\d+)?>/, '');
    assert.equal(outside(narrow), outside(wide));
  }
});

/** The frames of `lighting`, each lit with `direct`, and the label of each program drawn with. */
function recorder(lighting: Awaited<ReturnType<typeof createDeferredLighting>>) {
  const labels: string[] = [];
  const encoder = {
    beginRenderPass: () => ({
      setPipeline: (pipeline: GPURenderPipelineDescriptor) =>
        labels.push(pipeline.fragment!.module.label),
      setBindGroup() {},
      setViewport() {},
      draw() {},
      end() {},
    }),
  } as unknown as GPUCommandEncoder;
  const views = [0, 1, 2, 3].map(() => ({}) as GPUTextureView),
    surface = { views: () => views } as unknown as SurfaceBuffer,
    view = {} as GPUTextureView;
  const draw = (direct: { narrow?: boolean; unshadowed?: boolean }) => {
    lighting.bind(surface, view, view, true, { lights: {} as GPUBuffer, ...direct });
    if (lighting.usesContract) lighting.light(encoder, view);
    return lighting.usesContract;
  };
  return { labels, draw };
}

test('a narrow scene is lit by the narrow program, a wide one never is', async () => {
  const { device } = fakeDevice();
  const lighting = await createDeferredLighting(device);
  const { labels, draw } = recorder(lighting);
  const frame = (narrow: boolean) => draw({ narrow });
  assert.equal(frame(true), false, 'unlit while the narrow program compiles');
  await lighting.settle();
  assert.equal(frame(true), true);
  // The wide twin compiled beside the narrow one: a scene past the lists is lit at once, and
  // never by the narrow program.
  assert.equal(frame(false), true, 'the wide twin is ready with the narrow program');
  assert.equal(frame(true), true);
  assert.deepEqual(labels, ['DIRECT_NARROW_LIGHTING', 'DIRECT_LIGHTING', 'DIRECT_NARROW_LIGHTING']);
  lighting.dispose();
});

test('a scene with no shadow slot is lit with no shadow code, a shadowed one never is (#1249)', async () => {
  const unshadowed = contractLightingShader(false, false, undefined, false);
  assert.doesNotMatch(unshadowed, /shade=shadowFactor\(|shadowTransmission;/, 'no shadow read');
  assert.match(contractLightingShader(false, false), /let shade=shadowFactor\(/);
  const { device } = fakeDevice();
  const lighting = await createDeferredLighting(device);
  const { labels, draw } = recorder(lighting);
  const frame = (unshadowed: boolean) => draw({ unshadowed });
  frame(true);
  await lighting.settle();
  // The twin with shadow code compiled beside it: a light that takes a shadow is lit at once.
  frame(true);
  frame(false);
  frame(true);
  assert.deepEqual(labels, [
    'DIRECT_UNSHADOWED_LIGHTING',
    'DIRECT_LIGHTING',
    'DIRECT_UNSHADOWED_LIGHTING',
  ]);
  lighting.dispose();
});
