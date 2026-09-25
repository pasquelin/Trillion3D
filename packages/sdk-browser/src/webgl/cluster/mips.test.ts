// #42: the WebGL2 binder reduces its mip chains as the WebGPU chain does — one draw per level,
// colours weighted by alpha for a map every surface of the frame takes for coverage, plain
// otherwise —, never through `generateMipmap`'s box filter; and a surface switched between masked
// and opaque after its first image reduces the same texture again, with no new upload. A data
// binding of the same texture never weighs, whatever its colour space: the WebGPU atlases' rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebglClusterTextures } from './textures.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';

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
    binder.bind(0, map, true, undefined, true);
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
  binder.bind(2, map, false, undefined, true);
  binder.bind(3, map, true, undefined, false);
  assert.deepEqual(
    calls.rules.slice(4),
    [1, 0, 1, 0],
    'the role decides, never the sRGB tag: a linear base map weighs, an sRGB data map is plain',
  );
  masked.dispose();
  opaque.dispose();
});

// A map's mip rule is read from every surface that wears it, a hidden mesh's too, as the WebGPU
// census reads it: a hidden opaque reader keeps the chain of a drawn masked one plain.
test('a hidden mesh still reads its map for the mip rule', () => {
  const map = new G.GraphTexture({ width: 4, height: 4 } as TexImageSource);
  const geometry = new G.Geometry().setIndex([0, 1, 2]);
  for (const name of ['position', 'normal', 'uv'])
    geometry.setAttribute(name, G.floatAttribute(new Float32Array(9), name === 'uv' ? 2 : 3));
  const hidden = G.mesh(geometry, G.standardSurface({ map }));
  hidden.visible = false;
  const scene = new G.GraphScene();
  scene.add(G.mesh(geometry, G.standardSurface({ map, alphaTest: 0.5 })), hidden);
  // The mip reducer saves the viewport and the colour mask it restores.
  const answer = (name: string) =>
    name === 'COLOR_WRITEMASK' ? [true, true, true, true] : new Int32Array([0, 0, 8, 4]);
  const context = createTestContext({ answers: { getParameter: answer } });
  const draw = createSceneDraw(context.gl, scene);
  draw.render({} as HostCamera);
  const output = { toneMapped: false, framebuffer: null, width: 8, height: 4 };
  draw.drawHostGeometry(createHostDrawCamera(), output);
  const weighted = ([at]: unknown[]) => (at as { uniform: string }).uniform === 'weighted';
  const rules = context.of('uniform1i').filter(weighted);
  assert.deepEqual(rules, [[{ uniform: 'weighted' }, 0]], 'plain: the hidden reader is opaque');
  draw.dispose();
});
