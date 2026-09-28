// #965: opaque shadow casters are drawn with no fragment stage, cutout ones with the fragment test.
// Every draw places its corners through the same `shadowVertex`, so the depth is the same whichever
// draws it; the cull files the two kinds in two lists of one slot; the three pipelines are compiled
// at prepare, and a frame compiles none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import type { WebgpuPagesRuntime } from '../../webgpu/pages/runtime.ts';
import { prepareShadowPipelines } from '../../webgpu/pages/prepare/lights.ts';
import { createGpuShadowAtlas } from './atlas.ts';
import { KEPT_LISTS_WGSL } from './cullShader.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';

type Out = { position: unknown };
type Entry = (vertexIndex: number, instanceIndex: number) => Out;
type Entries = {
  shadow_vs: Entry;
  shadow_depth_vs: (vertexIndex: number, instanceIndex: number) => unknown;
  shadow_cutout_vs: Entry;
};

test('the depth-only draw writes the position the fragment draw writes, from the same row', () => {
  // The shipped entries, attributes aside, over a `shadowVertex` that names what it was given.
  const source = SHADOW_DEPTH_SHADER.replace(/@\w+(?:\([^)]*\))? ?/g, '');
  const instances = Array.from({ length: 16 }, (_, k) => 1000 + k);
  const scope = {
    shadowVertex: (vertex: number, page: number, blended: boolean) => ({
      position: { vertex, page, blended },
    }),
    drawPage: (instance: number) => instances[8 + instance],
    instances,
    slotOffsets: [0, 8, 16],
    uni: { drawSlot: 1 },
  };
  const entries = shaderFunctions<Entries>(
    source,
    ['shadow_vs', 'shadow_depth_vs', 'shadow_cutout_vs', 'cutoutPage'],
    scope,
  );
  for (const [vertex, instance] of [
    [0, 0],
    [5, 3],
    [383, 7],
  ]) {
    const drawn = entries.shadow_vs(vertex, instance).position;
    assert.deepEqual(entries.shadow_depth_vs(vertex, instance), drawn, `${vertex}, ${instance}`);
    assert.deepEqual(drawn, { vertex, page: 1008 + instance, blended: false });
    // The cutout list runs from the slot's end down: its first caster is the slot's last row.
    assert.deepEqual(entries.shadow_cutout_vs(vertex, instance).position, {
      vertex,
      page: 1015 - instance,
      blended: false,
    });
  }
});

type Lists = {
  keptCount: (region: number, cutout: boolean) => number;
  keptAt: (region: number, rank: number, capacity: number, cutout: boolean) => number;
};

test("a region's opaque and cutout casters fill its slot from both ends, counted apart", () => {
  const { keptCount, keptAt } = shaderFunctions<Lists>(KEPT_LISTS_WGSL, ['keptCount', 'keptAt']);
  // Instance counts: the second word of each region's two commands, one after the other.
  assert.deepEqual([keptCount(0, false), keptCount(0, true), keptCount(3, false)], [1, 5, 25]);
  const capacity = 6,
    slot = new Array<string>(3 * capacity).fill('');
  for (let rank = 0; rank < 4; rank++) slot[keptAt(1, rank, capacity, false)] = `o${rank}`;
  for (let rank = 0; rank < 2; rank++) slot[keptAt(1, rank, capacity, true)] = `c${rank}`;
  assert.deepEqual(slot.slice(capacity, 2 * capacity), ['o0', 'o1', 'o2', 'o3', 'c1', 'c0']);
  assert.ok(
    slot.slice(0, capacity).every((row) => !row) && slot.slice(2 * capacity).every((row) => !row),
  );
});

test('the three caster draws are compiled at prepare, and a frame compiles none', async () => {
  const { device, renderPipelines } = fakeDevice();
  const atlas = await createGpuShadowAtlas(device, {} as GPUBindGroupLayout);
  assert.equal(renderPipelines.length, 0, 'nothing compiled before the step');
  const rt = {
    lights: { shadows: atlas, pageQuads: { prepareTransmittance: async () => {} } },
    vis: { gpuDraw: false },
    blendState: { blendGpu: [] },
  } as unknown as WebgpuPagesRuntime;
  await prepareShadowPipelines(rt, device);
  const made = renderPipelines.length;
  const draws = atlas.depthDraws();
  assert.equal(atlas.depthDraws(), draws, 'made once');
  assert.equal(renderPipelines.length, made, 'no pipeline after prepare');
  const shape = (pipeline: GPURenderPipeline) => {
    const { vertex, fragment } = pipeline as unknown as GPURenderPipelineDescriptor;
    return [vertex.entryPoint, fragment?.entryPoint];
  };
  assert.deepEqual(shape(draws.opaque), ['shadow_depth_vs', undefined], 'no fragment stage');
  assert.deepEqual(shape(draws.envelope), ['shadow_vs', 'shadow_fs']);
  assert.deepEqual(shape(draws.cutout), ['shadow_cutout_vs', 'shadow_fs']);
});
