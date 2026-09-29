import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_TILES_SHADER } from './shader.ts';
import {
  compactTile,
  tileLayout,
  tileLists,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';

// #849: a tile past its list in a scene of one batch still holds that batch's masks, so its pool
// slices are written from them; only a scene of more batches tests its lights a second time.

const layout = tileLayout(LIGHT_TILES_SHADER);
/** The 200 lights of a one-batch scene. */
const lights = [...Array(200).keys()];

test('one batch past its list: the pool is written from the masks, never tested twice', () => {
  // 200 scene lights, one batch: 133 reach the opaque slice, 67 the blend one, both past a list.
  const opaque = lights.filter((i) => i % 3 !== 0),
    blend = lights.filter((i) => i % 3 === 0);
  const pool = { capacity: 400, head: 0, overflow: 0 };
  const tiles = compactTile(layout, { opaque, blend }, 200, undefined, pool);
  assert.deepEqual(tileLists(layout, tiles, 200), { opaque, blend });
  assert.deepEqual(pool, { capacity: 400, head: opaque.length + blend.length, overflow: 0 });
  // The shader keeps the masks of a one-batch scene and walks again only past one batch.
  assert.ok(
    LIGHT_TILES_SHADER.includes(`let oneBatch=count<=${layout.threads}u;`) &&
      LIGHT_TILES_SHADER.includes(
        'if(oneBatch){writeBatch(lane,lane,count);}else{walkLights(lane,count,hasOpaque,seesSky);}',
      ),
    'a one-batch scene writes its pool slices from the masks',
  );
  assert.match(LIGHT_TILES_SHADER, /if\(!oneBatch&&lane<2u\*BLEND_MASK\)\{atomicStore/);
});
