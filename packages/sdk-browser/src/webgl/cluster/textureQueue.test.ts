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
import { fenceAllocations, settleAllocations, takeOutOfMemory } from '../core/allocation.ts';
import type { BackendDiagnostic } from '../../backend/types.ts';

const output = { toneMapped: false, framebuffer: null, width: 8, height: 4 };

function draw(hosts: {
  texturePoolBytes?: number;
  maxTextureTransferBytesPerFrame?: number;
  maxTextureUploadMsPerFrame?: number;
  onDiagnostic?: (diagnostic: BackendDiagnostic) => void;
}) {
  // The GPU runs the frames at once, unless the test holds it behind or refuses an allocation.
  const gpu = { behind: false, refuse: false };
  const gl = createTestContext({
    answers: {
      getParameter: (name: string) =>
        name === 'COLOR_WRITEMASK' ? [true, true, true, true] : new Int32Array([0, 0, 8, 4]),
      fenceSync: () => ({}),
      getSyncParameter: () => (gpu.behind ? 'UNSIGNALED' : 'SIGNALED'),
      getError: () => (gpu.refuse ? ((gpu.refuse = false), 'OUT_OF_MEMORY') : 0),
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
  return { image, pictures, gpu, gl: gl.gl };
}

test('a frame uploads ahead of its draws what its budget allows, once the GPU passed the last', () => {
  const { image, pictures, gpu } = draw({
    maxTextureTransferBytesPerFrame: heldBytes(8, 8) + 1,
    maxTextureUploadMsPerFrame: 1e9, // the bytes alone decide, whatever the machine's speed
  });
  assert.deepEqual(image(), pictures.slice(0, 2), 'two maps ahead of the draw: the budget full');
  gpu.behind = true;
  assert.deepEqual(image(), [], 'the GPU behind the last frame: nothing sent to wait on it');
  gpu.behind = false;
  assert.deepEqual(image(), [pictures[2]], 'the GPU caught up: the next map');
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
  queue.drain({} as WebGL2RenderingContext, { bind: (unit) => void bound.push(unit) }, {
    open: true,
  } as never);
  assert.deepEqual(bound, [0], 'the queue keeps the one map the half holds');
});

test('a refused map is published under the texture pool, and leaves the geometry pool whole', () => {
  const heard: BackendDiagnostic[] = [];
  const { image, gpu, gl } = draw({
    maxTextureTransferBytesPerFrame: heldBytes(8, 8) + 1,
    maxTextureUploadMsPerFrame: 1e9,
    onDiagnostic: (diagnostic) => heard.push(diagnostic),
  });
  // The host frame's order around each image: its errors read before, its allocations fenced after.
  const frame = () => (settleAllocations(gl), image(), fenceAllocations(gl));
  frame(); // the geometry and two maps, confirmed at the next read
  frame(); // the third map alone
  gpu.refuse = true;
  frame();
  const refused = heard.filter(({ phase }) => phase === 'gpu-out-of-memory');
  assert.deepEqual(
    refused.map(({ context }) => context?.pool),
    ['texture'],
  );
  assert.equal(takeOutOfMemory(gl, 'geometry'), false, 'no geometry allocation was refused');
});
