import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAA_BINDINGS,
  TAA_REPROJECT_WGSL,
  TAA_SHADER,
  TAA_VIEW_BYTES,
  YCOCG_WGSL,
} from './shaderWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../visibility/shader/pageWgsl.ts';
import { ROW_PLACEMENT_WORD } from '../webgpu/row/pageRow.ts';
import { TAA_WEIGHTS } from './weights.ts';

const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test('the temporal shader assembles each fragment once, on the shared page record', () => {
  for (const fragment of [YCOCG_WGSL, TAA_REPROJECT_WGSL])
    assert.equal(occurrences(TAA_SHADER, fragment), 1);
  assert.match(TAA_SHADER, /@vertex fn fullscreen\(/);
  assert.match(TAA_SHADER, /@fragment fn resolve\(/);
  // The record carries placement at the word the row writes: that is how the pixel finds
  // its object's motion matrix.
  const fields = PAGE_INFO_STRUCT_WGSL.replace(/^.*\{|,\}`?$/g, '').split(',');
  const words: string[] = [];
  for (const field of fields) {
    const [name, type] = field.split(':');
    const size = type === 'mat4x4f' ? 16 : type === 'vec4f' ? 4 : type === 'vec2f' ? 2 : 1;
    for (let i = 0; i < size; i++) words.push(name);
  }
  assert.equal(words[ROW_PLACEMENT_WORD], 'placement');
  assert.match(TAA_REPROJECT_WGSL, /motion\[pages\[\(id>>8u\)-1u\]\.placement\]/);
});

test('shader bindings are those of the layout, and the uniform has the declared size', () => {
  for (const [name, binding] of Object.entries(TAA_BINDINGS))
    assert.match(
      TAA_SHADER,
      new RegExp(`@binding\\(${binding}\\) var(<[a-z,]+>)? ${name}:`),
      `binding ${name}`,
    );
  // Two matrices, viewport and params, then the nine weights in three quadruplets.
  assert.equal(TAA_VIEW_BYTES, 2 * 64 + 2 * 16 + TAA_WEIGHTS * 4);
  assert.match(
    TAA_SHADER,
    /struct TaaView\{prevViewProj:mat4x4f,invViewProj:mat4x4f,viewport:vec4f,params:vec4f,weights:array<vec4f,3>,\}/,
  );
  // No cosine per pixel: weights come from the uniform, neighbour by neighbour.
  assert.doesNotMatch(TAA_SHADER, /cos\(/);
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
