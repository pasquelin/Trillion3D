// #840: a map uploaded at the first draw that shows it held that frame 100–140 ms on sponza `rue`
// (the upload waited for a GPU process held by the compositor). The census, at the first draw,
// uploads the maps of every declared surface, attached or not, within the texture pool's bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';

const output = { toneMapped: false, framebuffer: null, width: 8, height: 4 };

function draw(texturePoolBytes?: number) {
  const gl = createTestContext({
    answers: {
      getParameter: (name: string) =>
        name === 'COLOR_WRITEMASK' ? [true, true, true, true] : new Int32Array([0, 0, 8, 4]),
    },
  });
  const [shown, later] = [
    { width: 4, height: 4 },
    { width: 8, height: 8 },
  ] as TexImageSource[];
  const surfaces = [shown, later].map((image) =>
    G.standardSurface({ map: new G.GraphTexture(image) }),
  );
  const scene = new G.Scene();
  scene.add(G.mesh(G.boxGeometry(), surfaces[0])); // the page not attached yet wears surfaces[1]
  const sceneDraw = createSceneDraw(gl.gl, scene, [], { texturePoolBytes }, () => surfaces);
  const image = () => {
    sceneDraw.render({} as HostCamera);
    sceneDraw.host.drawHostGeometry(createHostDrawCamera(), output);
  };
  const uploaded = () =>
    gl.of('texImage2D').flatMap((args) => [shown, later].filter((i) => args.includes(i)));
  return { image, uploaded, shown, later };
}

test('the first draw uploads the maps of every declared surface; no later draw uploads one', () => {
  const { image, uploaded, shown, later } = draw();
  image();
  assert.deepEqual(uploaded(), [shown, later], 'the attached map and the one declared ahead');
  image();
  assert.equal(uploaded().length, 2, 'nothing uploaded again');
});

test('the census stops at the texture pool: what it leaves uploads at its first draw', () => {
  const { image, uploaded, shown } = draw(1);
  image();
  assert.deepEqual(uploaded(), [shown], 'the first map fills the pool; the second is left');
});
