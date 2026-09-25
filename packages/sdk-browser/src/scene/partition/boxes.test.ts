import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createCellBoxes } from './boxes.ts';

/** A cell at the origin of the root, and one 5 km off under a core node. */
function world() {
  const cell = { sha256: '', bytes: 1, meshes: [[0, 1] as const] };
  const cells = [
    { ...cell, url: 'near.json', parents: [[null, [0, 0, 0, 1, 1, 1]] as const] },
    { ...cell, url: 'far.json', parents: [[0, [5000, 0, 0, 5001, 1, 1]] as const] },
  ];
  const root = new Group();
  const core = new Object3D();
  root.add(core);
  return { cells, root, core };
}

test("a cell's box follows its core parent, turned and moved, and the root's frame", () => {
  const { cells, root, core } = world();
  const boxes = createCellBoxes(cells, root, [core]);
  assert.deepEqual([...boxes()[1].bounds], [5000, 0, 0, 5001, 1, 1]);
  core.position.set(-5000, 0, 0);
  assert.deepEqual([...boxes()[1].bounds], [0, 0, 0, 1, 1, 1]);
  root.position.set(100, 0, 0); // the root carries both: nothing moves in its frame
  assert.deepEqual([...boxes()[1].bounds], [0, 0, 0, 1, 1, 1]);
  assert.deepEqual([...boxes()[0].bounds], [0, 0, 0, 1, 1, 1]);
  core.scale.set(2, 3, 4); // how far the parent stretches its cells' frame, least and most
  boxes();
  const [least, most] = boxes.stretch.get(0)!;
  assert.ok(Math.abs(least - 2) < 1e-9 && Math.abs(most - 4) < 1e-9, `${least}, ${most}`);
});
