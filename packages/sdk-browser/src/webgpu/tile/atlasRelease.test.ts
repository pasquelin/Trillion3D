import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileAtlas } from './atlas.ts';
import { tileLayout } from '../../texture/tiles.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { textureDevice } from './textureDevice.fixture.ts';

installGpuGlobals();

const empty = { levels: [], blocks: { bc7: [], astc: [] } };

// #1016: a capture gives back what no image named since the view last moved. A leaf's tile an
// earlier pose brought in stayed resident, and the shadow cutout read it: the settled image
// depended on the way the camera came. What this pose named stays, and a tail never leaves.
test('release gives back the tiles no image looked at since a frame, never a tail', () => {
  const layout = tileLayout(4096, 4096);
  const textures = [0, 1].map(() => ({
    layout,
    lane: 'lossless' as const,
    source: { kind: 'bytes' as const, tail: empty },
  }));
  const heard: number[] = [];
  const atlas = createWebgpuTileAtlas(textureDevice().gpu, {
    kind: 'color',
    encoding: poolEncoding('bc7'),
    layers: { lossless: 1, rgba: 0, 'two-channel': 0 },
    feedbackOffset: 0,
    textures,
    onEvicted: (slot) => heard.push(slot),
  });
  atlas.pinTails({ writeTexture() {} } as never, () => {});
  const old = { slot: 0, level: 0, tx: 0, ty: 0 },
    seen = { slot: 1, level: 0, tx: 0, ty: 0 },
    named = { slot: 1, level: 0, tx: 1, ty: 0 };
  atlas.place(old, 3);
  atlas.place(seen, 3);
  atlas.place(named, 12);
  atlas.touch(seen, 10);
  assert.deepEqual([...atlas.release(10)], [0]);
  assert.deepEqual(heard, [0], 'the texture of the released tile is heard');
  assert.equal(atlas.touch(old, 20), false, 'gone');
  assert.ok(atlas.touch(seen, 20) && atlas.touch(named, 20), 'what the pose named stays');
  assert.equal(atlas.poolOf(0).resident, 4, 'both tails and the two named tiles');
  assert.equal(atlas.servedLevel(old), layout.tail, 'the released tile reads its tail again');
});
