// The temporal cut fills the lists its own history holds, image after image, and never a list of
// its own: at eighty thousand pages the fresh lists cost more per image than the test they serve.
// Two histories never share one, and a caller that keeps what it is handed copies it first, which
// is what the engine's only production caller does (webgpu/pages/render/cpu.ts:76-84).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { applyTemporalHiz, type HizPage, type TemporalHizState } from './hiz.ts';
import { cameraAt, quad } from '../../../../tests/fixtures/hiz.ts';
import { createEngineCamera, readCameraWorld } from '../camera/world.ts';
import { locatedBy } from '../page/selection/placements.fixture.ts';
import type { VisPage } from '../visibility/buffer.ts';

type Page = VisPage & HizPage & { matrix: G.Matrix4 };
const SIZE: [number, number] = [48, 48];
const cam = readCameraWorld(createEngineCamera(), cameraAt(6));

/** A large quad near the eye, two behind it and two beside: the cut splits them, the history's
 *  pyramid keeps the front half and rejects the rest, so every list of the pass is written. */
function scene() {
  const surface = G.basicSurface({ color: 0x3366ff });
  const made = [
    quad(surface, [-1.7, -1.7, 1], [1.7, 1.7, 1], 'front'),
    quad(surface, [-1.2, -1.2, 0], [1.2, 1.2, 0], 'mid'),
    quad(surface, [-0.6, -0.6, -1], [0.6, 0.6, -1], 'back'),
    quad(surface, [2.1, 2.1, -2], [2.9, 2.9, -2], 'side'),
    quad(surface, [-2.9, -2.9, -3], [-2.1, -2.1, -3], 'far'),
  ];
  const pages = made.map((q) => q.page as Page);
  return {
    pages,
    locations: locatedBy(pages.map((page) => ({ world: page.matrix }))),
    dispose: () => (made.forEach((q) => q.geometry.dispose()), surface.dispose()),
  };
}

/** The names and the ranks of a cut, copied: what a caller that keeps a result has to hold. */
function keep(cut: { shown: Page[]; shownPacked: number[] }) {
  return { urls: cut.shown.map((page) => page.url), ranks: cut.shownPacked.slice() };
}

test('the cut rewrites the lists its history holds, and culls what the pyramid rejects', () => {
  const { pages, locations, dispose } = scene();
  const history: TemporalHizState = {};
  const first = applyTemporalHiz(pages, locations, cam, SIZE, history);
  assert.ok(first.hizRejected > 0, 'the near half occludes the rest of the very first image');
  const held = applyTemporalHiz(pages, locations, cam, SIZE, history),
    ranks = keep(held);
  // The third image walks the same history: the same lists, rewritten with the same cut.
  const again = applyTemporalHiz(pages, locations, cam, SIZE, history);
  assert.equal(again.shown, first.shown, 'the shown list is the one the history holds');
  assert.equal(again.shownPacked, first.shownPacked, 'and its ranks beside it');
  assert.equal(again.occluders, first.occluders, 'and the occluders it cut out');
  assert.deepEqual(keep(again), ranks, 'the same cut as the image before');
  assert.equal(again.shown.length, again.shownPacked.length, 'every shown page carries its rank');
  dispose();
});

test('a cut of another width writes the same lists, and nothing of the wider one survives', () => {
  const { pages, locations, dispose } = scene(),
    history: TemporalHizState = {};
  const wide = applyTemporalHiz(pages, locations, cam, SIZE, history),
    narrow = pages.slice(0, 2);
  const cut = applyTemporalHiz(
    narrow,
    locatedBy(narrow.map((page) => ({ world: page.matrix }))),
    cam,
    SIZE,
    history,
  );
  assert.equal(cut.shown, wide.shown, 'the narrow cut wrote the list the history holds');
  assert.equal(cut.shownPacked, wide.shownPacked, 'and its ranks');
  assert.ok(cut.shown.length <= narrow.length, 'the narrow cut carries only its own pages');
  assert.equal(cut.shown.length, cut.shownPacked.length);
  const again = applyTemporalHiz(pages, locations, cam, SIZE, history);
  assert.equal(again.shown, wide.shown, 'the wide cut writes the same list back');
  assert.equal(again.shown.length, again.shownPacked.length, 'with a rank for every page');
  dispose();
});

test("two histories write two sets of lists: a view never reads another view's", () => {
  const { pages, locations, dispose } = scene();
  const one: TemporalHizState = {},
    other: TemporalHizState = {};
  const first = applyTemporalHiz(pages, locations, cam, SIZE, one),
    held = keep(first);
  const beside = applyTemporalHiz(pages, locations, cam, SIZE, other);
  assert.notEqual(beside.shown, first.shown, 'the second view rewrites nothing of the first');
  assert.notEqual(beside.shownPacked, first.shownPacked);
  assert.notEqual(beside.occluders, first.occluders);
  assert.deepEqual(keep(first), held, 'and the first view still holds the cut it made');
  dispose();
});
