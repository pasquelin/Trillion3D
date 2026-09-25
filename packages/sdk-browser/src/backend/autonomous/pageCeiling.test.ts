// #527: a transparent page placed by rows hangs one display mesh per row (`attachedPages`), which
// the default page ceiling, read off the manifest's pages, does not count. A scene of more
// see-through copies than that default — a snowfall of sprites, a stack of air shells — was
// refused whole at `prepare` and drew nothing on WebGL2. The root cover is always drawn, as the
// pool raises its budget to it; only a ceiling the host set refuses it, by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createPlacementRows, growPlacementRows } from '../../placement/rows.ts';
import { triangleBackend } from './triangle.fixture.ts';

/** `count` live rows, side by side. */
function rowsOf(count: number) {
  const rows = createPlacementRows(count);
  for (let row = 0; row < count; row++) {
    rows.matrices.set(new G.Matrix4().makeTranslation(row * 0.1, 0, 0).toArray(), row * 16);
    rows.live[row] = 1;
  }
  return rows;
}

const seeThrough = () => G.basicSurface({ side: G.DOUBLE_SIDE, transparent: true, opacity: 0.5 });

test('without a host ceiling, every transparent row of the root cover is drawn, grown rows and instances too', async () => {
  const rows = rowsOf(3);
  const { backend, camera, geometry, material } = triangleBackend(
    { placements: rows },
    seeThrough(),
    { residentPagesDefault: 2 },
  );
  try {
    await backend.prepare();
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 3);
    assert.equal(backend.overBudget, false);
    backend.addInstance!('copy', new G.Matrix4().makeTranslation(0, 1, 0).elements.slice());
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 6, 'an instance copies every row');
    assert.equal(backend.overBudget, false);
    const grown = growPlacementRows(rows, 4);
    backend.growPlacements!(rows, grown);
    grown.matrices.set(new G.Matrix4().makeTranslation(0.3, 0, 0).toArray(), 48);
    grown.live[3] = 1;
    backend.updatePlacements!(grown, 3, 3);
    backend.render(camera);
    assert.equal(backend.metrics().submittedTriangles, 7);
    assert.equal(backend.overBudget, false, 'the ceiling follows the cover');
  } finally {
    backend.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('a host ceiling under the root cover is refused by name, at prepare or by an instance', async () => {
  const { backend, geometry, material } = triangleBackend({ placements: rowsOf(3) }, seeThrough(), {
    maxResidentPages: 2,
  });
  const within = triangleBackend({ placements: rowsOf(2) }, seeThrough(), { maxResidentPages: 3 });
  try {
    await assert.rejects(backend.prepare(), /AUTONOMOUS_ROOT_BUDGET/);
    await within.backend.prepare();
    const pose = new G.Matrix4().elements.slice();
    assert.throws(() => within.backend.addInstance!('copy', pose), /AUTONOMOUS_ROOT_BUDGET/);
  } finally {
    for (const opened of [{ backend, geometry, material }, within]) {
      opened.backend.dispose();
      opened.geometry.dispose();
      opened.material.dispose();
    }
  }
});
