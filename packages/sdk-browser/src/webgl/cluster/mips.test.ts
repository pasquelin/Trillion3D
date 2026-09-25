// #42: the WebGL2 binder reduces its mip chains as the WebGPU chain does — one draw per level,
// colours weighted by alpha for a map every surface of the frame takes for coverage, plain
// otherwise —, never through `generateMipmap`'s box filter; and a surface switched between masked
// and opaque after its first image reduces the same texture again, with no new upload. A data
// binding of the same texture never weighs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebglClusterTextures } from './textures.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import * as G from '../../host/graph/graph.fixture.ts';

/** A WebGL2 context that records level-0 uploads, box filters, draws and the reduction's rule. */
function context() {
  const calls = { uploads: 0, boxFilters: 0, draws: 0, rules: [] as number[] };
  const gl = new Proxy(
    {
      getExtension: () => null,
      getParameter: () => [0, 0, 0, 0],
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      createTexture: () => ({}),
      getUniformLocation: (_program: unknown, name: string) => ({ name }),
      uniform1i: (at: { name: string }, value: number) =>
        void (at.name === 'weighted' && calls.rules.push(value)),
      texImage2D: (_target: number, level: number) => void (level === 0 && calls.uploads++),
      generateMipmap: () => void calls.boxFilters++,
      drawArrays: () => void calls.draws++,
    } as Record<string, unknown>,
    { get: (target, key) => target[key as string] ?? (typeof key === 'string' ? noop : undefined) },
  );
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}
const noop = () => {};

test('a chain is reduced by the coverage rule of the surfaces the frame draws', () => {
  const { gl, calls } = context();
  const binder = new WebglClusterTextures(gl);
  const host = G.dataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  host.generateMipmaps = true;
  const map = importHostTexture(host as unknown as HostTexture);
  const masked = G.standardSurface({ map: host, alphaTest: 0.5 }),
    opaque = G.standardSurface({ map: host });
  const image = (...surfaces: G.GraphSurface[]) => {
    binder.beginFrame([surfaces.map((material) => ({ material }))]);
    binder.bind(0, map, true);
  };
  image(masked);
  assert.deepEqual(calls.rules, [1], 'masked: weighted by alpha');
  assert.deepEqual([calls.draws, calls.boxFilters], [2, 0], 'levels 2×2 and 1×1 drawn, no box');
  image(masked);
  assert.deepEqual(calls.rules, [1], 'the same rule: nothing reduced again');
  image(masked, opaque);
  assert.deepEqual(calls.rules, [1, 0], 'an opaque reader too: plain');
  image(masked);
  masked.alphaTest = 0;
  image(masked);
  assert.deepEqual(calls.rules, [1, 0, 1, 0], 'switched to opaque after its image: plain again');
  assert.deepEqual([calls.uploads, calls.boxFilters], [1, 0], 'one upload, never a box filter');
  masked.alphaTest = 0.5;
  image(masked);
  binder.bind(1, map);
  assert.deepEqual(calls.rules.slice(4), [1, 0], 'its linear record, a data map, stays plain');
  masked.dispose();
  opaque.dispose();
});
