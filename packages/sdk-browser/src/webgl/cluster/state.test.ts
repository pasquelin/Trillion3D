import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { WebglClusterState } from './state.ts';
import { hostBlending } from '../../scene/materialBlending.ts';

/** A WebGL2 context that records the blend calls a draw makes. */
function recorder() {
  const calls: unknown[][] = [];
  const gl = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) =>
      /^[A-Z_]+$/.test(key) ? key : (...args: unknown[]) => calls.push([key, ...args]),
  });
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

const blendCalls = (surface: G.GraphSurface) => {
  const { gl, calls } = recorder();
  new WebglClusterState(gl).apply(surface as never, false, false);
  return calls.filter(([name, what]) => String(name).startsWith('blend') || what === 'BLEND');
};

// #346: the WebGL2 path draws each mode by its own equation, never as normal.
test('a transparent surface blends by the mode it declares', () => {
  const of = (mode: Parameters<typeof hostBlending>[0]) =>
    blendCalls(G.basicSurface({ transparent: true, blending: hostBlending(mode) }));
  assert.deepEqual(of('additive'), [
    ['enable', 'BLEND'],
    ['blendEquationSeparate', 'FUNC_ADD', 'FUNC_ADD'],
    ['blendFuncSeparate', 'SRC_ALPHA', 'ONE', 'ZERO', 'ONE'],
  ]);
  assert.deepEqual(of('subtractive')[1], [
    'blendEquationSeparate',
    'FUNC_REVERSE_SUBTRACT',
    'FUNC_ADD',
  ]);
  assert.deepEqual(of('multiply')[2], ['blendFuncSeparate', 'ZERO', 'SRC_COLOR', 'ZERO', 'ONE']);
  assert.deepEqual(of('normal')[2], [
    'blendFuncSeparate',
    'SRC_ALPHA',
    'ONE_MINUS_SRC_ALPHA',
    'ONE',
    'ONE_MINUS_SRC_ALPHA',
  ]);
  assert.deepEqual(of('none'), [['disable', 'BLEND']], 'none replaces the target: no blending');
});
