// #989: one capacity contract. The arrays, strides and uniform layouts the shadow shaders declare
// are the host's own constants — parsed from the generated WGSL —, and the bounds a device's limits
// select stay within them, on a small device as on a large one. A face with nothing to cull
// encodes no pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DAG_UNIFORM_BYTES, DAG_VIEWS_WGSL } from '../dag/shader/viewsWgsl.ts';
import { lightCutCapacity } from '../dag/lightCutCapacity.ts';
import { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS, SHADOW_FACE_READ_WORDS } from './recordPack.ts';
import {
  CULL_UNIFORM_WORDS,
  LIGHT_CULL_UNIFORM_WORDS,
  MAX_SHADOW_BATCHES,
  OCCLUSION_SLOT_WORDS,
  OCCLUSION_UNIFORM_WORDS,
  SHADOW_COMMAND_WORDS,
  SHADOW_FACE_STRIDE,
  shadowBatchCapacity,
} from './batchBudget.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';
import { SHADOW_OCCLUSION_SHADER } from './occlusionShader.ts';
import { PAGE_QUAD_SHADER } from './pageQuads.ts';
import { createGpuShadowCull, type ShadowCullSource } from './cull.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** The first integer `pattern` captures in `wgsl`. */
const read = (wgsl: string, pattern: RegExp) => Number(wgsl.match(pattern)![1]);
/** Words of struct `name` in `wgsl`, whose fields are 32-bit scalars and `vec3f`s each followed by
 *  a scalar — the only shapes the shadow uniforms use. */
const words = (wgsl: string, name: string) =>
  wgsl
    .match(new RegExp(`struct ${name}\\{([^}]*)\\}`))![1]
    .split(',')
    .filter(Boolean)
    .reduce((sum, field) => sum + (field.endsWith('vec3f') ? 3 : 1), 0);

test('the shaders declare the contract: views, regions, strides and uniform words', () => {
  assert.equal(read(DAG_VIEWS_WGSL, /const MAX_VIEWS:u32=(\d+)u/), MAX_SHADOW_PAGES);
  assert.equal(read(SHADOW_LIGHT_CULL_SHADER, /faces:array<Face,(\d+)>/), MAX_SHADOW_REGIONS);
  assert.equal(read(PAGE_QUAD_SHADER, /views:array<PageView,(\d+)>/), MAX_SHADOW_REGIONS);
  assert.equal(read(PAGE_QUAD_SHADER, /order:array<u32,(\d+)>/), MAX_SHADOW_REGIONS);
  // A page view is what the depth pass reads — matrix, `params`, `emitter` — then `rect`, sized
  // to the stride.
  const rect = read(PAGE_QUAD_SHADER, /@size\((\d+)\) rect/);
  assert.equal(SHADOW_FACE_READ_WORDS * 4 + rect, SHADOW_FACE_STRIDE);
  assert.equal(read(SHADOW_OCCLUSION_SHADER, /struct View\{@size\((\d+)\)/), SHADOW_FACE_STRIDE);
  assert.equal(words(SHADOW_CULL_SHADER, 'Face'), SHADOW_CULL_FLOATS);
  assert.equal(words(SHADOW_CULL_SHADER, 'Uni'), CULL_UNIFORM_WORDS);
  assert.equal(words(SHADOW_LIGHT_CULL_SHADER, 'Uni'), LIGHT_CULL_UNIFORM_WORDS);
  assert.equal(words(SHADOW_OCCLUSION_SHADER, 'Uni'), OCCLUSION_UNIFORM_WORDS);
  assert.equal(read(SHADOW_CULL_SHADER, /indirect\[face\*(\d+)u\+1u\]/), SHADOW_COMMAND_WORDS);
  assert.equal(read(SHADOW_OCCLUSION_SHADER, /indirect\[r\*(\d+)u\+1u\]/), SHADOW_COMMAND_WORDS);
  assert.equal(read(SHADOW_OCCLUSION_SHADER, /slots\[r\*(\d+)u\]/), OCCLUSION_SLOT_WORDS);
});

/** A light cut's shape: one level of nodes over its clusters. */
const SHAPE = {
  worldCount: 64,
  nodeCount: 4096,
  pageCount: 65536,
  blockCount: 1024,
  levelSizes: [1, 64, 4096],
  frames: { per: 64 },
};
const DEVICES = {
  // WebGPU's guaranteed minimums.
  small: {
    maxComputeWorkgroupsPerDimension: 65535,
    maxStorageBufferBindingSize: 128 << 20,
    maxBufferSize: 256 << 20,
    maxUniformBufferBindingSize: 16384,
  },
  large: {
    maxComputeWorkgroupsPerDimension: 65535,
    maxStorageBufferBindingSize: 2 ** 32 - 4,
    maxBufferSize: 2 ** 34,
    maxUniformBufferBindingSize: 65536,
  },
};

for (const [size, limits] of Object.entries(DEVICES))
  test(`what a ${size} device's limits select stays within the shaders' capacities`, () => {
    const views = lightCutCapacity(limits, SHAPE);
    assert.ok(views >= 1 && views <= read(DAG_VIEWS_WGSL, /const MAX_VIEWS:u32=(\d+)u/));
    // The uniform arrays a batch binds: every view's block, every region's cull volume.
    assert.ok(DAG_UNIFORM_BYTES <= limits.maxUniformBufferBindingSize);
    assert.ok(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS * 4 <= limits.maxUniformBufferBindingSize);
    for (const pool of [1, 4096, 65536]) {
      const { batches, stagingBytes } = shadowBatchCapacity(pool, views, limits.maxBufferSize);
      assert.ok(batches >= 1 && batches <= MAX_SHADOW_BATCHES);
      assert.ok(stagingBytes <= limits.maxBufferSize);
    }
  });

test('a face whose casters list is empty encodes no cull pass', async () => {
  const { device } = fakeDevice(),
    cull = await createGpuShadowCull(device, 64);
  const passes: string[] = [];
  const encoder = {
    beginComputePass: () => (
      passes.push('cull'),
      { setBindGroup() {}, setPipeline() {}, dispatchWorkgroups() {}, end() {} }
    ),
  } as unknown as GPUCommandEncoder;
  const buffer = device.createBuffer({ size: 64, usage: 0 });
  const source: ShadowCullSource = {
    spheres: buffer,
    mobility: buffer,
    source: buffer,
    base: 0,
    indirect: buffer,
    indirectBase: 0,
    commands: 1,
  };
  cull.begin(2, 3);
  cull.encode(encoder, source, 0, 0, 2, 0);
  assert.deepEqual(passes, [], 'nothing listed: the regions keep the zero instances begin wrote');
  cull.encode(encoder, source, 1, 0, 2, 5);
  assert.deepEqual(passes, ['cull']);
  cull.dispose();
});
