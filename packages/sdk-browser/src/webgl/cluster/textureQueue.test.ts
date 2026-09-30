// #840: a map uploaded at the first draw that shows it held that frame 100–140 ms on sponza `rue`
// (the upload waited for a GPU process held by the compositor). The census orders the maps of every
// declared surface, attached or not, within the texture pool's bytes: what it leaves out uploads
// at its first draw.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';

const output = { toneMapped: false, framebuffer: null, width: 8, height: 4 };

function draw(hosts: {
  texturePoolBytes?: number;
  maxTextureTransferBytesPerFrame?: number;
  maxTextureUploadMsPerFrame?: number;
  sides?: readonly number[];
  /** Indices of `sides` whose picture is not there yet at the census (`missing`). */
  missing?: readonly number[];
}) {
  // The GPU runs the frames at once, unless the test holds it behind.
  const gpu = { behind: false };
  const gl = createTestContext({
    answers: {
      getExtension: (name: string) => (name === 'EXT_color_buffer_half_float' ? {} : null),
      getParameter: (name: string) =>
        name === 'COLOR_WRITEMASK' ? [true, true, true, true] : new Int32Array([0, 0, 8, 4]),
      fenceSync: () => ({}),
      getSyncParameter: () => (gpu.behind ? 'UNSIGNALED' : 'SIGNALED'),
    },
  });
  const pictures = (hosts.sides ?? [4, 8, 16]).map(
    (side) => ({ width: side, height: side }) as TexImageSource,
  );
  const surfaces = pictures.map((image, index) =>
    G.standardSurface({ map: new G.GraphTexture(hosts.missing?.includes(index) ? null : image) }),
  );
  const scene = new G.Scene();
  scene.add(G.mesh(G.boxGeometry(), surfaces[0])); // the pages not attached yet wear the others
  const sceneDraw = createSceneDraw(gl.gl, scene, [], hosts, () => surfaces);
  const sent = () =>
    gl.of('texImage2D').flatMap((args) => pictures.filter((p) => args.includes(p)));
  const image = () => {
    gl.calls.length = 0;
    sceneDraw.render({} as HostCamera);
    sceneDraw.host.drawHostGeometry(createHostDrawCamera(), output);
    return sent();
  };
  const prepare = async () => {
    gl.calls.length = 0;
    await sceneDraw.prepare();
    return sent();
  };
  return { image, prepare, pictures, surfaces, gpu };
}

// #1198 (re-scope of #840): a map whose picture was not yet there at the census was left to its
// first draw, where the bind sent it while the GPU was held (sponza `rue`, 100–140 ms). It is now
// held, and the first drain that finds its picture sends it ahead of the draw that would bind it.

test('the queue stops at the texture pool: what it leaves uploads at its first draw', () => {
  const { image, pictures } = draw({ texturePoolBytes: 1 });
  assert.deepEqual(image(), [pictures[0]], 'the first map fills the pool; the others are left');
  assert.deepEqual(image(), []);
});
