import test from 'node:test';
import assert from 'node:assert/strict';
import { packPartitionUniform, type PartitionFrame } from './uniform.ts';
import { PARTITION_UNI_WGSL } from '../core/boxProjectWgsl.ts';
import { UNIFORM_U32, UNI_SCALARS } from './contract.ts';

const frame = (flags: Pick<PartitionFrame, 'hasRest' | 'viewMoved'>): PartitionFrame => ({
  view: new Float64Array(16),
  viewProj: new Float64Array(16),
  anchor: [0, 0, 0],
  near: 0.1,
  rows: 3,
  width: 8,
  height: 8,
  levels: [],
  layerTop: 2,
  ...flags,
});

test('the scalar words land where the WGSL uniform names them', () => {
  // The struct declares the scalars in order from `rows`; the kernels read each by name.
  const declared =
    /rows:u32,width:u32,height:u32,levels:u32,\n layerTop:u32,hasRest:u32,viewMoved:u32,pad2:u32,/;
  assert.match(PARTITION_UNI_WGSL, declared);
  const words = new Uint32Array(UNIFORM_U32),
    floats = new Float32Array(words.buffer);
  const scalars = () => [...words.subarray(UNI_SCALARS, UNI_SCALARS + 9)];
  packPartitionUniform(words, floats, frame({ hasRest: true, viewMoved: false }), 3);
  assert.deepEqual(scalars(), [3, 8, 8, 0, 2, 1, 0, 0, 0]);
  packPartitionUniform(words, floats, frame({ hasRest: false, viewMoved: true }), 3);
  assert.deepEqual(scalars(), [3, 8, 8, 0, 2, 0, 1, 0, 0]);
});

test('the uniform struct names each member once: a duplicate fails to compile in the browser only', () => {
  // Chrome refuses the module, the partition silently gives way to a single pass without
  // occlusion, and Node would never know: the names are checked here.
  const members = [...PARTITION_UNI_WGSL.matchAll(/(\w+):(?=mat4x4f|vec3f|f32|u32|array)/g)].map(
    (match) => match[1],
  );
  assert.ok(members.length >= 14);
  assert.deepEqual(
    members.filter((name, index) => members.indexOf(name) !== index),
    [],
    'no member declared twice',
  );
});
