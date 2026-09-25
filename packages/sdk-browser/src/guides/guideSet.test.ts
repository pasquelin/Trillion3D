// The guide set: what `world.guides` holds and packs, apart from any GPU — the ceiling, the
// handles' lifecycle, the packing a pass uploads, and a helper read as guides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../../../sdk-core/src/index.ts';
import { helper } from '../world/helper/index.ts';
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import { GUIDE_VERTEX_CEILING, createGuideSet } from './guideSet.ts';
import { GUIDE_INSTANCE_FLOATS } from './guidePack.ts';

test('a guide above the vertex ceiling is refused by name, and nothing of it is held', () => {
  const guides = createGuideSet();
  guides.lines({ positions: new Float32Array(GUIDE_VERTEX_CEILING * 3 - 6) });
  const revision = guides.revision;
  assert.throws(
    () => guides.points({ positions: [0, 0, 0, 1, 1, 1, 2, 2, 2] }),
    (error: unknown) =>
      error instanceof EngineError &&
      error.code === 'GUIDE_CEILING' &&
      error.details.ceiling === GUIDE_VERTEX_CEILING,
  );
  assert.equal(guides.vertexCount, GUIDE_VERTEX_CEILING - 2);
  assert.equal(guides.revision, revision, 'a refusal changes nothing');
  guides.points({ positions: [0, 0, 0, 1, 1, 1] });
  assert.equal(guides.vertexCount, GUIDE_VERTEX_CEILING, 'exactly at the ceiling is admitted');
});

test('a handle hides, moves and leaves; every change asks for a frame', () => {
  let asked = 0;
  const guides = createGuideSet(() => asked++);
  assert.equal(guides.visibleInstances(), 0, 'an empty set draws nothing');
  const line = guides.lines({ positions: [0, 0, 0, 1, 0, 0], color: 0xff0000, width: 3 });
  assert.equal(asked, 1);
  assert.equal(guides.vertexCount, 2);
  assert.equal(guides.visibleInstances(), 1);
  line.setVisible(false);
  assert.equal(line.visible, false);
  assert.equal(guides.visibleInstances(), 0, 'hidden: no instance');
  assert.equal(guides.vertexCount, 2, 'a hidden guide still counts against the ceiling');
  line.setVisible(true).setTransform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
  const { data, anchor } = guides.pack();
  assert.deepEqual([...anchor], [5, 6, 7], 'anchored at the first guide');
  assert.deepEqual([...data.subarray(0, 6)], [0, 0, 0, 1, 0, 0], 'relative to the anchor');
  assert.equal(new Uint32Array(data.buffer)[6], 0xff0000ff, 'bytes r, g, b, a in memory');
  assert.equal(data[7], 3);
  const before = asked;
  line.remove();
  line.remove();
  line.setVisible(false);
  assert.equal(asked, before + 1, 'a removed handle changes nothing more');
  assert.equal(guides.vertexCount, 0, 'its vertices are given back');
});

test('packing is rebuilt only when the set changed', () => {
  const guides = createGuideSet();
  guides.points({ positions: [1, 2, 3], size: 6 });
  const first = guides.pack();
  assert.equal(guides.pack(), first);
  assert.deepEqual([...first.data.subarray(0, 6)], [1, 2, 3, 1, 2, 3], 'a point: both ends alike');
  assert.equal(first.data[7], 6, 'its size is its width');
  guides.clear();
  assert.notEqual(guides.pack(), first);
  assert.equal(guides.pack().count, 0);
});

test('a helper is read as guides: its segments in its colour, placed where it stands', () => {
  const guides = createGuideSet();
  const box = helper.box(new Box3(new Vector3(0, 0, 0), new Vector3(1, 2, 3)), 0x00ff00);
  box.position.set(10, 0, 0);
  guides.add(box, { width: 2 });
  assert.equal(guides.vertexCount, 24, 'twelve edges');
  const { data, count, anchor } = guides.pack();
  assert.equal(count, 12);
  assert.deepEqual([...anchor], [10, 0, 0]);
  const xs = Array.from({ length: count }, (_, i) => data[i * GUIDE_INSTANCE_FLOATS]);
  assert.ok(
    xs.every((x) => x === 0 || x === 1),
    'the box in its own frame',
  );
  assert.equal(new Uint32Array(data.buffer)[6], 0xff00ff00);
  const grid = helper.grid(2, 2);
  assert.equal(guides.add(grid).visible, true);
  assert.equal(guides.vertexCount, 24 + 12, 'three lines each way, two ends each');
});

test('re-placing a guide at the pose it holds moves nothing, so a held frame stays', () => {
  let asked = 0;
  const guides = createGuideSet(() => asked++);
  const pose = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
  const line = guides.lines({ positions: [0, 0, 0, 1, 0, 0] }).setTransform(pose);
  const revision = guides.revision,
    packed = guides.pack();
  line.setTransform(pose).setTransform({ elements: Float32Array.from(pose) });
  assert.equal(guides.revision, revision, 'the same matrix, as numbers or as a matrix');
  assert.equal(guides.pack(), packed, 'nothing packed again');
  line.setTransform([...pose.slice(0, 12), 5, 6, 8, 1]);
  assert.equal(guides.revision, revision + 1, 'a moved guide still moves the revision');
  assert.equal(asked, 3);
});
