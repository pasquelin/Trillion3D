import test from 'node:test';
import assert from 'node:assert/strict';
import { taaShader } from './shaderWgsl.ts';
import { TAA_BINDINGS, TAA_VIEW_BYTES } from './bindingsWgsl.ts';
import { TAA_DEFORM_WGSL } from './deformWgsl.ts';
import { taaReprojectWgsl } from './shaderWgsl.ts';

const TAA_REPROJECT_WGSL = taaReprojectWgsl();
const TAA_SHADER = taaShader(true);
const TAA_WEIGHTS = 12;

test('shader bindings are those of the layout, and the uniform has the declared size', () => {
  // The filtered resolve declares every binding, the display layers' four last.
  for (const [name, binding] of Object.entries(TAA_BINDINGS))
    assert.match(
      taaShader(true, false, true),
      new RegExp(`@binding\\(${binding}\\) var(<[a-z,]+>)? ${name}:`),
      `binding ${name}`,
    );
  // Two matrices, viewport and params, the nine weights in three quadruplets, render grid,
  // jitter, eye.
  assert.equal(TAA_VIEW_BYTES, 2 * 64 + 2 * 16 + TAA_WEIGHTS * 4 + 3 * 16);
  assert.match(
    TAA_SHADER,
    /struct TaaView\{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,render:vec4f,jitter:vec4f,eye:vec4f,\}/,
  );
  // No cosine per pixel: weights come from the uniform, neighbour by neighbour. Only a deformed
  // pixel's waves take one (`deformWgsl.ts`).
  assert.doesNotMatch(TAA_SHADER.replace(TAA_DEFORM_WGSL, ''), /cos\(/);
  assert.match(TAA_SHADER, /view\.weights\[k>>2u\]\[k&3u\]/);
});

test('the background, at zero depth, reprojects as a direction and not as a point', () => {
  // Homogeneous position is built with the read depth as-is: at zero — reversed depth's
  // infinite far plane — the product by the inverse yields a point at infinity, and
  // reprojection follows it without ever dividing before the previous matrix.
  assert.match(TAA_REPROJECT_WGSL, /view\.invViewProj\*vec4f\(ndc,depthValue,1\.0\)/);
  // Nothing is read — neither identifier, nor record, nor matrix — until a placement has moved.
  assert.match(TAA_REPROJECT_WGSL, /if\(view\.params\.z!=0\.0\)\{\s*let id=textureLoad\(ids/);
  assert.match(TAA_REPROJECT_WGSL, /if\(previous\.w<=0\.0\)\{return vec3f\(0\.0,0\.0,0\.0\);\}/);
});

// OMB-11: with no as-is pixel every neighbour's share is 0, and history is clamped to [0, 0]: the
// flag-reading resolve writes 0 wherever its colour is finite. The flagless one writes that 0 and
// is otherwise the same text — the colour and the placement tag line for line —, reading neither
// flags nor share history.
test('the flagless resolve is the flag-reading one without its share, written as 0', () => {
  const flagless = taaShader(false);
  assert.doesNotMatch(flagless, /var flags|textureLoad\(flags|shareHistory|shareLo|keptShare/);
  const outputs = (text: string) => [...text.matchAll(/TaaOut\((.*),vec2f\((.*),tag\)\);\}?$/gm)];
  const kept = outputs(TAA_SHADER),
    zero = outputs(flagless);
  assert.equal(zero.length, 3);
  assert.deepEqual(
    zero.map(([, color, share]) => [color, share]),
    kept.map(([, color]) => [color, '0.0']),
    'the same colour, a share of 0',
  );
  const flagged = new Set(TAA_SHADER.split('\n'));
  const own = flagless.split('\n').filter((line) => !flagged.has(line));
  assert.equal(own.length, 3, 'only its three outputs are its own');
  for (const line of own) assert.match(line, /TaaOut\(.*,vec2f\(0\.0,tag\)\);\}?$/);
  const removed = TAA_SHADER.split('\n').filter((line) => !flagless.includes(line));
  for (const line of removed) assert.match(line, /share|var flags|asIs|TaaOut/, line);
});
