import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compactTile,
  tileLayout,
  tileLists,
} from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';
import {
  sphereTouchesColumn,
  tileColumn,
  tileCorner,
  tileCorners,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { camera } from './tileCamera.fixture.ts';
import { LIGHT_TILES_SHADERS } from './shader.ts';

/** The light-tile shader texts the engine compiles, by name. */
const LIGHT_TILES_SHADER_TEXTS = new Map<string, string>(LIGHT_TILES_SHADERS);
const LIGHT_TILES_SHADER = LIGHT_TILES_SHADER_TEXTS.get('LIGHT_TILES_SHADER')!;

// Issue #28: a blend surface in front of the sky may stand at any distance, so a tile with a
// sky pixel gives its blend list the tile's whole column — never a box that stops at the
// farthest opaque, and never the whole world either.

const width = 1920,
  height = 1080;
const view = (eye: [number, number, number]) => camera(eye, 0, 0, 60, width, height);
const tile: [number, number] = [37, 21];
/** A point on the axis of the tile's column, `near / depth` metres from the eye, its origin. */
function onAxis(v: TileView, depth: number) {
  const corners = [0, 1, 2, 3].map((c) => tileCorner(v, tile, c, depth));
  return [0, 1, 2].map((a) => corners.reduce((s, p) => s + p[a] / 4, 0)) as [
    number,
    number,
    number,
  ];
}

for (const eye of [
  [0, 0, 0],
  [5000, 20, -3000],
] as [number, number, number][]) {
  test(`sky column at eye ${eye}: keeps a light at any distance in the tile, rejects the others`, () => {
    const v = view(eye);
    const column = tileColumn(tileCorners(v, tile, 1, 1));
    // A small light a kilometre away, in front of the sky: a far glass pane is lit by it.
    const far = onAxis(v, 0.1 / 1000);
    assert.ok(sphereTouchesColumn(column, far, 0.5));
    // The same light mirrored behind the eye, or moved far across the screen: out.
    const behind = far.map((p) => -p) as [number, number, number];
    assert.ok(!sphereTouchesColumn(column, behind, 0.5));
    const across = [far[0] + 400, far[1], far[2]] as [number, number, number];
    assert.ok(!sphereTouchesColumn(column, across, 0.5));
    // Out of the column by its centre, into it by its range: kept, no light is lost.
    assert.ok(sphereTouchesColumn(column, across, 401));
  });
}

test('a tile with a sky pixel lights its blend list from the column, whatever opaque it holds', () => {
  const code = LIGHT_TILES_SHADER.replace(/\s+/g, '');
  assert.ok(code.includes('atomicStore(&skyward,1u);'));
  assert.ok(code.includes('if(atomicLoad(&skyward)==0u){blendBox=tileBox(NEAR_ROW,BACK_ROW);}'));
  assert.ok(!code.includes('1.0e30'), 'never the whole world');
});

test('300 lamps before a sky tile: its blend list is their CPU culling, none dropped (#822)', () => {
  const v = view([0, 0, 0]),
    column = tileColumn(tileCorners(v, tile, 1, 1));
  // A lamp every metre down the tile's axis, five in six pushed sideways out of its column.
  const lamps = [...Array(300).keys()].map((i) => {
    const centre = onAxis(v, 0.1 / (1 + i));
    centre[0] += Math.min(1, i % 6) * 0.1 * (1 + i);
    return { centre, radius: 0.002 * (1 + i) };
  });
  const blend = [...lamps.keys()].filter((i) =>
    sphereTouchesColumn(column, lamps[i].centre, lamps[i].radius),
  );
  assert.ok(blend.length <= 64 && blend.some((i) => i >= 256), 'a list, kept past a batch');
  const layout = tileLayout(LIGHT_TILES_SHADER);
  const record = compactTile(layout, { opaque: [], blend }, 300);
  assert.deepEqual(tileLists(layout, record, 300), { opaque: [], blend });
});
