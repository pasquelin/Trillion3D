// #443: the ground truth the grazing fixtures are judged against — a footprint integral along the
// minified axis alone —, and the judgement itself: a gap counted in pixels over one level,
// silhouettes aside; the engine within tolerance and no farther from the truth than the witness.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts';
import { cameraFace } from './sharedSceneProof.ts';
import { backgroundRgb } from '../../../packages/sdk-browser/src/visibility/math.ts';
import { groundTruth, truthGap, truthVerdict, type TruthView } from './groundTruth.ts';

const SIZE = 24;
const CLEAR = 0x2a303c,
  BEHIND = 0x6a3d9a;
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
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
    uv: IDENTITY.map((value, i) => (i === 0 || i === 4 ? value * repeat : value)),
  },
  alphaTest: 0,
  clear: CLEAR,
  ...extra,
});
const rgb = (image: Uint8Array, x: number, y: number) =>
  Array.from(image.subarray((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3));
const CENTRE = SIZE >> 1;

test('the square shows its texel, the clear colour lies around it, a silhouette is an edge', () => {
  const red = [255, 0, 0, 255];
  const truth = groundTruth(view([red, red]), 4);
  assert.deepEqual(rgb(truth.rgba, CENTRE, CENTRE), [255, 0, 0]);
  assert.deepEqual(rgb(truth.rgba, 0, 0), backgroundRgb(CLEAR));
  assert.equal(truth.edge[CENTRE * SIZE + CENTRE], 0);
  assert.equal(truth.edge[0], 0);
  const edges = truth.edge.reduce((sum, edge) => sum + edge, 0);
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
    const judged = truth.edge.length - truth.edge.reduce((sum, edge) => sum + edge, 0);
    assert.ok(judged > 3000, `${judged} pixels judged: the square fills the view's middle`);
  }
});
