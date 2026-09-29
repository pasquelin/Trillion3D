// #1016 review: a masked caster no camera pixel sees asked for no tile, and its shadow cutout read
// whatever the pool kept of the path: the moving A/A kept 1-12 px on sponza's foliage. The shadow
// pass now asks for what its cutout reads, into the texture feedback's own counters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShadowFaceBindings } from './faceBindings.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('the cutout posts the tile it reads under the shared rule, into the feedback counters', () => {
  const fs = SHADOW_DEPTH_SHADER.slice(SHADOW_DEPTH_SHADER.indexOf('fn cutoutRequest('));
  assert.match(fs, /feedbackPhase\(in\.position\.xy,cutoutWord\.x\)/, 'its phase first');
  assert.match(fs, /requestPick\(in\.position\.xy,1u,cutoutWord\.x\)/, 'the pick turn');
  // The isotropic level, as `maskAlphaWgsl(true)` reads it: `aniso` false.
  assert.match(fs, /colorRequestIndex\(page\.mapIndex,in\.uv,gx,gy,p\.next,1u,false,/);
  assert.match(fs, /atomicAdd\(&tileFeedback\[rank-1u\],1u\)/);
  assert.match(fs, /@fragment fn shadow_fs[^}]*cutoutRequest\(in,gx,gy\);/);
});

test("the image's word and the feedback counters reach the regions' group", () => {
  const { device, writes, bindGroups } = fakeDevice();
  const faces = createShadowFaceBindings(device, device.createBuffer({ size: 4096, usage: 0 }));
  const counters = device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
  const bound = () => [...bindGroups.at(-1)!.entries];
  assert.ok(faces.group);
  const none = (bound()[2].resource as GPUBufferBinding).buffer;
  assert.notEqual(none, counters, 'no texture streamed: a placeholder the word leaves unread');
  faces.requests(0x2a5, counters);
  const word = () => Array.from(writes.at(-1)!.data as Uint32Array).slice(0, 2);
  assert.deepEqual(word(), [0x2a5, 1]);
  const group = faces.group;
  assert.equal((bound()[2].resource as GPUBufferBinding).buffer, counters);
  faces.requests(3, counters);
  assert.equal(faces.group, group, 'the same counters keep the group');
  faces.requests(3, undefined);
  assert.deepEqual(word(), [3, 0], 'nothing streamed asks nothing');
});
