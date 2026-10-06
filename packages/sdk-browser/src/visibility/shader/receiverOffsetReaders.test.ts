// #1410: the lighting recomputes the shadow receiver offset from the visibility buffer with one
// shared text; the resolve writes it once, packed in 8 bytes, for the
// virtual shadow maps' projection alone (`receiverTargetWgsl.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { receiverOffsetWgsl } from './receiverOffsetWgsl.ts';
import { receiverStoreWgsl, receiverTargetReadWgsl } from './receiverTargetWgsl.ts';
import { integers } from '../../texture/integerVectors.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import {
  FRAMEBUFFER_WGSL,
  PIXEL_BARY_WGSL,
  SHADE_UNI_WGSL,
  VERTEX_NORMALS_WGSL,
} from './pixelTriangleWgsl.ts';
import { SHADE_SHADER } from './shadeWgsl.ts';
import { contractLightingShader } from '../../lighting/deferred/shaders.ts';
import { SHADE_BINDINGS } from '../../webgpu/core/bindLayout.ts';

test('the lighting calls one shared offset function and binds no offset target', () => {
  const readers: [string, string][] = [];
  for (const bounce of [false, true])
    for (const narrow of [false, true])
      for (const shadowed of [false, true])
        readers.push([
          `lighting ${bounce} ${narrow} ${shadowed}`,
          contractLightingShader(bounce, narrow, shadowed),
        ]);
  for (const [name, text] of readers) {
    // The shared text, from the reader's first receiver binding: the visibility buffer's.
    const first = Number(/@binding\((\d+)\) var vis:/.exec(text)?.[1]);
    assert.equal(text.split(receiverOffsetWgsl(first)).length, 2, `${name}: the shared text, once`);
    assert.equal(text.match(/\bfn shadowReceiver\(/g)?.length, 1, `${name}: one offset function`);
    assert.equal(text.match(/\bshadowReceiver\(pixel/g)?.length, 2, `${name}: and its one call`);
    assert.doesNotMatch(text, /shadingOffset/, `${name}: no offset target read`);
  }
  // The resolve writes the receiver once for the projection (`receiverTargetWgsl.ts`), with the
  // very offset function the readers call.
  assert.match(SHADE_SHADER, /rcvOffset=shadingPointOffset\(/, 'the resolve finds the receiver');
  assert.match(
    SHADE_SHADER,
    /storeReceiver\(pos\.xy,rcvOffset,rcvPlane\)/,
    'and stores it (`storageOnce.test.ts`)',
  );
  // The resolve places its pixel with the very functions the offset calls: they cannot drift.
  const shared = receiverOffsetWgsl(0);
  for (const text of [PIXEL_BARY_WGSL, VERTEX_NORMALS_WGSL, FRAMEBUFFER_WGSL, SHADE_UNI_WGSL]) {
    assert.ok(SHADE_SHADER.includes(text) && shared.includes(text), 'one shared placement text');
  }
  // With its corners' 1/w, read with its triangle (`decodeTriangle`).
  assert.match(SHADE_SHADER, /=perspectiveBary\(/, 'the resolve calls the shared barycentrics');
  // The resolve hands them its row's normal matrix (`shadeCacheWgsl.ts`): the shared transform.
  assert.match(SHADE_SHADER, /=transformedNormals\(/, 'the resolve calls the shared normals');
  assert.equal('shadingOffset' in SHADE_BINDINGS, false, 'the resolve binds no offset target');
});

test('the receiver target keeps the offset to 1/4095 of its largest component and the plane to 4.2e-3 rad; a zero plane is no receiver', () => {
  // One texel: what the resolve's `storeReceiver` writes, the projection's `shadowReceiver` reads.
  let texel = [0, 0, 0, 0];
  const scope = {
    receiverOutput: {},
    receiverTarget: {},
    textureDimensions: () => [8, 8],
    textureStore: (_target: object, _at: number[], value: number[]) => void (texel = value),
    textureLoad: () => texel,
    vec3i: integers(3, false),
    vec4u: integers(4, true),
    ShadowReceiver: (offset: number[], plane: number[]) => ({ offset, plane }),
  };
  const { storeReceiver } = shaderRun<{
    storeReceiver: (pos: number[], offset: number[], plane: number[]) => void;
  }>(receiverStoreWgsl(0), ['storeReceiver', 'receiverOct'], scope);
  const { shadowReceiver } = shaderRun<{
    shadowReceiver: (pixel: number[]) => { offset: number[]; plane: number[] };
  }>(
    receiverTargetReadWgsl(0, 0),
    ['shadowReceiver', 'shadowReceiverTexel', 'shadowReceiverOf', 'receiverUnoct'],
    scope,
  );
  const r = random(1570);
  for (let i = 0; i < 5000; i++) {
    // Offsets over the shared exponent's range, 2^-26 to 2^4 m; planes of any length and side.
    const scale = 2 ** (r() * 30 - 26),
      offset = [0, 1, 2].map(() => (r() * 2 - 1) * scale),
      plane = [0, 1, 2].map(() => (r() * 2 - 1) * 10 ** (r() * 4 - 2));
    storeReceiver([3.5, 2.5], offset, plane);
    const read = shadowReceiver([3.5, 2.5]),
      largest = Math.max(...offset.map(Math.abs)),
      error = Math.max(...offset.map((x, k) => Math.abs(read.offset[k] - x)));
    // Below the smallest exponent the step is 2^-26 / 4095 m: half of it at most.
    if (largest >= 2 ** -26) assert.ok(error <= largest / 4095, `offset ${offset}`);
    else assert.ok(error <= 2 ** -26 / 8190, `offset ${offset}`);
    const length = Math.hypot(...plane),
      cosine = plane.reduce((sum, x, k) => sum + (x / length) * read.plane[k], 0);
    assert.ok(Math.acos(Math.min(1, cosine)) <= 4.2e-3, `plane ${plane}`);
  }
  // A zero plane is no receiver; a zero offset is one, on its plane.
  storeReceiver([1.5, 1.5], [0.1, 0, 0], [0, 0, 0]);
  assert.deepEqual(texel, [0, 0, 0, 0]);
  assert.deepEqual(shadowReceiver([1.5, 1.5]), { offset: [0, 0, 0], plane: [0, 0, 0] });
  storeReceiver([1.5, 1.5], [0, 0, 0], [0, 3, 0]);
  const flat = shadowReceiver([1.5, 1.5]);
  assert.deepEqual(flat.offset, [0, 0, 0]);
  assert.ok(flat.plane[1] > 0.999, `plane ${flat.plane}`);
  // Past the target's size, nothing is written.
  const kept = texel;
  storeReceiver([8.5, 1.5], [1, 1, 1], [1, 0, 0]);
  assert.equal(texel, kept);
});
