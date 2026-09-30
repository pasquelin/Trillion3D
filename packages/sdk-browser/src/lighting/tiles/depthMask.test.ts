import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import {
  sliceHits,
  tileBounds,
  toTileFrame,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import {
  depthAxis,
  depthBinsHit,
  pixelDepthBit,
} from '../../../../../bench/oracles/browser/gpuLightTileDepthMaskOracle.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import {
  NEAR,
  camera,
  pixelPoint,
  randomCase,
  tilePixel,
  type Vec3,
} from './tileCamera.fixture.ts';
import { LIGHT_TILES_SHADER } from '../../gpu/core/shaderTexts.fixture.ts';

// #1369: the opaque list keeps a light only if its range sphere covers a depth bin a pixel of the
// tile fills. A light term is exactly zero at or past its range (`directIncidence`), so the list
// stays image-exact if no light that reaches a pixel is dropped: checked in f64 on the views of
// `slicePlanes.test.ts` — the street to straight down from 2 km, 150 km from the world origin —,
// the mask built by its f32 port.

const SIZE = LIGHT_SETTINGS.tileSize;
type Light = { centre: Vec3; radius: number };

/** The tile's opaque list before and after the mask, each dropped light checked against every
 *  pixel point in f64. */
function maskTile(view: TileView, tile: [number, number], depths: number[], lights: Light[]) {
  const pixels = depths.flatMap((z, i) => {
    const [px, py] = tilePixel(tile, i);
    return px < view.width && py < view.height && z > 0
      ? [{ px, py, z, point: pixelPoint(view, px, py, z) }]
      : [];
  });
  const seen = pixels.map((p) => p.z);
  const bounds = tileBounds(view, tile, Math.max(...seen), Math.min(...seen));
  const axis = depthAxis(bounds.corners);
  const bins = pixels.reduce((or, p) => or | pixelDepthBit(view, axis, p.px, p.py, p.z), 0);
  let listed = 0,
    kept = 0;
  for (const { centre, radius } of lights) {
    const at = toTileFrame(view, centre);
    if (!sliceHits(bounds, at, radius).opaque) continue;
    listed++;
    if (depthBinsHit(bins, axis, at, radius)) {
      kept++;
      continue;
    }
    const reached = pixels.find((p) => Math.hypot(...p.point.map((v, a) => v - centre[a])) < radius);
    assert.equal(reached, undefined, `light ${centre} r ${radius} reaches a pixel it drops`);
  }
  return { listed, kept };
}

test('random views: the depth mask drops no light that reaches a pixel', () => {
  let listed = 0,
    kept = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const pitch = seed % 3 === 0 ? -Math.PI / 2 : (random(seed * 7)() * 120 - 90) * (Math.PI / 180);
    const { view, tile, depths, lights } = randomCase(seed, pitch);
    const counts = maskTile(view, tile, depths, lights);
    listed += counts.listed;
    kept += counts.kept;
  }
  // The random tiles hold nearer pixels in front of their surface: the mask drops some lights.
  assert.ok(kept < listed, `${kept} of ${listed} kept`);
});

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A random view whose tile sees a near block in front of a far surface, and lamps between and
 *  around them whose range stops a hair short of, at, or a hair past the nearest pixel depth. */
function gapCase(seed: number) {
  const r = random(seed),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const [width, height] = [Math.round(u(320, 1920)), Math.round(u(240, 1080))];
  const far = seed % 4 === 0 ? 150_000 : 5000;
  const eye: Vec3 = [u(-far, far), u(1.7, 2000), u(-far, far)];
  const view = camera(eye, u(-Math.PI, Math.PI), u(-1.5, 0.5), u(30, 100), width, height);
  const tile: [number, number] = [
    Math.floor(r() * Math.ceil(width / SIZE)),
    Math.floor(r() * Math.ceil(height / SIZE)),
  ];
  const near = Math.exp(u(Math.log(0.12), Math.log(300))),
    back = near * u(1.5, 20),
    edge = Math.floor(u(1, SIZE));
  const depths = [...Array(SIZE * SIZE).keys()].map((i) =>
    Math.fround(NEAR / (i % SIZE < edge ? near : back) / (1 + u(0, 0.01))),
  );
  const points = depths.flatMap((z, i) => {
    const [px, py] = tilePixel(tile, i);
    return px < width && py < height ? [pixelPoint(view, px, py, z)] : [];
  });
  // The view axis in f64: the normal of a plane of one depth.
  const [a, b, c] = [[0, 0], [width, 0], [0, height]].map(([x, y]) => pixelPoint(view, x, y, 0.5));
  const axis = cross3(sub3(b, a), sub3(c, a)),
    norm = Math.hypot(...axis);
  const depthOf = (p: Vec3) => (axis[0] * p[0] + axis[1] * p[1] + axis[2] * p[2]) / norm;
  const lights = [...Array(40).keys()].map(() => {
    const [px, py] = tilePixel(tile, Math.floor(r() * SIZE * SIZE));
    const centre = pixelPoint(view, px, py, NEAR / u(near * 0.5, back * 1.5)).map(Math.fround) as Vec3;
    // The range that just reaches the nearest pixel depth: the mask's own boundary.
    const gap = Math.min(...points.map((p) => Math.abs(depthOf(p) - depthOf(centre))));
    const hair = [-0.5, -0.1, -1e-3, -1e-6, 0, 1e-6, 1e-3][Math.floor(r() * 7)];
    return { centre, radius: Math.fround(gap * (1 + hair)) };
  });
  return { view, tile, depths, lights };
}

