// #840: a map uploaded at the first draw that shows it held that frame 100–140 ms on sponza `rue`
// (the upload waited for a GPU process held by the compositor). The census orders the maps of every
// declared surface, attached or not, within the texture pool's bytes; each frame uploads the next
// ones before its draws, those that fit its upload budget — WebGPU's tile budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { hostTextureWritten } from '../../host/textureImport.ts';
import { sentBytes } from './textureQueue.ts';

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

/** The bytes the pictures `sent` send. */
const bytesOf = (sent: readonly TexImageSource[]) =>
  sent.reduce((sum, p) => sum + sentBytes((p as ImageData).width, (p as ImageData).height), 0);

test('a frame uploads ahead of its draws what fits its budget, once the GPU passed the last', () => {
  const { image, pictures, gpu } = draw({
    maxTextureTransferBytesPerFrame: sentBytes(4, 4) + sentBytes(8, 8),
    maxTextureUploadMsPerFrame: 1e9, // the bytes alone decide, whatever the machine's speed
  });
  assert.deepEqual(image(), pictures.slice(0, 2), 'two maps ahead of the draw: the budget full');
  gpu.behind = true;
  assert.deepEqual(image(), [], 'the GPU behind the last frame: nothing sent to wait on it');
  gpu.behind = false;
  assert.deepEqual(image(), [pictures[2]], 'the GPU caught up: the next map');
  assert.deepEqual(image(), [], 'each map once');
});

test('texture uploads never exceed the per-frame budget in one frame', () => {
  const budget = sentBytes(8, 8) + sentBytes(4, 4) - 1,
    { image, pictures } = draw({
      sides: [4, 8, 8, 4, 8, 4, 4],
      maxTextureTransferBytesPerFrame: budget,
      maxTextureUploadMsPerFrame: 1e9,
    });
  const frames: TexImageSource[][] = [];
  for (let n = 0; n < pictures.length; n++) frames.push(image());
  for (const sent of frames) assert.ok(bytesOf(sent) <= budget, `${bytesOf(sent)} > ${budget}`);
  assert.deepEqual(frames.flat(), pictures, 'every map sent, in its order, each once');
  assert.ok(frames.filter((sent) => sent.length).length > 3, 'spread over frames');
});

test('a map larger than the whole budget is sent alone, in a frame of its own', () => {
  const { image, pictures } = draw({
    sides: [4, 16, 4],
    maxTextureTransferBytesPerFrame: sentBytes(8, 8),
    maxTextureUploadMsPerFrame: 1e9,
  });
  assert.deepEqual(image(), [pictures[0]], 'the large map waits for a frame that sent nothing');
  assert.deepEqual(image(), [pictures[1]], 'alone');
  assert.deepEqual(image(), [pictures[2]]);
});

test('the preparation sends the declared maps, a budget per task, before any frame', async () => {
  const { image, prepare, pictures } = draw({
    maxTextureTransferBytesPerFrame: sentBytes(4, 4),
    maxTextureUploadMsPerFrame: 1e9,
  });
  assert.deepEqual(await prepare(), pictures, 'every declared map, over several tasks');
  assert.deepEqual(image(), [], 'the first frame sends none');
});

// #1198 (re-scope of #840): a map whose picture was not yet there at the census was left to its
// first draw, where the bind sent it while the GPU was held (sponza `rue`, 100–140 ms). It is now
// held, and the first drain that finds its picture sends it ahead of the draw that would bind it.
test('a map whose picture arrives after the census is sent ahead, not at its first draw', async () => {
  const { image, prepare, pictures, surfaces } = draw({
    sides: [4, 8],
    missing: [1],
    maxTextureTransferBytesPerFrame: sentBytes(8, 8),
    maxTextureUploadMsPerFrame: 1e9,
  });
  assert.deepEqual(await prepare(), [pictures[0]], 'the census leaves the map with no picture out');
  const late = surfaces[1].map as G.GraphTexture;
  late.image = pictures[1];
  late.needsUpdate = true;
  hostTextureWritten();
  assert.deepEqual(image(), [pictures[1]], 'its picture arrived: the frame sends it ahead');
  assert.deepEqual(image(), [], 'sent once');
});

test('the queue stops at the texture pool: what it leaves uploads at its first draw', () => {
  const { image, pictures } = draw({ texturePoolBytes: 1 });
  assert.deepEqual(image(), [pictures[0]], 'the first map fills the pool; the others are left');
  assert.deepEqual(image(), []);
});
