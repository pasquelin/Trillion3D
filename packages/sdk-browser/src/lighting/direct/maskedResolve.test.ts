import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DIRECT_LIGHTING_WGSL, directLightingWgsl } from './lightingWgsl.ts';
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { compactTile, tileLayout } from '../../../../../bench/oracles/browser/gpuLightTilesRankOracle.ts';
import {
  sliceHits,
  tileBounds,
  toTileFrame,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import {
  depthAxis,
  depthBinsHit,
  pixelDepthBit,
} from '../../../../../bench/oracles/browser/gpuLightTileDepthMaskOracle.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { NEAR, camera, pixelPoint, tilePixel, type Vec3 } from '../tiles/tileCamera.fixture.ts';
import {
  LIGHT_TILES_NARROW_SHADER,
  LIGHT_TILES_SHADER,
} from '../../gpu/core/shaderTexts.fixture.ts';

// #1369: the lighting of a pixel equals develop's with the opaque list's depth mask, for random
// lamp sets of 1 to 256 and the edge cases — a lamp touching one pixel, a tile every lamp reaches.
// The shipped resolve (`contractLighting` and every function under it, narrow and wide) runs as
// JavaScript on the tile record the pass's oracles write: develop's list, and the masked list
// with the pass's choice word. A lamp term is exactly zero at or past its range, as
// `directIncidence` gives it; the sums of both records meet to the bit, still and moving, drawn
// or summed in full.

const SIZE = LIGHT_SETTINGS.tileSize;
const SAMPLES = LIGHT_SETTINGS.samplesPerPixel;
type Lamp = { centre: Vec3; radius: number; power: number; shadowed: boolean };

/** A lamp's term at `P`, zero at or past its range; its sampling weight, zero there too. */
const reach = (lamp: Lamp, P: Vec3) => Math.fround(Math.hypot(...P.map((v, a) => v - lamp.centre[a])));
const term = (lamp: Lamp, P: Vec3) => {
  const d = reach(lamp, P);
  return d >= lamp.radius ? 0 : Math.fround((lamp.power * (1 - d / lamp.radius) ** 2) / (d * d + 1e-4));
};
const weight = (lamp: Lamp, P: Vec3) => (reach(lamp, P) >= lamp.radius ? 0 : term(lamp, P) * 0.7);

/** The shipped resolve as JavaScript over one tile's record. */
function resolve(lamps: Lamp[], record: Uint32Array, rank: number, narrow: boolean) {
  const source = (narrow ? directLightingWgsl(true) : DIRECT_LIGHTING_WGSL).replace(
    'var chosen:array<u32,LIGHT_SAMPLES>;',
    'var chosen=array();',
  );
  const names = ['contractLighting', 'pixelTile', 'tileShadowed', 'tileLighting', 'tileSlice'];
  names.push('sliceLighting', 'sampledTileLighting', 'listedWeight');
  const { contractLighting } = shaderFunctions<{ contractLighting: (...a: unknown[]) => number }>(
    source,
    names,
    {
      ...wgslConstants(source),
      view: { lightParams: { x: lamps.length, y: 1, z: 1 }, viewport: { w: rank } },
      tileLights: record,
      directLights: { count: lamps.length, items: lamps },
      vec3f: () => 0,
      array: () => [],
      fract: (x: number) => x - Math.floor(x),
      hashUnit: (seed: number) => ((seed * 2654435761) >>> 0) / 2 ** 32,
      declaredLight: (lamp: Lamp, ...a: unknown[]) => term(lamp, a[5] as Vec3) * (lamp.shadowed ? 0.5 : 1),
      lightWeight: (lamp: Lamp, _N: unknown, P: Vec3) => weight(lamp, P),
    },
  );
  return (P: Vec3, i: number) =>
    contractLighting(0, 0, 0, 0, 0, P, 0, { x: (i % SIZE) + 0.5, y: Math.floor(i / SIZE) + 0.5 });
}

/** A tile of a random view: a near block beside a far surface, `count` lamps between and about
 *  them, `touch` one of them a hair from one pixel alone, `every` all of them over every pixel. */
function scene(seed: number, count: number, { touch = false, every = false } = {}) {
  const r = random(seed),
    u = (lo: number, hi: number) => lo + (hi - lo) * r();
  const view = camera([u(-500, 500), u(1.7, 40), u(-500, 500)], u(-3, 3), u(-0.8, 0.2), 60, 1728, 1117);
  const tile: [number, number] = [Math.floor(u(0, 108)), Math.floor(u(0, 69))];
  const [near, edge] = [u(1, 20), Math.floor(u(1, SIZE))];
  const far = near * u(1.5, 8);
  const depths = [...Array(SIZE * SIZE).keys()].map((i) => Math.fround(NEAR / (i % SIZE < edge ? near : far)));
  const points = depths.map((z, i) => pixelPoint(view, ...tilePixel(tile, i), z));
  const lamps = Array.from({ length: count }, (): Lamp => {
    const [px, py] = tilePixel(tile, Math.floor(r() * SIZE * SIZE));
    const centre = pixelPoint(view, px, py, NEAR / u(near * 0.5, far * 1.3)).map(Math.fround) as Vec3;
    const radius = Math.fround(every ? far * 4 : u(0.05, 0.6) * far);
    return { centre, radius, power: u(1, 20), shadowed: r() < 0.3 };
  });
  if (touch) lamps[count >> 1] = { ...lamps[count >> 1], centre: points[0].map((v) => Math.fround(v + 0.002)) as Vec3, radius: 0.004 };
  return { view, tile, depths, points: points.map((p) => p.map(Math.fround) as Vec3), lamps };
}

/** The pixels' lighting from develop's record and from the masked one, still and moving. */
function compare(seed: number, count: number, options = {}) {
  const { view, tile, depths, points, lamps } = scene(seed, count, options);
  const bounds = tileBounds(view, tile, Math.max(...depths), Math.min(...depths));
  const axis = depthAxis(bounds.corners);
  const bins = depths.reduce((or, z, i) => or | pixelDepthBit(view, axis, ...tilePixel(tile, i), z), 0);
  const develop = lamps.flatMap((l, i) => (sliceHits(bounds, toTileFrame(view, l.centre), l.radius).opaque ? [i] : []));
  const masked = develop.filter((i) => depthBinsHit(bins, axis, toTileFrame(view, lamps[i].centre), lamps[i].radius));
  const narrow = count <= LIGHT_SETTINGS.tileLights;
  const layout = tileLayout(narrow ? LIGHT_TILES_NARROW_SHADER : LIGHT_TILES_SHADER);
  const shadowed = lamps.flatMap((l, i) => (l.shadowed ? [i] : []));
  const record = (opaque: number[]) =>
    compactTile(layout, { opaque, listed: develop, blend: [], shadowed }, count, undefined, {
      capacity: narrow ? 0 : count,
      head: 0,
      overflow: 0,
    });
  const [before, after] = [record(develop), record(masked)];
  for (const rank of [0, 37]) {
    const [a, b] = [resolve(lamps, before, rank, narrow), resolve(lamps, after, rank, narrow)];
    points.forEach((P, i) => assert.ok(Object.is(a(P, i), b(P, i)), `${count} lamps, rank ${rank}, pixel ${i}`));
  }
  return { develop: develop.length, masked: masked.length, drawn: after[layout.shadowBase] === 1 };
}

test('a pixel lights as on develop, 1 to 256 lamps, still and moving, with the depth mask', () => {
  const runs = [1, 2, 3, 4, 5, 6, 9, 17, 33, 48, 64, 65, 120, 200, 256].flatMap((count) =>
    [1, 2, 3, 4].map((k) => compare(count * 7 + k, count)),
  );
  for (let k = 0; k < 8; k++) runs.push(compare(9000 + k, 1 + Math.floor(random(k)() * 256)));
  // The cases reach what they are for: shorter lists, drawn lists, a drawn list the mask took to
  // the sample budget or below — the pass's word keeps it drawn, as develop drew it.
  assert.ok(runs.some((c) => c.masked < c.develop));
  assert.ok(runs.some((c) => c.drawn));
  assert.ok(runs.some((c) => c.drawn && c.masked <= SAMPLES));
});

test('edge cases: a lamp touching one pixel, a tile every lamp reaches', () => {
  for (const count of [1, 40, 256]) compare(1369 + count, count, { touch: true });
  for (const count of [LIGHT_SETTINGS.tileLights, 256]) {
    const all = compare(4242 + count, count, { every: true });
    assert.equal(all.masked, count, 'every lamp listed, none dropped');
  }
});
