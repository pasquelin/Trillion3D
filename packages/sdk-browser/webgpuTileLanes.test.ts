import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileAtlas } from './webgpuTileAtlas.ts';
import { tileLayout } from './textureTiles.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { poolEncoding } from './textureBlockFormats.ts';

installGpuGlobals();

/** A dummy texture device that counts destroyed textures. */
function textureDevice() {
  let destroyed = 0;
  const gpu = {
    createTexture: () => ({
      createView: () => ({}),
      destroy: () => destroyed++,
      format: 'rgba8unorm',
    }),
    createBuffer: () => ({ destroy() {} }),
    createCommandEncoder: () => ({ copyTextureToTexture() {}, finish: () => ({}) }),
    queue: { writeTexture() {}, writeBuffer() {}, submit() {} },
  };
  return { gpu: gpu as never, destroyed: () => destroyed };
}
const empty = { levels: [], blocks: { bc7: [], astc: [] } };

// Behaviour: an atlas opens one pool per lane its textures take, each texture's tiles and tail
// in its lane's pool — a lossless chain beside a block one never shares a texture —, the tap of
// its lane in its header, and a lane no texture takes has no pool but a stand-in view.
test('each texture lives in the pool of its lane, and an empty lane has a stand-in', () => {
  const { gpu, destroyed } = textureDevice();
  const layout = tileLayout(4096, 4096);
  const encoding = poolEncoding('bc7');
  const textures = [
    { layout, lane: 'rgba' as const, source: { kind: 'bytes' as const, tail: empty } },
    { layout, lane: 'lossless' as const, source: { kind: 'bytes' as const, tail: empty } },
  ];
  const atlas = createWebgpuTileAtlas(gpu, {
    kind: 'data',
    encoding,
    layers: { lossless: 1, rgba: 2, 'two-channel': 0 },
    feedbackOffset: 0,
    textures,
  });
  assert.equal(atlas.pools.length, 2);
  assert.equal(atlas.views.length, 3);
  assert.equal(atlas.views[1], atlas.poolOf(0).view);
  assert.equal(atlas.views[0], atlas.poolOf(1).view);
  assert.notEqual(atlas.views[2], atlas.views[0], 'the two-channel lane: a stand-in');
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  atlas.place({ slot: 0, level: 0, tx: 0, ty: 0 }, 10);
  atlas.place({ slot: 1, level: 0, tx: 0, ty: 0 }, 10);
  atlas.place({ slot: 1, level: 0, tx: 1, ty: 0 }, 10);
  assert.equal(atlas.poolOf(0).resident, 2, 'its tail and one tile');
  assert.equal(atlas.poolOf(1).resident, 3, 'its tail and two tiles');
  assert.equal(atlas.pages.words[4 + 3] >>> 24, encoding.tapOf('rgba'));
  assert.equal(atlas.pages.words[4 + 4 + 3] >>> 24, encoding.tapOf('lossless'));
  assert.equal(atlas.resize(gpu, { lossless: 1, rgba: 1, 'two-channel': 0 }), 0);
  assert.equal(destroyed(), 1, 'only the lane whose layers changed gets a new pool');
  atlas.destroy();
  assert.equal(destroyed(), 3);
});
