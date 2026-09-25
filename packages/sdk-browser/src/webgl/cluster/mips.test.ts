// #42: the WebGL2 binder reduces its mip chains as the WebGPU chain does — one draw per level,
// colours weighted by alpha for a map every reader takes for coverage, plain otherwise —, and a
// surface switched between masked and opaque after its image reduces the same texture again, with
// no new upload. #709 drew each level while sampling the texture it drew into: refused by the
// browser, every level stayed at its null allocation, alpha 0, and every masked leaf was cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebglClusterTextures } from './textures.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { CoverageReaders } from '../../texture/coverage.ts';

/** A test context; `draws`: per draw, the texture sampled, and the texture and level drawn. */
function context(answers: Record<string, unknown> = {}) {
  const view = (name: string) =>
    name === 'COLOR_WRITEMASK' ? [true, true, true, true] : new Int32Array([0, 0, 8, 4]);
  const gl = createTestContext({ answers: { getParameter: view, ...answers } });
  const uniforms = (name: string) =>
    gl.of('uniform1i').flatMap(([at, value]) => ((at as Named).uniform === name ? [value] : []));
  const draws = () => {
    const units = new Map<unknown, unknown>(),
      found: unknown[][] = [];
    let active,
      into: unknown[] = [];
    for (const { name, args } of gl.calls)
      if (name === 'activeTexture') active = args[0];
      else if (name === 'bindTexture') units.set(active, args[1]);
      else if (name === 'framebufferTexture2D' && args[0] === 'DRAW_FRAMEBUFFER') into = args;
      else if (name === 'drawArrays')
        found.push([units.get(`TEXTURE0${uniforms('source').at(-1)}`), into[3], into[4]]);
    return found;
  };
  return { ...gl, draws, rules: () => uniforms('weighted') };
}
type Named = { uniform: string };
/** A 4×4 map with mips, a masked surface wearing it, and a binder whose frame has begun. */
function masked(gl: WebGL2RenderingContext) {
  const host = G.dataTexture(new Uint8Array(64), 4, 4);
  host.generateMipmaps = true;
  const binder = new WebglClusterTextures(gl),
    surface = G.standardSurface({ map: host, alphaTest: 0.5 });
  binder.file(surface);
  binder.beginFrame();
  return { host, map: importHostTexture(host as unknown as HostTexture), binder, surface };
}

test('each level is drawn from a copy of the level above, never from the texture it fills', () => {
  const gl = context();
  const { map, binder } = masked(gl.gl);
  binder.bind(0, map, true, undefined, true);
  const draws = gl.draws();
  assert.deepEqual(
    draws.map((draw) => draw[2]),
    [1, 2],
  );
  assert.ok(draws.every(([sampled, target]) => sampled && sampled !== target));
  assert.deepEqual([gl.of('copyTexSubImage2D').length, gl.of('generateMipmap').length], [2, 0]);
});

test('a format no framebuffer holds keeps the box chain, never levels left empty', () => {
  let asked = 0;
  const gl = context({ checkFramebufferStatus: () => (asked++, 'FRAMEBUFFER_UNSUPPORTED') });
  const { map, binder } = masked(gl.gl);
  binder.bind(0, map, true, undefined, true);
  binder.bind(1, masked(gl.gl).map, true, undefined, true);
  assert.deepEqual([gl.draws().length, gl.of('generateMipmap').length, asked], [0, 2, 1]);
});

test('a chain follows the coverage rule of its readers, switched after its image', () => {
  const gl = context();
  const { host, map, binder, surface } = masked(gl.gl);
  const image = () => (binder.beginFrame(), binder.bind(0, map, true, undefined, true));
  image();
  image();
  surface.alphaTest = 0;
  image();
  surface.alphaTest = 0.5;
  image();
  binder.file(G.standardSurface({ map: host }));
  image();
  assert.deepEqual(gl.rules(), [1, 0, 1, 0], 'weighted once, opaque, masked, an opaque reader');
  assert.equal(gl.of('texImage2D').filter((args) => args.at(-1) !== null).length, 1, 'uploads');
  binder.bind(1, map, false, undefined, true);
  binder.bind(2, map, true, undefined, false);
  assert.deepEqual(gl.rules().slice(4), [0, 0], 'a data binding of the same texture is plain');
});

// The readers are filed once — the scene's census at its first draw, hidden meshes included, as
// WebGPU's at prepare — and reread once per image, never rebuilt from every mesh each frame.
test('a still scene files each surface once across frames, a hidden opaque one included', (t) => {
  const read = t.mock.method(CoverageReaders.prototype, 'read');
  const follow = t.mock.method(CoverageReaders.prototype, 'follow');
  const map = new G.GraphTexture({ width: 4, height: 4 } as TexImageSource);
  const geometry = G.boxGeometry();
  const hidden = G.mesh(geometry, G.standardSurface({ map }));
  hidden.visible = false;
  const scene = new G.GraphScene();
  scene.add(G.mesh(geometry, G.standardSurface({ map, alphaTest: 0.5 })), hidden);
  const gl = context();
  const draw = createSceneDraw(gl.gl, scene);
  const output = { toneMapped: false, framebuffer: null, width: 8, height: 4 };
  for (let frame = 0; frame < 3; frame++) {
    draw.render({} as HostCamera);
    draw.drawHostGeometry(createHostDrawCamera(), output);
  }
  assert.deepEqual([read.mock.callCount(), follow.mock.callCount()], [2, 3]);
  assert.deepEqual(gl.rules(), [0], 'plain: the hidden reader is opaque');
  draw.dispose();
});
