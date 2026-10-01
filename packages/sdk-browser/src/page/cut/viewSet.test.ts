import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createEngineCamera, readCameraWorld } from '../../camera/world.ts';
import { selectVisiblePages } from './cut.ts';
import { ruleDag, coverFault } from './cutRule.fixture.ts';
import type { CutView } from './viewSet.ts';

function eye(x: number, distance: number, pixels = 1000): CutView {
  const camera = G.perspectiveCamera(55, 1, 0.1, 1000);
  camera.position.set(x, 0, distance);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld();
  return { camera: readCameraWorld(createEngineCamera(), camera), viewport: [pixels, pixels] };
}
const ids = (pages: readonly { url: string }[]) => pages.map((p) => p.url).sort();

test('one stereo traversal keeps pages visible only to either eye and visits no node twice', () => {
  const dag = ruleDag(64),
    views = [eye(3, 3), eye(61, 3)];
  const left = selectVisiblePages([dag], views[0].camera, {
    pixelError: 0,
    viewport: views[0].viewport,
  });
  const right = selectVisiblePages([dag], views[1].camera, {
    pixelError: 0,
    viewport: views[1].viewport,
  });
  assert.ok(left.shown.length && right.shown.length);
  assert.ok(left.shown.every((p) => !right.shown.includes(p)));
  const stereo = selectVisiblePages([dag], views[0].camera, { pixelError: 0, views });
  assert.deepEqual(ids(stereo.shown), ids([...left.shown, ...right.shown]));
  assert.equal(new Set(stereo.shown).size, stereo.shown.length);
  assert.ok(stereo.nodesTested <= dag.culling.nodes.length / dag.culling.stride);
});

test('stereo uses the stricter projected error and covers every surface exactly once', () => {
  const dag = ruleDag(64),
    low = eye(32, 100, 100),
    high = eye(32, 100, 2000);
  const a = selectVisiblePages([dag], low.camera, { pixelError: 1, viewport: low.viewport });
  const b = selectVisiblePages([dag], high.camera, { pixelError: 1, viewport: high.viewport });
  assert.notDeepEqual(ids(a.shown), ids(b.shown));
  for (const views of [
    [low, high],
    [high, low],
  ]) {
    const stereo = selectVisiblePages([dag], views[0].camera, { pixelError: 1, views });
    assert.deepEqual(ids(stereo.shown), ids(b.shown));
    assert.equal(
      coverFault(
        dag,
        stereo.shown.map((p) => dag.pages.indexOf(p)),
      ),
      -1,
    );
  }
  const mono = selectVisiblePages([dag], low.camera, { pixelError: 1, viewport: low.viewport });
  assert.deepEqual(
    ids(mono.shown),
    ids(a.shown),
    'stereo scratch does not leak into a later mono frame',
  );
});

test('stereo keeps both visible cell edges in a translated open-world layout', () => {
  const roots = Array.from({ length: 16 }, (_, cell) => {
    const root = ruleDag(8);
    const elements = [...root.world.elements];
    elements[12] = cell * 1000;
    for (const page of root.pages) page.url = `${cell}/${page.url}`;
    return { ...root, world: { elements } };
  });
  const views = [eye(4, 3), eye(15004, 3)];
  const mono = views.map((view) =>
    selectVisiblePages(roots, view.camera, { pixelError: 0, viewport: view.viewport }),
  );
  assert.ok(mono.every((cut) => cut.shown.length > 0));
  const stereo = selectVisiblePages(roots, views[0].camera, { pixelError: 0, views });
  assert.deepEqual(ids(stereo.shown), ids(mono.flatMap((cut) => cut.shown)));
  assert.equal(stereo.uncoveredTriangles, 0);
  assert.ok(stereo.shown.every((page) => page.url.startsWith('0/') || page.url.startsWith('15/')));
});
