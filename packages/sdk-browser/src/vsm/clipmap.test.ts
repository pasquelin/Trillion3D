// The sun's clipmap as the clipmap builds it: levels
// 6 to 22, level L of radius 2^(L+1) cm, each centre snapped to its own radius in light space, and
// a level's cached pages kept while the camera's depth along the light stays within 0.9 of its
// depth range (a Z range scale of 1000 radii).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VSM_SUN_DEPTH_KEEP,
  VSM_SUN_DEPTH_SPAN,
  VSM_SUN_LEVEL_BIAS,
  VSM_SUN_LEVEL_BIAS_MOVING,
  VSM_LOCAL_LEVEL_BIAS,
  VSM_LOCAL_LEVEL_BIAS_MOVING,
} from './constants.ts';
import { createVsmClipmap, type VsmClipmap, type VsmViewport } from './clipmap.ts';
import { VsmCacheManager } from './cacheManager.ts';
import { addVsmLocalLightShadow, vsmLocalViewData } from './localLight.ts';
import { SUN, PROJECTION, VIEW, frame } from './clipmap.fixture.ts';

test('the levels: 6 to 22, a radius of 2^(L+1) cm, coarse 15 to 18', () => {
  const { config } = frame(new VsmCacheManager(), [0, 0, 0]);
  assert.deepEqual(
    [config.firstLevel, config.lastLevel, config.coarseFrom, config.coarseTo],
    [6, 22, 15, 18],
  );
  assert.ok(config.useCover, 'the directional receiver cover is on');
  assert.deepEqual([VSM_SUN_DEPTH_SPAN, VSM_SUN_DEPTH_KEEP], [1000, 0.9]);
});

test("the sun's LOD bias is the clipmap level's, -1.5 at rest and moving; local lights keep 0 and 1", () => {
  assert.deepEqual([VSM_SUN_LEVEL_BIAS, VSM_SUN_LEVEL_BIAS_MOVING], [-1.5, -1.5]);
  assert.deepEqual([VSM_LOCAL_LEVEL_BIAS, VSM_LOCAL_LEVEL_BIAS_MOVING], [0, 1]);
  const { config } = frame(new VsmCacheManager(), [0, 0, 0]);
  assert.deepEqual([config.levelBias, config.levelBiasMoving], [-1.5, -1.5]);
});

test("the clipmap's bias is max(0, -1.5 + the screen term), at rest and moving", () => {
  // Screen term: log2(0.5 / p[0] · 16384 / width), p[0] = 1 at 90°.
  for (const width of [256, 1024, 1728, 2048, 2900, 3456, 4096, 16384])
    for (const mobility of [0, 1]) {
      const clipmap = createVsmClipmap(
        new VsmCacheManager(),
        SUN,
        { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
        { width, height: width },
        mobility,
      );
      const expected = Math.max(0, -1.5 + Math.log2((0.5 * 16384) / width));
      assert.ok(
        Math.abs(clipmap.levelBias - expected) < 1e-6,
        `width ${width}, mobility ${mobility}: ${clipmap.levelBias} against ${expected}`,
      );
    }
  // The clamp holds the wide screens: 4096 px would ask -0.5, 3456 px about -0.25.
  assert.equal(frame(new VsmCacheManager(), [0, 0, 0], 4096).levelBias, 0);
  assert.equal(frame(new VsmCacheManager(), [0, 0, 0], 3456).levelBias, 0);
});

test("a frame drawn below the display keeps the display's clipmap: levels, bias and projection data", () => {
  const eye = [3.7, 1.2, -8.4];
  const build = (viewport: VsmViewport) =>
    createVsmClipmap(
      new VsmCacheManager(),
      SUN,
      { view: VIEW, projection: PROJECTION, perspective: true, eye },
      viewport,
      0,
    );
  const projectionData = (clipmap: VsmClipmap) =>
    clipmap.cacheEntry.mapCaches.map((entry) => entry.projectionData);
  // 1024 px: bias 1.5; 3456 px: the screen term is under 1.5, the clamp holds the bias at 0.
  for (const [width, height] of [
    [1024, 768],
    [3456, 2234],
  ]) {
    const display = build({ width, height });
    const half = build({ width: width / 2, height: height / 2, minScreenWidth: width });
    assert.equal(half.levelBias, display.levelBias, `${width} px: bias`);
    assert.equal(half.firstLevel, display.firstLevel);
    assert.deepEqual(half.levels, display.levels, `${width} px: levels`);
    assert.deepEqual(projectionData(half), projectionData(display), `${width} px: projection`);
    // Without the floor, half the width reads one level coarser (up to the clamp).
    const unfloored = build({ width: width / 2, height: height / 2 }).levelBias;
    assert.ok(unfloored > display.levelBias, `${width} px: ${unfloored} unfloored`);
    // A floor under the drawn width changes nothing.
    const under = build({ width, height, minScreenWidth: width / 2 });
    assert.deepEqual(projectionData(under), projectionData(display));
  }
});

test("the display's floor is the sun's alone: a local light keeps the drawn size", () => {
  const camera = { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] };
  const drawn = { width: 512, height: 384 },
    floored = { ...drawn, minScreenWidth: 1024 },
    display = { width: 1024, height: 768 };
  assert.deepEqual(vsmLocalViewData(camera, floored), vsmLocalViewData(camera, drawn));
  const spot = {
    id: 'spot',
    kind: 'spot' as const,
    position: [0, 3, -20],
    direction: [0, -1, 0],
    range: 6,
    coneAngle: 0.6,
  };
  const setup = (viewport: VsmViewport) =>
    addVsmLocalLightShadow(new VsmCacheManager(), spot, [vsmLocalViewData(camera, viewport)], 0);
  const data = (viewport: VsmViewport) => {
    const s = setup(viewport);
    return [s.finestMip, s.cacheEntry.mapCaches.map((entry) => entry.projectionData)];
  };
  assert.deepEqual(data(floored), data(drawn));
  // The display's size would have sharpened this spot: the floor must not reach it.
  assert.ok(setup(display).finestMip < setup(drawn).finestMip);
});
