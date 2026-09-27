import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { DEPTH_NEAR } from '../../camera/depthConvention.ts';
import {
  ROW,
  tileBounds,
  tileCorner,
  tileCorners,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';
import { NEAR, camera } from './tileCamera.fixture.ts';

// #924 (OMB-24): sixteen threads de-project the tile's corners, one each, where thread zero
// de-projected them one after the other. The planes and boxes read the table: they must be those
// thread zero built from its own calls, to the bit — the corner each reads is the corner it
// computed before, at the same depth.

const SIZE = LIGHT_SETTINGS.tileSize;

/** The bounds as thread zero built them before, each corner de-projected where it is read. */
function boundsByCalls(view: TileView, tile: [number, number], front: number, back: number) {
  const at = (corner: number, z: number) => tileCorner(view, tile, corner, z);
  const box = (a: number, b: number) => [...Array(8).keys()].map((c) => at(c & 3, c & 4 ? b : a));
  const order = [0, 1, 3, 2];
  return {
    opaqueBox: box(front, back),
    blendBox: box(DEPTH_NEAR, back),
    near: order.map((c) => at(c, DEPTH_NEAR)),
    deep: order.map((c) => at(c, DEPTH_NEAR / 1024)),
    front: [0, 1, 2].map((c) => at(c, front)),
    back: [0, 1, 2].map((c) => at(c, back)),
  };
}

test('the corner table gives every box and plane the corners of before, to the bit', () => {
  const r = mulberry32(24);
  for (let run = 0; run < 300; run++) {
    const [width, height] = [320 + Math.floor(r() * 1600), 240 + Math.floor(r() * 840)];
    const view = camera(
      [r() * 1e4 - 5e3, r() * 2e3, r() * 1e4 - 5e3],
      r() * 6.28,
      -r() * 1.57,
      30 + r() * 70,
      width,
      height,
    );
    const tile: [number, number] = [
      Math.floor(r() * Math.ceil(width / SIZE)),
      Math.floor(r() * Math.ceil(height / SIZE)),
    ];
    const edge = [1, 0, -0, NaN, 1e-7][run % 5];
    const back = Math.fround(run % 5 ? edge : NEAR / (1 + r() * 3000));
    const front = Math.fround(Math.max(back, run % 7 ? r() : 1));
    const bounds = tileBounds(view, tile, front, back);
    const calls = boundsByCalls(view, tile, front, back);
    const box = (points: number[][]) => ({
      lo: [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]))),
      hi: [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a]))),
    });
    assert.deepEqual(bounds.opaqueBox, box(calls.opaqueBox));
    assert.deepEqual(bounds.blendBox, box(calls.blendBox));
    // The planes read the rows: the same corners give the same planes.
    const table = tileCorners(view, tile, front, back);
    const corners = (row: number, order: number[]) => order.map((c) => table[row * 4 + c]);
    assert.deepEqual(corners(ROW.near, [0, 1, 3, 2]), calls.near);
    assert.deepEqual(corners(ROW.deep, [0, 1, 3, 2]), calls.deep);
    assert.deepEqual(corners(ROW.front, [0, 1, 2]), calls.front);
    assert.deepEqual(corners(ROW.back, [0, 1, 2]), calls.back);
  }
});

test('sixteen threads de-project the corners between two barriers; thread zero calls none', () => {
  const calls = LIGHT_TILES_SHADER.split('tileCorner(').length - 1;
  assert.equal(calls, 2, 'defined once, called once: by the thread that owns the corner');
  assert.match(
    LIGHT_TILES_SHADER,
    /corners\[lane\]=tileCorner\(tile,lane%4u,depths\[lane\/4u\]\);/,
  );
  assert.match(
    LIGHT_TILES_SHADER,
    / workgroupBarrier\(\);\n tileCornerOfLane\(tile\.xy,lane,[^\n]*\);\n workgroupBarrier\(\);\n if\(lane==0u\)\{/,
  );
  assert.match(LIGHT_TILES_SHADER, /let depths=array<f32,4>\(1\.0,COLUMN_DEPTH,front,back\);/);
});
