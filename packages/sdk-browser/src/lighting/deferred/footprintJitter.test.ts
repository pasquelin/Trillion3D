// #1363: the shadow level a pixel reads, from the shipped `pixelLevel` run through `shaderRun`
// over a floor the camera looks down at, rasterized at each phase of the TAA's jitter cycle: the
// sun level and the lamp mip of every floor pixel are the same at every phase — where develop's
// footprint, taken at the jittered sample, moves some of them —, and with no jitter the footprint
// and the point are develop's, to the bit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix4, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import { perspectiveProjection } from '../../../../sdk-core/src/math/primitives/camera.ts';
import { PAGES } from '../../../../sdk-core/src/scene/light-shadow/pageModel.ts';
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts';
import { TAA_SAMPLES, jitterViewProjection, taaJitter } from '../../taa/jitter.ts';
import { PIXEL_FOOTPRINT_WGSL } from './footprintWgsl.ts';
import { WORLD_AT_WGSL } from './shaders.ts';
import { shadowJitterWords } from './view.ts';

type V = number[];
type Level = { footprint: number; unjitter: V };
const W = 64,
  H = 48,
  LAMP = [0.3, 3, -6],
  FINEST = -40;
/** The view and depth buffer the shipped functions read: rewritten per phase. */
const live = {
  view: { inverseViewProjection: new Mat([]), viewport: [W, H, 0, 0], jitter: [0, 0, 1, 0] },
  depth: new Float64Array(W * H),
};
const run = shaderRun<{
  pixelLevel: (coord: V, pixel: V, z: number, P: V) => Level;
  worldAt: (pixel: V, z: number) => V;
}>(WORLD_AT_WGSL + PIXEL_FOOTPRINT_WGSL, ['pixelLevel', 'unjitteredDepth', 'worldAt'], {
  view: live.view,
  depth: null,
  textureLoad: (_: unknown, [x, y]: V) => live.depth[y * W + x],
  PixelLevel: (footprint: number, unjitter: V) => ({ footprint, unjitter }),
});

/** A camera two metres up, pitched 25° down, a 60° field: its view-projection. */
function cameraViewProjection() {
  const pitch = (25 * Math.PI) / 180,
    s = Math.sin(pitch),
    c = Math.cos(pitch);
  const world = new Float64Array([1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 2, 0, 1]);
  const view = invertMatrix4(new Float64Array(16), world),
    projection = perspectiveProjection(new Float64Array(16), 60, W / H, 0.1, 1);
  return multiplyMatrix4(new Float64Array(16), projection, view);
}
const VIEW_PROJECTION = cameraViewProjection();

/** The image of phase `sample`: its view, and the depth of the floor `y = 0` at each pixel's
 *  jittered sample, 0 — the far clear — where the ray misses it. */
function phase(sample: number) {
  const jitter = taaJitter(sample, new Float64Array(2));
  const vp = jitterViewProjection(
    new Float64Array(16),
    VIEW_PROJECTION,
    jitter[0],
    jitter[1],
    W,
    H,
  );
  live.view.inverseViewProjection = new Mat([...invertMatrix4(new Float64Array(16), vp)]);
  live.view.jitter = shadowJitterWords(jitter);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const near = run.worldAt([x + 0.5, y + 0.5], 1),
        far = run.worldAt([x + 0.5, y + 0.5], 0.5);
      const t = near[1] / (near[1] - far[1]);
      const hit = near.map((n, i) => n + (far[i] - n) * t);
      const clip = [0, 1, 2, 3].map((r) =>
        [0, 1, 2].reduce((sum, i) => sum + vp[i * 4 + r] * hit[i], vp[12 + r]),
      );
      live.depth[y * W + x] = t > 0 ? clip[2] / clip[3] : 0;
    }
}

/** Sun level and lamp mip of pixel `(x, y)` from its footprint and the point its mip is read at. */
const levels = (footprint: number, at: V) => {
  const radius = Math.hypot(...LAMP.map((l, i) => l - at[i]));
  return [
    PAGES.shadowSunReadLevel(footprint, FINEST),
    PAGES.shadowLampReadMip(footprint, PAGES.shadowLampFinestTexel(1, radius)),
  ];
};

/** Every floor pixel whose four neighbours are floor too, at every phase: its levels, the shipped
 *  read's and develop's, one row per phase. */
function levelsAcrossPhases() {
  const shipped = new Map<number, string[]>(),
    developed = new Map<number, string[]>(),
    floor = new Set<number>();
  for (let sample = 0; sample < TAA_SAMPLES; sample++) {
    phase(sample);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x,
          z = live.depth[i];
        if (
          [z, live.depth[i - 1], live.depth[i + 1], live.depth[i - W], live.depth[i + W]].some(
            (d) => d <= 0,
          )
        ) {
          floor.delete(i);
          continue;
        }
        if (sample === 0) floor.add(i);
        const P = run.worldAt([x + 0.5, y + 0.5], z);
        const level = run.pixelLevel([x, y], [x + 0.5, y + 0.5], z, P);
        const footprint = Math.hypot(...run.worldAt([x + 1.5, y + 0.5], z).map((v, k) => v - P[k]));
        shipped.set(i, [
          ...(shipped.get(i) ?? []),
          `${levels(
            level.footprint,
            P.map((p, k) => p + level.unjitter[k]),
          )}`,
        ]);
        developed.set(i, [...(developed.get(i) ?? []), `${levels(footprint, P)}`]);
      }
  }
  return { floor: [...floor], shipped, developed };
}

test('the shadow level of a pixel is the same at every phase of the TAA jitter', () => {
  const { floor, shipped, developed } = levelsAcrossPhases();
  assert.ok(floor.length > W * 10, 'the floor fills rows of the image');
  const moved = (reads: Map<number, string[]>) =>
    floor.filter((i) => new Set(reads.get(i)).size > 1);
  assert.deepEqual(moved(shipped), [], 'no floor pixel changes its sun level or lamp mip');
  // The floor crosses several sun levels and lamp mips: develop's read moves pixels along them.
  assert.ok(new Set(floor.map((i) => shipped.get(i)![0])).size >= 4, 'several levels on the floor');
  assert.ok(moved(developed).length > 0, 'develop moves pixels along the level boundaries');
});

test('with no jitter, the footprint and the point are develop’s, to the bit', () => {
  phase(0);
  live.view.jitter = shadowJitterWords(null);
  for (let i = W * 20; i < W * 21; i++) {
    const x = i % W,
      y = Math.floor(i / W),
      z = live.depth[i];
    const P = run.worldAt([x + 0.5, y + 0.5], z);
    const level = run.pixelLevel([x, y], [x + 0.5, y + 0.5], z, P);
    const footprint = Math.hypot(...run.worldAt([x + 1.5, y + 0.5], z).map((v, k) => v - P[k]));
    assert.equal(level.footprint, footprint);
    assert.deepEqual(level.unjitter, [0, 0, 0]);
  }
});
