// #1410: the lighting and the shadow demand recompute the shadow receiver offset from the
// visibility buffer with one shared text; the resolve writes it nowhere, and no pass binds a
// per-pixel offset target any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { receiverOffsetWgsl } from './receiverOffsetWgsl.ts';
import {
  FRAMEBUFFER_WGSL,
  PIXEL_BARY_WGSL,
  SHADE_UNI_WGSL,
  VERTEX_NORMALS_WGSL,
} from './pixelTriangleWgsl.ts';
import { SHADE_SHADER } from './shadeWgsl.ts';
import { contractLightingShader } from '../../lighting/deferred/shaders.ts';
import { shadowDemandWgsl } from '../../webgpu/shadow/demandWgsl.ts';
import { SHADE_BINDINGS } from '../../webgpu/core/bindLayout.ts';

test('the lighting and the shadow demand call one shared offset function and bind no offset target', () => {
  const readers: [string, string][] = [['demand', shadowDemandWgsl()]];
  for (const bounce of [false, true])
    for (const narrow of [false, true])
      for (const shadowed of [false, true])
        readers.push([
          `lighting ${bounce} ${narrow} ${shadowed}`,
          contractLightingShader(bounce, narrow, undefined, shadowed),
        ]);
  for (const [name, text] of readers) {
    // The shared text, from the reader's first receiver binding: the visibility buffer's.
    const first = Number(/@binding\((\d+)\) var vis:/.exec(text)?.[1]);
    assert.equal(text.split(receiverOffsetWgsl(first)).length, 2, `${name}: the shared text, once`);
    assert.equal(text.match(/\bfn receiverOffset\(/g)?.length, 1, `${name}: one offset function`);
    assert.equal(text.match(/\breceiverOffset\(pixel/g)?.length, 2, `${name}: and its one call`);
    assert.doesNotMatch(text, /shadingOffset/, `${name}: no offset target read`);
  }
  assert.doesNotMatch(SHADE_SHADER, /shadingOffset|shadingPointOffset/, 'the resolve stores none');
  // The resolve places its pixel with the very functions the offset calls: they cannot drift.
  const shared = receiverOffsetWgsl(0);
  for (const text of [PIXEL_BARY_WGSL, VERTEX_NORMALS_WGSL, FRAMEBUFFER_WGSL, SHADE_UNI_WGSL]) {
    assert.ok(SHADE_SHADER.includes(text) && shared.includes(text), 'one shared placement text');
  }
  assert.match(SHADE_SHADER, /=pixelBary\(/, 'the resolve calls the shared barycentrics');
  assert.match(SHADE_SHADER, /=vertexNormals\(/, 'the resolve calls the shared normals');
  assert.equal('shadingOffset' in SHADE_BINDINGS, false, 'the resolve binds no offset target');
});
