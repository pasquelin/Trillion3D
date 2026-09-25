import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { createProjectionHold } from './projectionHold.fixture.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';

function camera() {
  const view = G.perspectiveCamera(55, 16 / 9, 0.1, 1000);
  view.position.set(0, 1, 5);
  view.updateMatrixWorld();
  return view;
}
const mask = (...values: number[]) => Uint8Array.from(values);
const pending = (hold: ReturnType<typeof createProjectionHold>, count: number) => [
  ...hold.pending.subarray(0, count),
];

test('the first image projects every slot it is asked for, and no other', () => {
  const hold = createProjectionHold(4);
  const view = camera();
  const pages = Int32Array.from([10, 11, 12, 13]);
  hold.reframe(cameraMoteur(view), 1280, 720, 1);
  assert.equal(hold.select(4, mask(1, 0, 1, 0), pages), 2);
  assert.deepEqual(pending(hold, 4), [1, 0, 1, 0]);
  hold.keep(4, pages);
  // Asked for again, unchanged: nothing to project.
  assert.equal(hold.select(4, mask(1, 0, 1, 0), pages), 0);
  assert.deepEqual(pending(hold, 4), [0, 0, 0, 0]);
  // The other half was never projected, so it is what the next image owes.
  assert.equal(hold.select(4, mask(0, 1, 0, 1), pages), 2);
  assert.deepEqual(pending(hold, 4), [0, 1, 0, 1]);
});

test('a slot that changes page owes a rectangle, its neighbours do not', () => {
  const hold = createProjectionHold(4);
  const view = camera();
  const pages = Int32Array.from([10, 11, 12, 13]);
  hold.reframe(cameraMoteur(view), 1280, 720, 1);
  hold.select(4, undefined, pages);
  hold.keep(4, pages);
  const moved = Int32Array.from([10, 99, 12, 13]);
  assert.equal(hold.select(4, undefined, moved), 1);
  assert.deepEqual(pending(hold, 4), [0, 1, 0, 0]);
  hold.keep(4, moved);
  assert.equal(hold.select(4, undefined, moved), 0);
});

test('the view, the viewport or the world epoch moving retires every rectangle at once', () => {
  const pages = Int32Array.from([10, 11, 12, 13]);
  const settled = () => {
    const hold = createProjectionHold(4),
      view = camera();
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    hold.select(4, undefined, pages);
    hold.keep(4, pages);
    return { hold, view };
  };
  const all = [1, 1, 1, 1];
  {
    // Under a host rig, the camera has no new local pose: it is an ancestor that moved, and the
    // host is not required to walk anything up. The cache must still start over, otherwise the
    // Hi-Z test would receive the previous view's rectangles.
    const { hold, view } = settled();
    const rig = new G.Group();
    rig.add(view);
    rig.position.x = 3;
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    assert.equal(hold.select(4, undefined, pages), 4, 'host rig moved');
    assert.deepEqual(pending(hold, 4), all);
    hold.keep(4, pages);
    // And a still rig does not retire them: the cache holds.
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    assert.equal(hold.select(4, undefined, pages), 0, 'still rig');
  }
  {
    const { hold, view } = settled();
    view.position.x += 1e-6;
    view.updateMatrixWorld();
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    assert.equal(hold.select(4, undefined, pages), 4, 'camera moved');
    assert.deepEqual(pending(hold, 4), all);
  }
  {
    const { hold, view } = settled();
    view.fov = 54;
    view.updateProjectionMatrix();
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    hold.select(4, undefined, pages);
    assert.deepEqual(pending(hold, 4), all, 'projection changed');
  }
  {
    const { hold, view } = settled();
    hold.reframe(cameraMoteur(view), 640, 720, 1);
    hold.select(4, undefined, pages);
    assert.deepEqual(pending(hold, 4), all, 'viewport');
  }
  {
    const { hold, view } = settled();
    hold.reframe(cameraMoteur(view), 1280, 720, 2);
    hold.select(4, undefined, pages);
    assert.deepEqual(pending(hold, 4), all, 'world-matrix epoch');
  }
  {
    const { hold, view } = settled();
    hold.invalidate();
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    hold.select(4, undefined, pages);
    assert.deepEqual(pending(hold, 4), all, 'table retired');
  }
  {
    // A view that did not move leaves every rectangle standing, however often it is re-read.
    const { hold, view } = settled();
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    hold.reframe(cameraMoteur(view), 1280, 720, 1);
    assert.equal(hold.select(4, undefined, pages), 0);
  }
});
