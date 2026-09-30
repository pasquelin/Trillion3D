// #1249: a moving image whose tile list holds no shadowed light walks it once, `L` evaluations a
// pixel, where the drawn resolve walked it three times and shaded four more, `3·L + 4`; a list with
// a shadowed light is drawn as before. Counted on the shipped WGSL, over a sponza-sized atrium.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../packages/sdk-core/src/index.ts';
import { camera } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { ATRIUM_POSES, atriumDepth, atriumLamps } from './lightTileAtrium.ts';
import { countSampled } from './lightTileSampledCount.ts';

const lights = atriumLamps(200, 4);
const { eye, yaw, pitch } = ATRIUM_POSES[1];
const view = camera(eye, yaw, pitch, 60, 240, 156);
const depths = atriumDepth(view);

test('the atrium is ray-cast with near and far surfaces, most of the view covered', () => {
  const covered = depths.filter((z) => z > 0).length;
  assert.ok(covered > 0.6 * depths.length && covered < depths.length, `${covered} covered`);
});

test('an unshadowed moving pixel walks its cluster, at most its tile list', () => {
  const s = countSampled(
    view,
    depths,
    lights,
    lights.map(() => -1),
  );
  assert.ok(s.moving < s.list, 'the slice walks fewer lights than the tile list');
  assert.ok(s.shaded < s.moving, 'and shades only those in range');
  assert.ok(s.develop > 2.5 * s.list, `develop drew: ${s.develop} for ${s.list}`);
});

test('a list with a shadowed light is drawn as before, the others summed in full', () => {
  // A slot of −0.5 truncates to 0 as `shadowFactor` reads it: a shadow; −1 is none.
  const all = countSampled(
    view,
    depths,
    lights,
    lights.map(() => -0.5),
  );
  // Every list shadowed: a list of 5 to 64 is drawn as before; the others walk their slice.
  assert.ok(all.moving > all.list && all.moving <= all.develop, 'the drawn resolve, unchanged');
  const one = countSampled(
    view,
    depths,
    lights,
    lights.map((_, rank) => (rank % 40 ? -1 : 0)),
  );
  assert.ok(
    one.moving > one.list && one.moving < one.develop,
    'only the tiles a shadowed lamp reaches draw',
  );
  assert.equal(LIGHT_SETTINGS.samplesPerPixel, 4, 'the 3·L + 4 of the issue');
});
