// The normal rule of a two-sided material, shared by the two passes that light.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG_DOUBLE, FLAG_HAS_NORMAL, SHADE_SHADER } from './visibilityBuffer.ts';
import { BLEND_SHADER } from './webgpuBlendShader.ts';

/** Body of the vertex-normal branch, the one that follows the geometric normal. */
function vertexNormalBranch(wgsl: string) {
  const geometric = wgsl.indexOf('var N=uniteOuZero(');
  assert.notEqual(geometric, -1, 'the shader does start from a geometric normal');
  const start = wgsl.indexOf(`&${FLAG_HAS_NORMAL}u)!=0u){`, geometric);
  assert.notEqual(start, -1, 'the vertex normal does have its branch');
  let depth = 0;
  const open = wgsl.indexOf('{', start);
  for (let i = open; i < wgsl.length; i++) {
    if (wgsl[i] === '{') depth++;
    else if (wgsl[i] === '}' && --depth === 0) return wgsl.slice(open + 1, i);
  }
  throw new Error('normal branch not closed');
}

test('only a vertex normal flips on the back of a two-sided material', () => {
  // The geometric normal already looks at the observer — screen derivatives for blending, edges
  // put back right-side-out by `screenFace` for opaque. Flipping it would send it opposite the
  // light, and a two-sided pane seen from behind would render exactly zero. The flip therefore
  // lives in the vertex-normal branch, and nowhere else, on both sides.
  for (const [nom, wgsl] of [
    ['blend', BLEND_SHADER],
    ['opaque', SHADE_SHADER],
  ] as Array<[string, string]>) {
    assert.match(vertexNormalBranch(wgsl), /N\*=face;/, `${nom}: the vertex normal flips`);
    assert.equal(
      wgsl.split('N*=face;').length - 1,
      1,
      `${nom}: a single normal flip in the whole shader`,
    );
  }
  // The tangent frame follows the same rule: it flips only with the normal that orients it.
  const tangent = new RegExp(
    // Opaque reads the flags on its page sheet, blend in a local variable taken from its
    // flat variables: `page.flags` on one side, `flags` on the other, same rule checked.
    `&${FLAG_DOUBLE}u\\)!=0u&&\\((?:[a-z]+\\.)?flags&${FLAG_HAS_NORMAL}u\\)!=0u\\)\\{T\\*=face;B\\*=face;\\}`,
  );
  for (const [nom, wgsl] of [
    ['blend', BLEND_SHADER],
    ['opaque', SHADE_SHADER],
  ] as Array<[string, string]>)
    assert.match(wgsl, tangent, `${nom}: the tangent frame flips only with a normal`);
});
