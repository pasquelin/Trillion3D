import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import {
  sliceHits,
  sphereTouchesBox,
  tileBounds,
  toTileFrame,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { NEAR, camera, pixelPoint, segmentDistance, type Vec3 } from './tileCamera.fixture.ts';
import { LIGHT_TILES_SHADERS } from './shader.ts';

/** The light-tile shader texts the engine compiles, by name. */
const LIGHT_TILES_SHADER_TEXTS = new Map<string, string>(LIGHT_TILES_SHADERS);
const LIGHT_TILES_SHADER = LIGHT_TILES_SHADER_TEXTS.get('LIGHT_TILES_SHADER')!;

// #924 (OMB-03): a light is kept in a slice only if its range sphere meets the slice's box AND
// the six planes of the tile's frustum. A light term is exactly zero at or past its range
// (`directIrradiance`), so the lists stay image-exact if every light that reaches one point of the
// slice is kept: checked here in f64 against the box-only lists of before, on random views — from
// the street to straight down from 2 km, up to 150 km from the world origin — and random lights
// near the tile's own pixels.

const SIZE = LIGHT_SETTINGS.tileSize;

type Light = { centre: Vec3; radius: number };
type Counts = Record<'opaqueBefore' | 'opaque' | 'blendBefore' | 'blend', number>;
const noCounts = (): Counts => ({ opaqueBefore: 0, opaque: 0, blendBefore: 0, blend: 0 });
/** Pixel `i` of the tile, row by row. */
const tilePixel = (tile: number[], i: number) =>
  [tile[0] * SIZE + (i % SIZE), tile[1] * SIZE + Math.floor(i / SIZE)] as const;

/** Checks each light of a tile with no sky pixel, counting what each list keeps, before and now. */
function checkTile(
  view: TileView,
  tile: [number, number],
  depths: number[],
  lights: Light[],
  counts = noCounts(),
) {
  const pixels: { z: number; near: Vec3; point: Vec3 }[] = [];
  depths.forEach((z, i) => {
    const [px, py] = tilePixel(tile, i);
    if (px < view.width && py < view.height)
      pixels.push({ z, near: pixelPoint(view, px, py, 1), point: pixelPoint(view, px, py, z) });
  });
  // The shader reduces the depths of the pixels inside the image only.
  const seen = pixels.map((p) => p.z),
    front = Math.fround(Math.max(...seen)),
    back = Math.fround(Math.min(...seen));
  const bounds = tileBounds(view, tile, front, back);
  for (const { centre, radius } of lights) {
    const at = toTileFrame(view, centre);
    const opaqueBefore = sphereTouchesBox(bounds.opaqueBox, at, radius),
      blendBefore = sphereTouchesBox(bounds.blendBox, at, radius);
    const { opaque, blend } = sliceHits(bounds, at, radius);
    // Only a dropped light needs the scan of the pixels it could reach.
    const reach = (from: 'near' | 'point') =>
      pixels.some((p) => segmentDistance(p[from], p.point, centre) < radius);
    const where = `light ${centre} r ${radius}, tile ${tile}, depths ${front}..${back}`;
    assert.ok(opaque || !reach('point'), `an opaque pixel it reaches loses it: ${where}`);
    assert.ok(blend || !reach('near'), `a blend point it reaches loses it: ${where}`);
    const kept = { opaqueBefore, opaque, blendBefore, blend };
    for (const key of Object.keys(kept) as (keyof Counts)[]) counts[key] += +kept[key];
  }
  return counts;
}

/** A random view, tile, depth field and lights near the tile's pixels. */
function randomCase(seed: number, pitch: number) {
  const r = random(seed),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const [width, height] = [Math.round(u(320, 1920)), Math.round(u(240, 1080))];
  const far = seed % 4 === 0 ? 150_000 : 5000;
  const eye: Vec3 = [u(-far, far), u(1.7, 2000), u(-far, far)];
  const view = camera(eye, u(-Math.PI, Math.PI), pitch, u(30, 100), width, height);
  const tile: [number, number] = [
    Math.floor(r() * Math.ceil(width / SIZE)),
    Math.floor(r() * Math.ceil(height / SIZE)),
  ];
  // A slanted surface, its distance growing across the tile, with a few pixels on nearer objects.
  const [d0, dx, dy] = [Math.exp(u(Math.log(0.12), Math.log(3000))), u(-0.3, 0.3), u(-0.3, 0.3)];
  const depths = [...Array(SIZE * SIZE).keys()].map((i) => {
    const d =
      d0 *
      (1 + (dx * (i % SIZE) + dy * Math.floor(i / SIZE)) / SIZE) *
      (r() < 0.05 ? u(0.2, 1) : 1);
    return Math.fround(Math.min(1, NEAR / Math.max(d, NEAR)));
  });
  const lights = [...Array(60).keys()].map(() => {
    const i = Math.floor(r() * depths.length);
    const at = pixelPoint(view, ...tilePixel(tile, i), depths[i]);
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

test('random views: every light that reaches the slice is kept', () => {
  const total = noCounts();
  for (let seed = 1; seed <= 600; seed++) {
    const pitch = seed % 3 === 0 ? -Math.PI / 2 : (random(seed * 7)() * 120 - 90) * (Math.PI / 180);
    const { view, tile, depths, lights } = randomCase(seed, pitch);
    checkTile(view, tile, depths, lights, total);
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
    const [px, py] = tilePixel(tile, i);
    const near = pixelPoint(view, px, py, 1),
      far = pixelPoint(view, px, py, NEAR / 1e5);
    const t = near[1] / (near[1] - far[1]);
    return Math.fround(NEAR / (NEAR + t * (1e5 - NEAR)));
  });
  const grid: Light[] = [];
  for (let x = -300; x <= 300; x += 10)
    for (let z = -300; z <= 300; z += 10) grid.push({ centre: [x, 0.5, z], radius: 6 });
  const counts = checkTile(view, tile, depths, grid);
  // The blend box runs from the near plane to the ground, where the column is a thin shaft.
  assert.ok(counts.blend * 10 < counts.blendBefore, JSON.stringify(counts));
  assert.ok(counts.opaque <= counts.opaqueBefore, JSON.stringify(counts));
});

test('edge cases: a flat tile, the near plane, the far distance, infinite and NaN ranges', () => {
  const view = camera([12, 40, -7], 1, -0.7, 70, 1270, 710);
  const tile: [number, number] = [79, 44]; // the last, cut tile on both axes
  for (const z of [1, 0.5, NEAR / 1e5]) {
    const depths = Array<number>(SIZE * SIZE).fill(Math.fround(z));
    // The light buffer holds f32 centres.
    const at = pixelPoint(view, tile[0] * SIZE, tile[1] * SIZE, z).map(Math.fround) as Vec3;
    const lights = [at, [at[0], at[1] + 1, at[2]] as Vec3].map((centre, i) => ({
      centre,
      radius: i + 1e-3,
    }));
    checkTile(view, tile, depths, lights);
    const bounds = tileBounds(view, tile, Math.fround(z), Math.fround(z));
    const hits = (radius: number) => sliceHits(bounds, toTileFrame(view, at), radius);
    assert.deepEqual([hits(Infinity), hits(NaN)].map(Object.values), [
      [true, true],
      [false, false],
    ]);
  }
});

test('the pass tests each light in the frame of its planes', () => {
  const code = LIGHT_TILES_SHADER.replace(/\s+/g, '');
  assert.ok(code.includes('sliceHits(light.positionRange.xyz-view.origin.xyz,'));
});
