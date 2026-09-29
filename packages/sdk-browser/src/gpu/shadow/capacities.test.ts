// #989: one capacity contract. The arrays, strides and uniform layouts the shadow shaders declare
// are the host's own constants — parsed from the generated WGSL —, and the bounds a device's limits
// select stay within them, on a small device as on a large one. A face with nothing to cull, and a
// batch with no region, encode no pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DAG_UNIFORM_BYTES, DAG_VIEWS_WGSL } from '../dag/shader/viewsWgsl.ts';
import { lightCutCapacity } from '../dag/lightCutCapacity.ts';
import { MAX_SHADOW_PAGES, MAX_SHADOW_REGIONS, SHADOW_FACE_READ_WORDS } from './recordPack.ts';
import {
  MAX_SHADOW_BATCHES,
  OCCLUSION_SLOT_WORDS,
  SHADOW_FACE_STRIDE,
  SHADOW_REGION_COMMANDS,
  shadowBatchCapacity,
} from './batchBudget.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';
import { SHADOW_OCCLUSION_SHADER } from './occlusionShader.ts';
import { PAGE_QUAD_SHADER } from './pageQuads.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { createGpuShadowCull, type ShadowCullSource } from './cull.ts';
import { DRAW_INDIRECT_WORDS } from '../draw/contract.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** The first integer `pattern` captures in `wgsl`. */
const read = (wgsl: string, pattern: RegExp) => Number(wgsl.match(pattern)![1]);
/** Words of struct `name` in `wgsl`, whose fields are 32-bit scalars, `mat4x4f`s, `vec4f`s and
 *  `vec3f`s each followed by a scalar — the only shapes the shadow uniforms use. */
const SIZES: Record<string, number> = { mat4x4f: 16, vec4f: 4, vec3f: 3 };
const words = (wgsl: string, name: string) =>
  wgsl
    .match(new RegExp(`struct ${name}\\{([^}]*)\\}`))![1]
    .split(',')
    .filter(Boolean)
    .reduce((sum, field) => sum + (SIZES[field.split(':')[1]] ?? 1), 0);

test('the shaders declare the contract: views, regions, strides and uniform words', () => {
  assert.equal(read(DAG_VIEWS_WGSL, /const MAX_VIEWS:u32=(\d+)u/), MAX_SHADOW_PAGES);
  assert.equal(read(SHADOW_LIGHT_CULL_SHADER, /faces:array<Face,(\d+)>/), MAX_SHADOW_REGIONS);
  assert.equal(read(PAGE_QUAD_SHADER, /views:array<PageView,(\d+)>/), MAX_SHADOW_REGIONS);
  assert.equal(read(PAGE_QUAD_SHADER, /order:array<u32,(\d+)>/), MAX_SHADOW_REGIONS);
  // A page view is what the depth pass reads — matrix, `params`, `emitter` — then `rect`, sized
  // to the stride.
  const rect = read(PAGE_QUAD_SHADER, /@size\((\d+)\) rect/);
  assert.equal(SHADOW_FACE_READ_WORDS * 4 + rect, SHADOW_FACE_STRIDE);
  assert.equal(words(SHADOW_DEPTH_SHADER, 'ShadowView'), SHADOW_FACE_READ_WORDS);
  assert.equal(read(SHADOW_OCCLUSION_SHADER, /struct View\{@size\((\d+)\)/), SHADOW_FACE_STRIDE);
  assert.equal(words(SHADOW_CULL_SHADER, 'Face'), SHADOW_CULL_FLOATS);
  // The uniforms' words, generated from the host's counts, are checked field by field against
  // what the host writes (`uniformWords.test.ts`).
  // Both lists of a region (#965), in the cull's commands as in the occlusion test's.
  for (const shader of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER, SHADOW_OCCLUSION_SHADER]) {
    assert.equal(read(shader, /\(region\*(\d+)u\+select/), SHADOW_REGION_COMMANDS);
    assert.equal(read(shader, /select\(0u,1u,cutout\)\)\*(\d+)u\+1u/), DRAW_INDIRECT_WORDS);
  }
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

test('an empty face, an empty list or an empty batch encodes no cull pass and writes nothing', async () => {
  const { device, writes } = fakeDevice(),
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
  // The light cut's cull of no region: its log and rows are never read.
  const log = { buffer, offset: 0, work: buffer, offsetWord: 0, countWord: 0, groupsWord: 0 };
  const light = { spheres: buffer, mobility: buffer, items: buffer, rowOf: buffer, log };
  const made = writes.length;
  cull.begin(0, 3);
  cull.encodeLight(encoder, { ...light, blendFirst: 0, blendEnd: 0, refreshRows() {} }, 0, 8);
  assert.equal(writes.length, made, 'a batch of no region writes neither volumes nor commands');
  cull.begin(2, 3);
  cull.encode(encoder, source, 0, 0, 2, 0);
  assert.deepEqual(passes, [], 'nothing listed: the regions keep the zero instances begin wrote');
  cull.encode(encoder, source, 0, 0, 0, 5);
  assert.deepEqual(passes, [], 'no face: nothing to cull');
  cull.encode(encoder, source, 1, 0, 2, 5);
  assert.deepEqual(passes, ['cull']);
  cull.dispose();
});
