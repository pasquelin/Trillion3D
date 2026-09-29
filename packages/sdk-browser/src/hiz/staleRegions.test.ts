// CPU-14: a moved root stales the temporal pyramid where it stood and stands, not the whole
// pyramid. Against develop's whole invalidation, frame after frame on random scenes: the image
// the kept pages shade is the one every page shades, on both sides, to the channel; and the edge
// boxes — NaN, ±Inf, ±0, none, one round the eye — keep that, a non-finite one dropping it all.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { compareImages } from '../../../sdk-core/src/index.ts';
import { rasterVisibilityIds, shadeVisibility, type VisPage } from '../visibility/buffer.ts';
import { applyTemporalHiz, type HizPage, type TemporalHizState } from './hiz.ts';
import { staleTemporalBox } from './staleRegions.ts';
import { cameraAt, quad } from '../../../../tests/fixtures/hiz.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { seeded } from '../host/world/randomTree.fixture.ts';

type Page = VisPage & HizPage & { matrix: G.Matrix4 };
const SIZE: [number, number] = [48, 48];
const cam = cameraMoteur(cameraAt(6));

/** A random wall of quads, one large near the eye, at depths from −3 to 1. */
function scene(draw: () => number) {
  const surface = G.basicSurface({ color: 0x3366ff });
  const quads = Array.from({ length: 14 }, (_, i) => {
    const half = i === 0 ? 1.6 : 0.2 + draw() * 0.6,
      z = i === 0 ? 1 : -3 + draw() * 3.5;
    const made = quad(surface, [-half, -half, z], [half, half, z], `q${i}`);
    made.page.matrix = new G.Matrix4().makeTranslation(draw() * 4 - 2, draw() * 4 - 2, 0);
    return made;
  });
  const pages = quads.map((q) => q.page as Page);
  return { pages, dispose: () => (quads.forEach((q) => q.geometry.dispose()), surface.dispose()) };
}

/** The page's world box: its local box moved by its translation. */
function worldBox(page: Page) {
  const t = page.matrix.elements.slice(12, 15);
  return [page.min.map((v, k) => v + t[k]), page.max.map((v, k) => v + t[k])];
}

const shade = (pages: Page[]) =>
  shadeVisibility(rasterVisibilityIds(pages, cam, SIZE), pages, cam, SIZE);

function sameImage(pages: Page[], shown: Page[], label: string) {
  assert.equal(compareImages(shade(pages), shade(shown)).maxChannelError, 0, label);
}

test('a moved root stales its region alone, and the image is every page shaded', () => {
  const draw = seeded(1404);
  let heldFrames = 0;
  for (let round = 0; round < 12; round++) {
    const { pages, dispose } = scene(draw);
    const develop: TemporalHizState = {},
      branch: TemporalHizState = {};
    for (let frame = 0; frame < 8; frame++) {
      if (branch.pyramid) heldFrames++;
      const d = applyTemporalHiz(pages, cam, SIZE, develop).shown as Page[];
      const b = applyTemporalHiz(pages, cam, SIZE, branch).shown as Page[];
      sameImage(pages, d, `develop, round ${round} frame ${frame}`);
      sameImage(pages, b, `branch, round ${round} frame ${frame}`);
      // One page moves: develop drops the pyramid, the branch stales where it was and is.
      const mover = pages[1 + Math.floor(draw() * (pages.length - 1))];
      const [oldMin, oldMax] = worldBox(mover);
      mover.matrix.makeTranslation(draw() * 4 - 2, draw() * 4 - 2, 0);
      const [newMin, newMax] = worldBox(mover);
      develop.pyramid = develop.camera = undefined;
      staleTemporalBox(branch, oldMin, oldMax);
      staleTemporalBox(branch, newMin, newMax);
    }
    dispose();
  }
  assert.ok(heldFrames > 50, 'the branch cut on a kept pyramid');
});

test('edge boxes: none, ±0, ±Inf, NaN, one round the eye', () => {
  const { pages, dispose } = scene(seeded(7));
  const edges: [number[], number[]][] = [
    [
      [-0, -0, -0],
      [0, 0, 0],
    ],
    [
      [-100, -100, -100],
      [100, 100, 100],
    ],
    [
      [NaN, 0, 0],
      [1, 1, 1],
    ],
    [
      [-Infinity, 0, 0],
      [1, 1, 1],
    ],
    [
      [0, 0, 0],
      [Infinity, 1, 1],
    ],
  ];
  for (const [k, [min, max]] of edges.entries()) {
    const history: TemporalHizState = {};
    applyTemporalHiz(pages, cam, SIZE, history);
    staleTemporalBox(history, min, max);
    assert.equal(!!history.pyramid, k < 2, 'a non-finite box drops the whole pyramid');
    if (history.pyramid) assert.equal(history.stale?.length, 1);
    sameImage(pages, applyTemporalHiz(pages, cam, SIZE, history).shown as Page[], `edge ${k}`);
    assert.equal(history.stale?.length ?? 0, 0, 'the next pyramid starts clean');
  }
  const empty: TemporalHizState = {};
  staleTemporalBox(empty, [0, 0, 0], [1, 1, 1]);
  assert.equal(empty.stale, undefined, 'no pyramid, nothing to stale');
  dispose();
});
