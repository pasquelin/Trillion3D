// #443: the ground truth the grazing fixtures are judged against — a footprint integral along the
// minified axis alone —, and the judgement itself: a gap counted in pixels over one level,
// silhouettes aside; the engine within tolerance and no farther from the truth than the witness.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts';
import { cameraFace } from './sharedSceneProof.ts';
import { backgroundRgb } from '../../../packages/sdk-browser/src/visibility/math.ts';
import {
  linearToSrgb8,
  srgbToLinear,
} from '../../../packages/sdk-core/src/math/primitives/color.ts';
import { groundTruth, truthGap, truthVerdict, type TruthView } from './groundTruth.ts';

const SIZE = 24;
const CLEAR = 0x2a303c,
  BEHIND = 0x6a3d9a;
const behind = { place: new Matrix4().makeTranslation(0, 0, -1), half: 2, colour: BEHIND };

/** A face-on view of the square wearing a 2×1 map of these two texels, `repeat` times each way. */
const view = (texels: number[][], extra: Partial<TruthView> = {}, repeat = 1): TruthView => ({
  size: SIZE,
  camera: cameraFace(),
  square: { place: new Matrix4(), half: 1 },
  map: {
    data: texels.flat(),
    width: texels.length,
    height: 1,
    srgb: true,
    uv: [repeat, 0, 0, 0, repeat, 0, 0, 0, 1],
  },
  alphaTest: 0,
  clear: CLEAR,
  ...extra,
});
const rgb = (image: Uint8Array, x: number, y: number, size = SIZE) =>
  Array.from(image.subarray((y * size + x) * 4, (y * size + x) * 4 + 3));
const CENTRE = SIZE >> 1;

test('the square shows its texel, the clear colour lies around it, a silhouette is an edge', () => {
  const red = [255, 0, 0, 255];
  const truth = groundTruth(view([red, red]), 4);
  assert.deepEqual(rgb(truth.rgba, CENTRE, CENTRE), [255, 0, 0]);
  assert.deepEqual(rgb(truth.rgba, 0, 0), backgroundRgb(CLEAR));
  assert.equal(truth.edge[CENTRE * SIZE + CENTRE], 0);
  assert.equal(truth.edge[0], 0);
  const edges = truth.edge.filter(Boolean).length;
  assert.ok(edges > 0 && edges < SIZE * 4, `${edges} edge pixels: one ring round the square`);
  const turned = new Matrix4().makeRotationX((-75 * Math.PI) / 180);
  const grazing = groundTruth(view([red, red], { square: { place: turned, half: 1 } }), 4);
  assert.deepEqual(rgb(grazing.rgba, CENTRE, CENTRE), [255, 0, 0]);
  assert.deepEqual(rgb(grazing.rgba, CENTRE, 3), backgroundRgb(CLEAR), 'turned away: a thin band');
});

test('texels finer than a pixel mix in linear light, as a perfect sampler converges', () => {
  // Black and white texels, 64 of each across the square: every pixel spans eight or nine of
  // them, so its share of white is a half within one texel — within 8 levels of the half-grey.
  const truth = groundTruth(
    view(
      [
        [0, 0, 0, 255],
        [255, 255, 255, 255],
      ],
      {},
      64,
    ),
    8,
  );
  for (const channel of rgb(truth.rgba, CENTRE, CENTRE))
    assert.ok(Math.abs(channel - 188) <= 8, `${channel}: linear half-grey is sRGB 188, not 128`);
});

test('a texel under the cutoff lets the ray through to the square behind', () => {
  const clearTexel = [0, 255, 0, 0];
  const through = groundTruth(view([clearTexel, clearTexel], { alphaTest: 0.5, behind }), 4);
  assert.deepEqual(rgb(through.rgba, CENTRE, CENTRE), backgroundRgb(BEHIND));
  const kept = groundTruth(view([clearTexel, clearTexel], { behind }), 4);
  assert.deepEqual(rgb(kept.rgba, CENTRE, CENTRE), [0, 255, 0], 'no cutoff: the texel is shown');
});

test('a gap counts the pixels over one level on a channel, never a silhouette', () => {
  const truth = groundTruth(
    view([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]),
    4,
  );
  const image = truth.rgba.slice();
  assert.deepEqual(truthGap(image, truth), { pixels: 0, max: 0 });
  const centre = (CENTRE * SIZE + CENTRE) * 4;
  image[centre + 1] += 1;
  assert.deepEqual(truthGap(image, truth), { pixels: 0, max: 1 }, 'one level: two roundings');
  image[centre + 1] += 2;
  const edge = truth.edge.indexOf(1) * 4;
  image[edge] = 255 - image[edge];
  assert.deepEqual(truthGap(image, truth), { pixels: 1, max: 3 }, 'the edge pixel is not read');
});

