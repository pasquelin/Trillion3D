// The narrow resolve (#849): a scene of at most `TILE_LIGHTS` lights is lit by a program whose light
// array is that long and whose slice loop has no branch, and never a wider scene by it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { contractLightingShader } from './shaders.ts';
import { createDeferredLighting } from './deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** The text of the WGSL function `name` in `code`, up to the next top-level function. */
const functionText = (code: string, name: string) =>
  code.slice(code.indexOf(`fn ${name}(`)).split(/\n(?:fn |\/\*\*)/)[0];

test('the narrow resolve bounds its light array and walks its list with no branch', () => {
  for (const bounce of [false, true]) {
    const narrow = contractLightingShader(bounce, true),
      wide = contractLightingShader(bounce, false);
    assert.match(narrow, new RegExp(`items:array<DirectLight,${LIGHT_SETTINGS.tileLights}>`));
    assert.match(wide, /items:array<DirectLight>/);
    const loop = functionText(narrow, 'sliceLighting');
    assert.doesNotMatch(loop, /if\(|TILE_NO_SLICE|select\(/, 'no per-light branch');
    assert.match(loop, /directLights\.items\[tileLights\[slice\.x\+index\]\]/);
    assert.doesNotMatch(functionText(narrow, 'tileSlice'), /TILE_NO_SLICE|if\(/);
    // The wide loop keeps the pool and the whole-scene walk; the rest of the program is the same
    // (the sampled, bounce and fog paths the GPU probe does not run). That both loops give the
    // same sum, bit for bit, runs on the GPU: `tests/browser/probes/narrow-resolve-gpu.ts`.
    assert.match(functionText(wide, 'sliceLighting'), /TILE_NO_SLICE/);
    const outside = (code: string) =>
      code
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(functionText(code, 'tileSlice'), '')
        .replace(functionText(code, 'sliceLighting'), '')
        .replace(/items:array<DirectLight(,\d+)?>/, '')
        .replace(/\n+/g, '\n');
    assert.equal(outside(narrow), outside(wide));
  }
});

test('a narrow scene is lit by the narrow program, a wide one never is', async () => {
  const { device } = fakeDevice();
  const lighting = await createDeferredLighting(device);
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
    lights = {} as GPUBuffer,
    view = {} as GPUTextureView;
  const frame = (narrow: boolean) => {
    lighting.bind(surface, view, view, true, { lights, narrow });
    if (lighting.usesContract) lighting.light(encoder, view);
    return lighting.usesContract;
  };
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
