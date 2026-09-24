import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WebGLState } from 'three/src/renderers/webgl/WebGLState.js';
import * as G from '../../host/graph/graph.fixture.ts';
import { WebglClusterState } from './state.ts';
import { hostBlending } from '../../scene/materialBlending.ts';

/** A WebGL2 context that records the calls made on it; its enums are their names. */
function recorder() {
  const calls: unknown[][] = [];
  // What the witness's state reads once, at its creation.
  const parameter = (name: string) =>
    name === 'VERSION'
      ? 'WebGL 2.0'
      : name.endsWith('BOX') || name === 'VIEWPORT'
        ? [0, 0, 1, 1]
        : 16;
  const gl = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) =>
      /^[A-Z_0-9]+$/.test(key)
        ? key
        : key === 'getParameter'
          ? parameter
          : (...args: unknown[]) => calls.push([key, ...args]),
  });
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

const blendCalls = (surface: G.GraphSurface) => {
  const { gl, calls } = recorder();
  new WebglClusterState(gl).apply(surface as never, false, false);
  return calls.filter(([name, what]) => String(name).startsWith('blend') || what === 'BLEND');
};

/** The blend state the calls leave: colour and alpha operations, then the four factors. */
function blendState(calls: unknown[][]) {
  const state = { enabled: false, operations: [] as unknown[], factors: [] as unknown[] };
  for (const [name, ...args] of calls) {
    if (args[0] === 'BLEND' && (name === 'enable' || name === 'disable'))
      state.enabled = name === 'enable';
    if (name === 'blendEquation') state.operations = [args[0], args[0]];
    if (name === 'blendEquationSeparate') state.operations = args;
    if (name === 'blendFunc') state.factors = [args[0], args[1], args[0], args[1]];
    if (name === 'blendFuncSeparate') state.factors = args;
  }
  return state.enabled ? state : { enabled: false };
}

const WITNESS = {
  normal: THREE.NormalBlending,
  additive: THREE.AdditiveBlending,
  subtractive: THREE.SubtractiveBlending,
  multiply: THREE.MultiplyBlending,
  none: THREE.NoBlending,
} as const;

// #558: each mode computes, colour and alpha, what three@0.174 computes for the same material —
// the WebGL2 path through these calls, the WebGPU path through the one table they are read from.
test('a transparent surface blends by its mode as the witness does', () => {
  for (const mode of Object.keys(WITNESS) as (keyof typeof WITNESS)[]) {
    const witness = recorder();
    const extensions = { get: () => null, has: () => false };
    new WebGLState(witness.gl, extensions as never).setBlending(WITNESS[mode]);
    const ours = blendCalls(G.basicSurface({ transparent: true, blending: hostBlending(mode) }));
    assert.deepEqual(blendState(ours), blendState(witness.calls), mode);
  }
});