test('the engine passes within tolerance and no farther from the truth than the witness', () => {
  const gap = (pixels: number) => ({ pixels, max: 9 });
  assert.equal(truthVerdict(gap(0), gap(5), 0), undefined);
  assert.equal(truthVerdict(gap(3), gap(3), 4), undefined);
  assert.match(truthVerdict(gap(1), gap(5), 0)!, /1 px from the ground truth, tolerance 0 px/);
  assert.match(truthVerdict(gap(3), gap(2), 4)!, /farther than the witness's 2 px/);
});

// The review of #443: a truth that averaged a magnified axis too, and cut each ray, could be met by
// no sampler. On the fixtures' maps, magnified — face-on, near two pixels a texel, the map's own
// shape at its fixture repeat —, a perfect one-read sampler (the base level, bilinear, cut once)
// is the truth. A minified axis is still integrated: that is what an anisotropic read does.
test('a perfect one-read sampler is the truth where the map is magnified', () => {
  const texels = (leaf: (x: number) => number[]) =>
    Array.from({ length: 64 }, (_, i) => leaf(i % 8)).flat();
  const stripes = texels((x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
    foliage = texels((x) => (x % 4 < 2 ? [46, 139, 58, 255] : [0, 0, 0, 0]));
  for (const [data, extra] of [
    [stripes, {}],
    [foliage, { alphaTest: 0.5, behind }],
  ] as const) {
    const magnified: TruthView = {
      ...view([], extra),
      size: 96,
      map: { data, width: 8, height: 8, srgb: true, uv: [4, 0, 0, 0, 4, 0, 0, 0, 1] },
    };
    const truth = groundTruth(magnified);
    assert.deepEqual(truthGap(groundTruth(magnified, 1).rgba, truth), { pixels: 0, max: 0 });
    const judged = truth.edge.length - truth.edge.filter(Boolean).length;
    assert.ok(judged > 3000, `${judged} pixels judged: the square fills the view's middle`);
  }
});

// Review of #443: the footprint is integrated on its tangent, the line a sampler's derivatives
// lay, not on the curve a pixel's edges trace on the plane — at 88° the curve moves 34 pixels of
// the stripes up to 7 levels, where no sampler follows it. Stripes vary along u alone: the tangent's
// mean is a one-dimensional integral, the plane cast here in closed form from `cameraFace`.
test('a slanted footprint is read on its tangent, as a sampler reads it', () => {
  const size = 96,
    tilt = (-88 * Math.PI) / 180,
    a = Math.tan((55 / 2) * (Math.PI / 180));
  const texels = Array.from({ length: 64 }, (_, i) => Array(4).fill(i % 2 ? 255 : 0)).flat();
  const truth = groundTruth({
    ...view([]),
    size,
    square: { place: new Matrix4().makeRotationX(tilt), half: 1 },
    map: { data: texels, width: 8, height: 8, srgb: true, uv: [4, 0, 0, 0, 4, 0, 0, 0, 1] },
  });
  // The ray from (0, 0, 3) through NDC (x, y) meets the tilted plane at (s x a, s y a / cos):
  // the map's u, in texels, is (X + 1) 16. Its linear value runs 0 to 1 between texel centres.
  const hit = (y: number) => 3 / (1 + y * a * Math.tan(tilt));
  const u = (x: number, y: number) => (hit(y) * x * a + 1) * 16;
  const linear = (t: number) => 1 - Math.abs(((((t - 0.5) % 2) + 2) % 2) - 1);
  let judged = 0;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const x = (2 * px + 1) / size - 1,
        y = (2 * py + 1) / size - 1;
      const inside = Math.abs(hit(y) * y * a) <= Math.cos(tilt) && Math.abs(hit(y) * x * a) <= 1;
      if (truth.edge[py * size + px] || !inside) continue;
      judged++;
      const du = ((u(x, y + 1e-4) - u(x, y - 1e-4)) / 2e-4) * (2 / size);
      let mean = 0;
      for (let s = 0; s < 256; s++) mean += linear(u(x, y) + du * ((s + 0.5) / 256 - 0.5)) / 256;
      for (const c of rgb(truth.rgba, px, py, size))
        assert.ok(
          Math.abs(c - linearToSrgb8(mean)) <= 1,
          `${px},${py}: ${c}, not ${linearToSrgb8(mean)}`,
        );
    }
  assert.ok(judged >= 50, `${judged} pixels judged on the square`);
});
