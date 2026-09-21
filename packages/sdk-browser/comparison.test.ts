// The comparison compositor is an engine program: two render targets holding display images,
// put on the drawing buffer in the layout asked for, texel for texel. Before, a `ShaderMaterial`
// whose fragment named a uniform `layout` — a reserved word of GLSL ES 3.00 — failed to compile,
// and every comparison layout showed the clear colour (#85).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComparisonCompositor, type ComparisonLayout } from './comparison.ts';
import { createWebglRenderTarget } from './webglRenderTarget.ts';
import { createTestContext } from './webglTestContext.ts';

const uniform = (args: unknown[]) => (args[0] as { uniform: string }).uniform;

test('one program, built once, draws the layout on the drawing buffer with both sides bound', () => {
  const { gl, of, names } = createTestContext();
  const a = createWebglRenderTarget(gl, 8, 4),
    b = createWebglRenderTarget(gl, 8, 4);
  const compositor = createComparisonCompositor(gl);
  assert.equal(of('linkProgram').length, 0, 'nothing is built before the first draw');
  compositor.render(a, b, 'wipe', 0.25, 1);
  compositor.render(a, b, 'wipe', 0.25, 1);
  assert.equal(of('linkProgram').length, 1);
  assert.equal(of('drawArrays').length, 2);
  assert.deepEqual(of('bindFramebuffer').at(-1), ['FRAMEBUFFER', null], 'the drawing buffer');
  assert.deepEqual(of('viewport').at(-1), [0, 0, 8, 4]);
  const bound = of('bindTexture')
    .slice(-2)
    .map((args) => args[1]);
  assert.deepEqual(bound, [a.texture, b.texture]);
  const set = Object.fromEntries(
    [...of('uniform1i'), ...of('uniform1f'), ...of('uniform2f')].map((args) => [
      uniform(args),
      args.slice(1),
    ]),
  );
  assert.deepEqual(set.mode, [2]);
  assert.deepEqual(set.wipe, [0.25]);
  assert.deepEqual(set.toggle, [1]);
  assert.deepEqual(set.size, [8, 4]);
  assert.ok(!names().includes('enable'), 'depth, blend, cull and scissor are all off');
  compositor.dispose();
  assert.equal(of('deleteProgram').length, 1);
});

test('every layout has its own mode, and the wipe is kept within the image', () => {
  const { gl, of } = createTestContext();
  const a = createWebglRenderTarget(gl, 8, 4),
    b = createWebglRenderTarget(gl, 8, 4);
  const compositor = createComparisonCompositor(gl);
  const layouts: ComparisonLayout[] = ['single', 'side-by-side', 'wipe', 'toggle', 'difference'];
  for (const layout of layouts) compositor.render(a, b, layout, 2, 0);
  const modes = of('uniform1i')
    .filter((args) => uniform(args) === 'mode')
    .map((args) => args[1]);
  assert.deepEqual(modes, [0, 1, 2, 3, 4]);
  assert.deepEqual(of('uniform1f').at(-1)?.[1], 1, 'a wipe past the edge stops at it');
});

test('a lost context draws nothing, and the program is rebuilt on the restored one', () => {
  const { gl, of, canvas, state } = createTestContext();
  const a = createWebglRenderTarget(gl, 8, 4),
    b = createWebglRenderTarget(gl, 8, 4);
  const compositor = createComparisonCompositor(gl);
  compositor.render(a, b, 'toggle', 0.5, 0);
  state.lost = true;
  canvas.dispatch('webglcontextlost');
  compositor.render(a, b, 'toggle', 0.5, 0);
  assert.equal(of('drawArrays').length, 1, 'nothing drawn on a dead context');
  state.lost = false;
  compositor.render(a, b, 'toggle', 0.5, 0);
  assert.equal(of('linkProgram').length, 2, 'rebuilt once the context is back');
  assert.equal(of('drawArrays').length, 2);
});
