// #989: each word a shadow cull's host writes into its uniform is the one its shader reads under
// that name. The struct is generated from the host's word count (`wordStruct`), so its size cannot
// disagree; what can is the order: a host writing `faces` where the shader reads `firstFace`. Each
// test encodes one call with distinct values and reads them back by the shader's field names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, written, type FakeWrite } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { PAGE_BIND_ALIGN } from '../draw/contract.ts';
import type { DrawnLog } from '../dag/types.ts';
import {
  CULL_UNIFORM_WORDS,
  LIGHT_CULL_UNIFORM_WORDS,
  OCCLUSION_UNIFORM_WORDS,
} from './batchBudget.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';
import { SHADOW_OCCLUSION_SHADER } from './occlusionShader.ts';
import { createGpuShadowCull } from './cull.ts';
import { createShadowLightCull } from './lightCull.ts';
import { createShadowOcclusion } from './occlusion.ts';

/** The fields of struct `Uni` in `wgsl`, in order, padding included. */
const uniFields = (wgsl: string) =>
  wgsl
    .match(/struct Uni\{([^}]*)\}/)![1]
    .split(',')
    .filter(Boolean)
    .map((field) => field.split(':')[0]);

/** Asserts that `write` carries `words` words, `expected[name]` at the word of field `name` of the
 *  shader's `Uni`, and that the shader's named fields are exactly those, each read by it. */
function agrees(wgsl: string, write: FakeWrite | undefined, words: number, expected: object) {
  assert.ok(write, 'the uniform was written');
  const data = [...written(write)],
    fields = uniFields(wgsl),
    named = fields.filter((field) => !/^pad\d+$/.test(field));
  assert.equal(data.length, words, 'the host writes every word the binding holds');
  assert.deepEqual(named, Object.keys(expected), 'every field the shader declares is written');
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(data[fields.indexOf(name)], value, `${name} at the word the shader reads`);
    assert.match(wgsl, new RegExp(`uni\\.${name}\\b`), `${name} is read by the shader`);
  }
}

/** A compute pass and an encoder that accept whatever the culls encode. */
const pass = {
  setBindGroup() {},
  setPipeline() {},
  dispatchWorkgroups() {},
  dispatchWorkgroupsIndirect() {},
  end() {},
};
const encoder = {
  beginComputePass: () => pass,
  copyBufferToBuffer() {},
} as unknown as GPUCommandEncoder;

test("the CPU lists' cull writes each Uni field at the word its shader reads", async () => {
  const { device, writes } = fakeDevice();
  const cull = await createGpuShadowCull(device, 64);
  const buffer = device.createBuffer({ size: 64, usage: 0 });
  const source = { spheres: buffer, mobility: buffer, source: buffer, indirect: buffer };
  cull.begin(3);
  // Run 1: its uniform sits one dynamic-offset stride in.
  cull.encode(encoder, { ...source, base: 13, indirectBase: 14, commands: 15 }, 1, 11, 2, 5);
  agrees(
    SHADOW_CULL_SHADER,
    writes.findLast(({ offset }) => offset === PAGE_BIND_ALIGN),
    CULL_UNIFORM_WORDS,
    { firstFace: 11, faces: 2, sourceBase: 13, indirectBase: 14, commands: 15, capacity: 64 },
  );
  cull.dispose();
});

test("the light cut's cull writes each Uni field at the word its shader reads", async () => {
  const { device, writes } = fakeDevice();
  const buffer = device.createBuffer({ size: 64, usage: 0 });
  const targets = { kept: buffer, indirect: buffer, faces: buffer, capacity: 1024 };
  const cull = await createShadowLightCull(device, targets);
  const log: DrawnLog = {
    buffer,
    offset: 3,
    work: buffer,
    offsetWord: 4,
    countWord: 8,
    groupsWord: 12,
  };
  const source = {
    spheres: buffer,
    mobility: buffer,
    items: buffer,
    rowOf: buffer,
    log,
    blendFirst: 70,
    blendEnd: 90,
    refreshRows() {},
  };
  cull.encode(encoder, source, 2, 100);
  agrees(
    SHADOW_LIGHT_CULL_SHADER,
    writes.find(({ buffer: { size } }) => size === LIGHT_CULL_UNIFORM_WORDS * 4),
    LIGHT_CULL_UNIFORM_WORDS,
    {
      logBase: 3,
      offsetWord: 4,
      countWord: 8,
      capacity: 1024,
      rows: 100,
      blendFirst: 70,
      blendEnd: 90,
    },
  );
  cull.dispose();
});

test('the occlusion test writes each Uni field at the word its shader reads', async () => {
  const { device, writes } = fakeDevice();
  const occlusion = await createShadowOcclusion(device, 32);
  const buffer = device.createBuffer({ size: 64, usage: 0 });
  const inputs = {
    spheres: buffer,
    kept: buffer,
    indirect: buffer,
    views: buffer,
    pyramid: buffer,
  };
  occlusion.encode(encoder, inputs, 3, () => 0, 10, 1);
  agrees(
    SHADOW_OCCLUSION_SHADER,
    writes.find(({ buffer: { size } }) => size === OCCLUSION_UNIFORM_WORDS * 4),
    OCCLUSION_UNIFORM_WORDS,
    { regions: 3, capacity: 32 },
  );
  occlusion.dispose();
});
