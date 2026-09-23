import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuRestCompact } from './restCompact.ts';
import { REST_COMPACT_SHADER } from './restCompactWgsl.ts';
import { VIS_SHADER } from '../../visibility/buffer.ts';
import { BASE_SLOTS } from '../draw/draw.ts';
import { HIZ_REJECTED_WGSL, VERDICT_REJECTED } from '../partition/contract.ts';

// Behaviour 1: truncation keeps EXACTLY what the vertex stage drew — both texts carry the same
// `hizRejected`, and truncation keeps its negation. A hand-copied predicate had truncated the
// whole tested half when the verdict moved to three values.
test('tested-half truncation applies the vertex-stage predicate', () => {
  assert.ok(VIS_SHADER.includes(HIZ_REJECTED_WGSL), 'the vertex stage binds the shared predicate');
  assert.ok(REST_COMPACT_SHADER.includes(HIZ_REJECTED_WGSL), 'truncation binds the same text');
  assert.match(VIS_SHADER, /if\(hizRejected\(page\.hizSlot\)\)/);
  assert.match(REST_COMPACT_SHADER, /return !hizRejected\(pages\[ligne\]\.hizSlot\);/);
  assert.match(HIZ_REJECTED_WGSL, new RegExp(`==${VERDICT_REJECTED}u;`));
});

// Behaviour 2: nothing is moved. The last survivor's rank becomes the count, so the order of
// the kept instances is the one the draw compact gave them.
test('truncation moves no instance and only touches the count', () => {
  assert.match(REST_COMPACT_SHADER, /atomicMax\(&dernieres\[id\.y\],id\.x\+1u\)/);
  assert.match(REST_COMPACT_SHADER, /indirect\[restSlotAt\(id\.x\)\*4u\+1u\]=atomicLoad/);
  assert.match(REST_COMPACT_SHADER, /@binding\(0\) var<storage, read> instances/);
  // Word 0 of the command, the vertex count, is never rewritten.
  assert.doesNotMatch(REST_COMPACT_SHADER, /indirect\[[^\]]*\*4u\]=/);
});

// Behaviour 3: the rank of tested slot number n follows the `slotOf` convention — three face
// modes per layer, the tested half after the occluders.
test('visited slots are those of the tested half', () => {
  const half = BASE_SLOTS / 2;
  assert.match(
    REST_COMPACT_SHADER,
    new RegExp(`return \\(n/${half}u\\)\\*${BASE_SLOTS}u\\+${half}u\\+n%${half}u;`),
  );
});

// Behaviour 4: without compute there is no truncation and the frame keeps the previous path.
test('a device without compute does not mount truncation', async () => {
  const buffer = {} as GPUBuffer;
  const device = { createBuffer: () => buffer } as unknown as GPUDevice;
  const made = await createGpuRestCompact(device, {
    instances: buffer,
    indirect: buffer,
    slotOffsets: buffer,
    flags: buffer,
  });
  assert.equal(made, undefined);
});
