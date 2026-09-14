import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { selectVisiblePages, type ClusterRoot, type PageRec } from './pageSelection.ts';
import { createTransparentCutHold } from './webgpuTransparentCut.ts';

const cache = { get: () => undefined };
const other = { get: () => undefined };
const viewport: [number, number] = [1280, 720];

function camera() {
  const value = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  value.position.set(1, 2, 3);
  value.updateMatrixWorld();
  return value;
}

/** The hold after one image: the cut is in `result`, and its six inputs are recorded. */
function held() {
  const hold = createTransparentCutHold();
  const view = camera();
  hold.keep(view, 0, viewport, 7, cache, 42);
  return { hold, view };
}

test('the cut holds only while all six of its inputs read as they did', () => {
  const { hold, view } = held();
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 42), true, 'rien n’a bougé');
  assert.equal(hold.holds(view, 1, viewport, 7, cache, 42), false, 'seuil d’erreur');
  assert.equal(hold.holds(view, 0, [640, 720], 7, cache, 42), false, 'largeur');
  assert.equal(hold.holds(view, 0, [1280, 360], 7, cache, 42), false, 'hauteur');
  assert.equal(hold.holds(view, 0, viewport, 8, cache, 42), false, 'époque des matrices monde');
  assert.equal(hold.holds(view, 0, viewport, 7, other, 42), false, 'autre cache');
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 43), false, 'résidence');
});

test('the camera moving by a hair retires the cut, and coming back does not restore it', () => {
  const { hold, view } = held();
  view.position.x += 1e-7;
  view.updateMatrixWorld();
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 42), false, 'vue déplacée');
  view.fov = 54;
  view.updateProjectionMatrix();
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 42), false, 'projection changée');
  // The hold is a record of what was computed, not of what the camera happens to read now: a
  // camera put back where it was still needs a sweep, because none was recorded for that pose.
  hold.keep(view, 0, viewport, 7, cache, 42);
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 42), true);
});

test('an invalidated hold answers no until a cut is recorded again', () => {
  const { hold, view } = held();
  hold.invalidate();
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 42), false);
  hold.keep(view, 0, viewport, 7, cache, 42);
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 42), true);
});

test('the held cut is the very cut a sweep writes, in the order of the source', () => {
  const hold = createTransparentCutHold();
  const view = camera();
  const pages = ['verre-1', 'verre-2', 'verre-3', 'verre-4'].map(
    (url, index) =>
      ({
        url,
        triangles: 1,
        seen: 0,
        level: 0,
        min: [index * 0.6 - 1.3, -0.3, -0.3],
        max: [index * 0.6 - 0.7, 0.3, 0.3],
        lodError: 0,
        sphere: [index * 0.6 - 1, 0, 0, 0.6],
        parentError: null,
        parentSphere: null,
        array: new Uint32Array([0, 1, 2]),
      }) as unknown as PageRec,
  );
  const root = { world: new THREE.Matrix4(), pages } as ClusterRoot<PageRec>;
  const sweep = () =>
    selectVisiblePages(
      [root],
      view,
      {
        pixelError: 0,
        viewport,
        frame: 1,
        holdResident: true,
        rootFallback: true,
        wanted: hold.wanted,
        result: hold.result,
      },
      hold.shown,
    );
  const first = sweep();
  assert.deepEqual(
    first.shown.map((page) => page.url),
    ['verre-1', 'verre-2', 'verre-3', 'verre-4'],
    'ordre source',
  );
  // The sweep writes the arrays the hold publishes, so the held answer and a fresh one are the same
  // objects with the same contents: nothing downstream can tell which of the two it was handed.
  assert.equal(first, hold.result);
  assert.equal(first.shown, hold.shown);
  hold.keep(view, 0, viewport, 7, cache, 42);
  const order = first.shown.map((page) => page.url);
  assert.equal(hold.holds(view, 0, viewport, 7, cache, 42), true);
  assert.deepEqual(
    hold.result.shown.map((page) => page.url),
    order,
    'la coupe tenue garde l’ordre',
  );
  // A second sweep, the one a moved input forces, rewrites those arrays to the same order.
  assert.deepEqual(
    sweep().shown.map((page) => page.url),
    order,
    'le parcours refait rend le même ordre',
  );
});
