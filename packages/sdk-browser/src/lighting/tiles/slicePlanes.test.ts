import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import {
  sphereTouchesBlendSlice,
  sphereTouchesBox,
  sphereTouchesOpaqueSlice,
  tileBounds,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { LIGHT_TILES_SHADER } from './shader.ts';
import { NEAR, camera, pixelPoint, segmentDistance, type Vec3 } from './tileCamera.fixture.ts';

// #924 (OMB-03): a light is kept in a slice only if its range sphere meets the slice's box AND
// the six planes of the tile's frustum. A light term is exactly zero at or past its range
// (`directIrradiance`), so the lists stay image-exact if every light that reaches one point of the
// slice is kept: checked here against the box-only lists of before, on random views — from the
// street to straight down from 2 km — and random lights near the tile's own pixels.

const SIZE = LIGHT_SETTINGS.tileSize;

type Pixel = { near: Vec3; point: Vec3 };
type Light = { centre: Vec3; radius: number };

/** Checks each light of a tile with no sky pixel; returns how many each list keeps, before and now. */
function checkTile(view: TileView, tile: [number, number], depths: number[], lights: Light[]) {
  const pixels: Pixel[] = [];
  depths.forEach((z, i) => {
    const px = tile[0] * SIZE + (i % SIZE),
      py = tile[1] * SIZE + Math.floor(i / SIZE);
    if (px < view.width && py < view.height)
      pixels.push({ near: pixelPoint(view, px, py, 1), point: pixelPoint(view, px, py, z) });
  });
  const kept = Math.fround,
    front = kept(Math.max(...depths)),
    back = kept(Math.min(...depths));
  const bounds = tileBounds(view, tile, front, back);
  const counts = { opaqueBefore: 0, opaque: 0, blendBefore: 0, blend: 0 };
  for (const { centre, radius } of lights) {
    const opaqueBefore = sphereTouchesBox(bounds.opaqueBox, centre, radius),
      blendBefore = sphereTouchesBox(bounds.blendBox, centre, radius);
    const opaque = sphereTouchesOpaqueSlice(bounds, centre, radius),
      blend = sphereTouchesBlendSlice(bounds, centre, radius);
    const lit = pixels.some((p) => Math.hypot(...p.point.map((v, a) => v - centre[a])) < radius);
    const litInFront = pixels.some((p) => segmentDistance(p.near, p.point, centre) < radius);
    const at = `light ${centre} r ${radius}, tile ${tile}, depths ${front}..${back}`;
    assert.ok(!lit || opaque, `an opaque pixel it reaches loses it: ${at}`);
    assert.ok(!litInFront || blend, `a blend point it reaches loses it: ${at}`);
    assert.ok(!opaque || opaqueBefore, `kept now, not before: ${at}`);
    assert.ok(!blend || blendBefore, `kept now, not before: ${at}`);
    counts.opaqueBefore += +opaqueBefore;
    counts.opaque += +opaque;
    counts.blendBefore += +blendBefore;
    counts.blend += +blend;
  }
  return counts;
}

/** A random view, tile, depth field and lights near the tile's pixels. */
function randomCase(seed: number, pitch: number) {
  const r = mulberry32(seed),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const [width, height] = [Math.round(u(320, 1920)), Math.round(u(240, 1080))];
  const eye: Vec3 = [u(-5000, 5000), u(1.7, 2000), u(-5000, 5000)];
  const view = camera(eye, u(-Math.PI, Math.PI), pitch, u(30, 100), width, height);
  const tile: [number, number] = [
    Math.floor(r() * Math.ceil(width / SIZE)),
    Math.floor(r() * Math.ceil(height / SIZE)),
  ];
  // A slanted surface, its distance growing across the tile, with a few pixels on nearer objects.
  const [d0, dx, dy] = [Math.exp(u(Math.log(0.2), Math.log(3000))), u(-0.3, 0.3), u(-0.3, 0.3)];
  const depths = [...Array(SIZE * SIZE).keys()].map((i) => {
    const d =
      d0 *
      (1 + (dx * (i % SIZE) + dy * Math.floor(i / SIZE)) / SIZE) *
      (r() < 0.05 ? u(0.2, 1) : 1);
    return Math.fround(Math.min(1, NEAR / Math.max(d, NEAR)));
  });
  const lights = [...Array(60).keys()].map(() => {
    const i = Math.floor(r() * depths.length);
    const at = pixelPoint(
      view,
      tile[0] * SIZE + (i % SIZE),
      tile[1] * SIZE + Math.floor(i / SIZE),
      depths[i],
    );
    const radius = Math.exp(u(Math.log(0.01), Math.log(200)));
    const reach = u(0, 2) * radius;
    const dir = [u(-1, 1), u(-1, 1), u(-1, 1)],
      len = Math.hypot(...dir) || 1;
    return {
      centre: at.map((v, a) => Math.fround(v + (dir[a] / len) * reach)) as Vec3,
      radius: Math.fround(radius),
    };
  });
  return { view, tile, depths, lights };
}

test('random views: every light that reaches the slice is kept, none the box did not keep', () => {
  const total = { opaqueBefore: 0, opaque: 0, blendBefore: 0, blend: 0 };
  for (let seed = 1; seed <= 600; seed++) {
    const pitch =
      seed % 3 === 0 ? -Math.PI / 2 : (mulberry32(seed * 7)() * 120 - 90) * (Math.PI / 180);
    const { view, tile, depths, lights } = randomCase(seed, pitch);
    const counts = checkTile(view, tile, depths, lights);
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += counts[key];
  }
  // The planes are the point: they drop lights the loose box kept.
  assert.ok(total.opaque < total.opaqueBefore, JSON.stringify(total));
  assert.ok(total.blend < total.blendBefore, JSON.stringify(total));
});

test('looking down from 150 m: the planes drop the lamps the blend box keeps', () => {
  const view = camera([0, 150, 0], 0.3, -Math.PI / 2 + 0.6, 60, 1920, 1080);
  const tile: [number, number] = [100, 10];
  // The ground y = 0 under each pixel: its view distance is affine along the pixel's ray.
  const depths = [...Array(SIZE * SIZE).keys()].map((i) => {
    const [px, py] = [tile[0] * SIZE + (i % SIZE), tile[1] * SIZE + Math.floor(i / SIZE)];
    const near = pixelPoint(view, px, py, 1),
      far = pixelPoint(view, px, py, NEAR / 1e5);
    const t = near[1] / (near[1] - far[1]);
    return Math.fround(NEAR / (NEAR + t * (1e5 - NEAR)));
  });
  const grid: Light[] = [];
  for (let x = -300; x <= 300; x += 10)
    for (let z = -300; z <= 300; z += 10) grid.push({ centre: [x, 0.5, z], radius: 6 });
  const counts = checkTile(view, tile, depths, grid);
  // The blend box runs from the near plane down to the ground: tall and wide, where the column
  // is a thin shaft. The flat ground's opaque slice is thin already, its box tight.
  assert.ok(counts.blend * 10 < counts.blendBefore, JSON.stringify(counts));
  assert.ok(counts.opaque <= counts.opaqueBefore, JSON.stringify(counts));
});

test('edge cases: a flat tile, the near plane, the far distance, infinite and NaN ranges', () => {
  const view = camera([12, 40, -7], 1, -0.7, 70, 1280, 720);
  const tile: [number, number] = [79, 44]; // the last, cut tile on both axes
  for (const z of [1, 0.5, NEAR / 1e5]) {
    const depths = Array<number>(SIZE * SIZE).fill(Math.fround(z));
    const at = pixelPoint(view, tile[0] * SIZE, tile[1] * SIZE, z);
    const lights: Light[] = [
      { centre: at, radius: 1e-3 },
      { centre: [at[0], at[1] + 1, at[2]], radius: 1.001 },
      { centre: [1e6, 0, 0], radius: Infinity },
    ];
    checkTile(view, tile, depths, lights);
    const bounds = tileBounds(view, tile, Math.fround(z), Math.fround(z));
    assert.ok(
      sphereTouchesOpaqueSlice(bounds, [1e6, 0, 0], Infinity),
      'an infinite range reaches all',
    );
    assert.ok(!sphereTouchesOpaqueSlice(bounds, at, NaN), 'a NaN range is dropped, as the box did');
    assert.ok(!sphereTouchesBox(bounds.opaqueBox, at, NaN));
  }
});

test('the pass tests both slices against the planes, the sky column unchanged', () => {
  assert.match(LIGHT_TILES_SHADER, /sun\|\|sphereTouchesOpaqueSlice\(centre,radius\)/);
  assert.match(LIGHT_TILES_SHADER, /blendTouched=sphereTouchesBlendSlice\(centre,radius\);/);
  assert.match(
    LIGHT_TILES_SHADER,
    /tileColumn\(tile\.xy\);\n\s*if\(atomicLoad\(&covered\)==1u\)\{[^\n]*tileSlab\(/,
  );
});
