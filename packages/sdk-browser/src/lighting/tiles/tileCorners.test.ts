import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { DEPTH_NEAR } from '../../camera/depthConvention.ts';
import {
  ROW,
  boxOf,
  tileBounds,
  tileCorner,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { NEAR, camera } from './tileCamera.fixture.ts';
import { LIGHT_TILES_SHADER } from '../../gpu/core/shaderTexts.fixture.ts';

// #924 (OMB-24): sixteen threads de-project the tile's corners, one each, where thread zero
// de-projected them one after the other. The planes and boxes read the table: they must be those
// thread zero built from its own calls, to the bit — the corner each reads is the corner it
// computed before, at the same depth.

const SIZE = LIGHT_SETTINGS.tileSize;

/** The bounds as thread zero built them before, each corner de-projected where it is read. */
function boundsByCalls(view: TileView, tile: [number, number], front: number, back: number) {
  const at = (corner: number, z: number) => tileCorner(view, tile, corner, z);
  const box = (a: number, b: number) => [...Array(8).keys()].map((c) => at(c & 3, c & 4 ? b : a));
  return { opaqueBox: box(front, back), blendBox: box(DEPTH_NEAR, back) };
}

test('the corner table gives both boxes the corners of before, to the bit', () => {
  const r = mulberry32(24);
  for (let run = 0; run < 10000; run++) {
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
    const edge = [1, 0, -0, NaN, 1e-7, Infinity, -Infinity][Math.floor(run / 6) % 7];
    const back = Math.fround(run % 6 ? NEAR / (1 + r() * 3000) : edge);
    const front = Math.fround(Math.max(back, run % 7 ? r() : 1));
    const bounds = tileBounds(view, tile, front, back);
    const calls = boundsByCalls(view, tile, front, back);
    assert.deepEqual(bounds.opaqueBox, boxOf(calls.opaqueBox));
    assert.deepEqual(bounds.blendBox, boxOf(calls.blendBox));
  }
});

test('sixteen threads de-project the corners between two barriers, seven build the bounds', () => {
  const calls = LIGHT_TILES_SHADER.split('tileCorner(').length - 1;
  assert.equal(calls, 2, 'defined once, called once: by the thread that owns the corner');
  assert.match(LIGHT_TILES_SHADER, /corners\[lane\]=tileCorner\(tile,lane%4u,z\);/);
  assert.match(
    LIGHT_TILES_SHADER,
    /workgroupBarrier\(\);\s*tileCornerOfLane\(tile\.xy,lane\);\s*workgroupBarrier\(\);/,
  );
  // The rows' depths, near, column, front, back: \`ROW\` and \`tileCorners\` of the oracle.
  assert.match(
    LIGHT_TILES_SHADER,
    /var z=select\(1\.0,COLUMN_DEPTH,row==DEEP_ROW\);\s*if\(row==FRONT_ROW\)\{z=bitcast<f32>\(atomicLoad\(&nearest\)\);\}\s*if\(row==BACK_ROW\)\{z=bitcast<f32>\(atomicLoad\(&farthest\)\);\}/,
  );
  for (const [name, row] of Object.entries(ROW))
    assert.match(LIGHT_TILES_SHADER, new RegExp(`const ${name.toUpperCase()}_ROW:u32=${row}u;`));
  // Seven lanes build the bounds from the rows at once (#1369): the column's five planes, the slab
  // from the near one, the two boxes.
  assert.match(LIGHT_TILES_SHADER, /if\(count>0u\)\{[^\n]*\n\s*tileBoundsOfLane\(lane,hasOpaque,seesSky\);/);
  assert.match(LIGHT_TILES_SHADER, /if\(lane<5u\)\{column\[lane\]=columnPlane\(lane\);\}/);
  assert.match(LIGHT_TILES_SHADER, /if\(lane==4u\)\{tileSlab\(\);\}/);
  // Each plane is the expression thread zero ran, the oracle's \`tileColumn\`: the same bits.
  assert.ok(
    LIGHT_TILES_SHADER.includes(
      'return inwardPlane(cross(columnCorner(DEEP_ROW,(i+1u)%4u)-deep,deep-near),near,inside);',
    ),
  );
  assert.ok(
    LIGHT_TILES_SHADER.includes(
      'return inwardPlane(cross(columnCorner(DEEP_ROW,1u)-first,columnCorner(DEEP_ROW,3u)-first),columnCorner(NEAR_ROW,0u),inside);',
    ),
  );
  assert.match(LIGHT_TILES_SHADER, /if\(lane==5u\)\{opaqueBox=tileBox\(FRONT_ROW,BACK_ROW\);\}/);
  // The column walks the corners in turn, the oracle's order 0, 1, 3, 2: the Gray code of i.
  assert.match(LIGHT_TILES_SHADER, /return corners\[row\*4u\+\(i\^\(i>>1u\)\)\];/);
});