test('lamps a hair from their nearest pixel: the mask drops none that reaches one', () => {
  let listed = 0,
    kept = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { view, tile, depths, lights } = gapCase(seed);
    const counts = maskTile(view, tile, depths, lights);
    listed += counts.listed;
    kept += counts.kept;
  }
  // Lamps in the gap between the block and the surface leave the lists.
  assert.ok(kept < 0.9 * listed, `${kept} of ${listed} kept`);
});

/** A tile of the street view whose left half sees a column at 2 m, its right half a wall at 30 m. */
function columnTile() {
  const view = camera([3, 1.7, -2], 0.4, -0.05, 60, 1728, 1117);
  const tile: [number, number] = [54, 34];
  const depths = [...Array(SIZE * SIZE).keys()].map((i) =>
    Math.fround(NEAR / (i % SIZE < SIZE / 2 ? 2 : 30)),
  );
  /** A point on the tile's centre ray at view distance `d`. */
  const along = (d: number): Vec3 => pixelPoint(view, tile[0] * SIZE + 8, tile[1] * SIZE + 8, NEAR / d);
  return { view, tile, depths, along };
}

test('a lamp floating in the depth between a column and a wall leaves the list', () => {
  const { view, tile, depths, along } = columnTile();
  const lamp = (d: number, radius: number) => maskTile(view, tile, depths, [{ centre: along(d), radius }]);
  assert.deepEqual(lamp(12, 3), { listed: 1, kept: 0 }, 'in the gap: dropped');
  assert.deepEqual(lamp(3, 2), { listed: 1, kept: 1 }, 'reaching the column: kept');
  assert.deepEqual(lamp(28, 3), { listed: 1, kept: 1 }, 'reaching the wall: kept');
  assert.deepEqual(lamp(12, Infinity), { listed: 1, kept: 1 }, 'an infinite range: kept');
});

test('edge cases: a lamp touching one pixel, a flat tile, a tile every lamp reaches', () => {
  const { view, tile, depths } = columnTile();
  // A hair from pixel 0's point, a hair wide: it reaches that pixel alone.
  const [px, py] = tilePixel(tile, 0);
  const point = pixelPoint(view, px, py, depths[0]);
  const hair = { centre: point.map((v) => Math.fround(v + 0.002)) as Vec3, radius: 0.004 };
  assert.deepEqual(maskTile(view, tile, depths, [hair]), { listed: 1, kept: 1 });
  const flat = depths.map(() => depths[0]);
  assert.deepEqual(maskTile(view, tile, flat, [hair]), { listed: 1, kept: 1 }, 'a flat tile');
  // 256 lamps over every pixel: none dropped.
  const r = random(1369);
  const every = [...Array(256).keys()].map(() => ({
    centre: point.map((v) => Math.fround(v + r() - 0.5)) as Vec3,
    radius: 40,
  }));
  assert.deepEqual(maskTile(view, tile, depths, every), { listed: 256, kept: 256 });
});

test('the pass marks the bins of its pixels between the corner and bound barriers', () => {
  const code = LIGHT_TILES_SHADER.replace(/\s+/g, '');
  const at = (text: string, from = 0) => code.indexOf(text, from);
  const corners = at('tileCornerOfLane(tile.xy,lane);workgroupBarrier();');
  const bins = at('pixelDepthBit(pixel,z)', corners);
  assert.ok(corners > 0 && bins > corners, 'after the corners');
  assert.ok(at('}workgroupBarrier();walkLights(', bins) > bins, 'before the lights');
  assert.match(code, /letcovers=inside&&z>0\.0;letdepthBit=select\(0u,pixelDepthBit\(pixel,z\),covers\);/);
  // A light the opaque slice keeps is counted for the resolve's choice, then listed if it covers
  // a bin; the sun reaches every bin.
  assert.ok(
    code.includes(
      'if(keep.x){atomicAdd(&listed,1u);if(light.params.y>-1.0){atomicOr(&shadowed,1u);}if(sun||depthBinsHit(centre,light.positionRange.w))',
    ),
  );
});
