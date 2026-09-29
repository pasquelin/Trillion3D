// #840: a map uploaded at the first draw that shows it held that frame 100–140 ms on sponza `rue`
// (the upload waited for a GPU process held by the compositor). The census orders the maps of every
// declared surface, attached or not, within the texture pool's bytes; each frame uploads the next
// ones after its draws, while its upload budget — WebGPU's tile budget — is open.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { heldBytes, WebglTextureQueue } from './textureQueue.ts';

const output = { toneMapped: false, framebuffer: null, width: 8, height: 4 };

function draw(hosts: {
  texturePoolBytes?: number;
  maxTextureTransferBytesPerFrame?: number;
  maxTextureUploadMsPerFrame?: number;
}) {
  const gl = createTestContext({
    answers: {
      getParameter: (name: string) =>
        name === 'COLOR_WRITEMASK' ? [true, true, true, true] : new Int32Array([0, 0, 8, 4]),
    },
  });
  const pictures = [4, 8, 16].map((side) => ({ width: side, height: side }) as TexImageSource);
  const surfaces = pictures.map((image) => G.standardSurface({ map: new G.GraphTexture(image) }));
  const scene = new G.Scene();
  scene.add(G.mesh(G.boxGeometry(), surfaces[0])); // the pages not attached yet wear the others
  const sceneDraw = createSceneDraw(gl.gl, scene, [], hosts, () => surfaces);
  const image = () => {
    gl.calls.length = 0;
    sceneDraw.render({} as HostCamera);
    sceneDraw.host.drawHostGeometry(createHostDrawCamera(), output);
    return gl.of('texImage2D').flatMap((args) => pictures.filter((p) => args.includes(p)));
  };
  return { image, pictures };
}

test('a frame uploads ahead of its draws only what its budget leaves; the next frames the rest', () => {
  const { image, pictures } = draw({
    maxTextureTransferBytesPerFrame: heldBytes(8, 8) + 1,
    maxTextureUploadMsPerFrame: 1e9, // the bytes alone decide, whatever the machine's speed
  });
  assert.deepEqual(image(), pictures.slice(0, 2), 'the drawn map, then one ahead: the budget full');
  assert.deepEqual(image(), [pictures[2]], 'the next frame, the next map');
  assert.deepEqual(image(), [], 'each map once');
});

test('the queue stops at the texture pool: what it leaves uploads at its first draw', () => {
  const { image, pictures } = draw({ texturePoolBytes: 1 });
  assert.deepEqual(image(), [pictures[0]], 'the first map fills the pool; the others are left');
  assert.deepEqual(image(), []);
});

test('a refused map halves the pool the queue uploads ahead into', () => {
  const queue = new WebglTextureQueue(),
    maps = [64, 64, 64].map((side) => new G.GraphTexture({ width: side, height: side }));
  queue.order(
    maps.map((map) => G.standardSurface({ map })),
    Infinity,
  );
  const three = heldBytes(64, 64) * 3,
    { before, after } = queue.outOfMemory();
  assert.equal(before.allocatedBytes, three);
  assert.equal(after?.allocatedBytes, heldBytes(64, 64), 'half the pool holds one map of three');
  const bound: number[] = [];
  queue.drain({ bind: (unit) => void bound.push(unit) }, { open: true } as never);
  assert.deepEqual(bound, [0], 'the queue keeps the one map the half holds');
});
