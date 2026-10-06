// Parent/child rules of the hierarchy and the camera, each stated and checked on its own
// (the replay against a host library lives in the bench, `bench/perf/browser/hierarchy.perf.ts`).
// Rules: a world matrix is the parent's world matrix times the local one; a mirrored or
// zero-scale ancestor stays finite; a reparent moves the world pose with the new parent; `lookAt`
// puts the node's axis on the line of sight and has a defined answer when the eye is on the
// target or the up is collinear; a projection maps the near rectangle's edges to ±1, depth is
// `near / distance`, and every result is finite for finite positive inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransformNode,
  createCameraFrame,
  createTransformTree,
  determinantMatrix4,
  lookAtNode,
  nodeWorldDirection,
  perspectiveProjection,
  reparentTransformNode,
  setNodePosition,
  setNodeQuaternion,
  setNodeScale,
  updateCameraFrame,
  updateNodeMatrixWorld,
} from '../index.ts';

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const assertPoint = (got: ArrayLike<number>, want: number[], label: string) => {
  for (let i = 0; i < want.length; i++)
    assert.ok(near(got[i], want[i]), `${label}[${i}]: ${got[i]} vs ${want[i]}`);
};
/** A column-major 4x4 applied to the point `(x, y, z, 1)`, divided by w. */
function transformPoint(m: ArrayLike<number>, p: number[]) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [0, 1, 2].map((r) => (m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]) / w);
}
const QUARTER_Z = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const; // 90 degrees about z

test('a depth-4 chain with a two-child branch: a point of a leaf goes through scale, turn and shift of every ancestor, innermost first', () => {
  const tree = createTransformTree(8);
  const a = addTransformNode(tree);
  const b = addTransformNode(tree, a);
  const c = addTransformNode(tree, b);
  const d = addTransformNode(tree, c);
  const sibling = addTransformNode(tree, c);
  setNodePosition(tree, a, 1, 0, 0);
  setNodeScale(tree, b, 2, 3, 4);
  setNodeQuaternion(tree, b, ...QUARTER_Z);
  setNodePosition(tree, c, 0, 1, 0);
  setNodePosition(tree, d, 5, 0, 0);
  setNodePosition(tree, sibling, 0, 0, 7);
  updateNodeMatrixWorld(tree, a, true);
  // d: local (1,1,1) -> shift (6,1,1); c shift (6,2,1); b scale (12,6,4) then a quarter turn about z
  // (x,y) -> (-y,x): (-6,12,4); a shift: (-5,12,4).
  assertPoint(transformPoint(tree.worldViews[d], [1, 1, 1]), [-5, 12, 4], 'leaf d');
  // the sibling shares the chain but not d's shift: (1,1,1) -> (1,1,8) -> (1,2,8) -> (2,6,32) -> (-6,2,32) -> (-5,2,32).
  assertPoint(transformPoint(tree.worldViews[sibling], [1, 1, 1]), [-5, 2, 32], 'leaf sibling');
});

test('a negative scale on one axis mirrors the face winding; two negative axes do not; a zero scale keeps every value finite', () => {
  const tree = createTransformTree(4);
  const root = addTransformNode(tree);
  const child = addTransformNode(tree, root);
  setNodeScale(tree, root, -1, 1, 1);
  updateNodeMatrixWorld(tree, root, true);
  assert.ok(determinantMatrix4(tree.worldViews[child]) < 0);
  setNodeScale(tree, child, -1, 1, 1);
  updateNodeMatrixWorld(tree, root, true);
  assert.ok(determinantMatrix4(tree.worldViews[child]) > 0);
  setNodeScale(tree, root, 0, 1, 1);
  setNodePosition(tree, child, 2, 3, 4);
  updateNodeMatrixWorld(tree, root, true);
  assert.equal(determinantMatrix4(tree.worldViews[child]), 0);
  assert.ok([...tree.worldViews[child]].every(Number.isFinite));
  assertPoint(transformPoint(tree.worldViews[child], [1, 1, 1]), [0, 4, 5], 'collapsed axis');
});

test('reparenting: the world pose follows the new parent at the next update, and the old parent no longer moves it', () => {
  const tree = createTransformTree(4);
  const left = addTransformNode(tree);
  const right = addTransformNode(tree);
  const node = addTransformNode(tree, left);
  setNodePosition(tree, left, -10, 0, 0);
  setNodePosition(tree, right, 20, 0, 0);
  setNodePosition(tree, node, 1, 1, 1);
  updateNodeMatrixWorld(tree, left, true);
  assertPoint(tree.worldViews[node].subarray(12, 15), [-9, 1, 1], 'under left');
  reparentTransformNode(tree, node, right);
  setNodePosition(tree, left, 99, 0, 0);
  updateNodeMatrixWorld(tree, right, true);
  assertPoint(tree.worldViews[node].subarray(12, 15), [21, 1, 1], 'under right');
});

test('lookAt: an object presents +z toward the target, a camera looks down -z toward it, under a rotated parent too', () => {
  const tree = createTransformTree(4);
  const parent = addTransformNode(tree);
  setNodeQuaternion(tree, parent, ...QUARTER_Z);
  setNodePosition(tree, parent, 3, -2, 1);
  const object = addTransformNode(tree, parent);
  const camera = addTransformNode(tree, parent);
  const out = new Float64Array(3);
  const up = [0, 1, 0];
  const target = [4, 9, -6];
  for (const [node, viewer] of [
    [object, false],
    [camera, true],
  ] as const) {
    lookAtNode(tree, node, target[0], target[1], target[2], up, viewer);
    const eye = [...tree.worldViews[node].subarray(12, 15)];
    const toTarget = target.map((t, i) => t - eye[i]);
    const length = Math.hypot(...toTarget);
    nodeWorldDirection(out, tree, node, viewer);
    assertPoint(
      out,
      toTarget.map((v) => v / length),
      viewer ? 'camera' : 'object',
    );
  }
});

test('lookAt: with the eye on the target, or the up collinear with the line of sight, the direction is still a finite unit vector', () => {
  const tree = createTransformTree(4);
  const node = addTransformNode(tree);
  const out = new Float64Array(3);
  setNodePosition(tree, node, 1, 2, 3);
  lookAtNode(tree, node, 1, 2, 3, [0, 1, 0], false);
  nodeWorldDirection(out, tree, node, false);
  assert.ok(near(Math.hypot(...out), 1));
  assert.ok([...out].every(Number.isFinite));
  setNodePosition(tree, node, 0, 0, 0);
  lookAtNode(tree, node, 0, 5, 0, [0, 1, 0], false);
  nodeWorldDirection(out, tree, node, false);
  assert.ok(near(Math.hypot(...out), 1));
  assert.ok(out[1] > 0.999, `still aims up: ${out[1]}`);
});

// Projection rules ----------------------------------------------------------------------------

const FIELDS = [1, 30, 60, 90, 120, 170];
const ASPECTS = [0.25, 1, 16 / 9, 4];
const NEARS = [1e-3, 0.1, 1, 50];
const ZOOMS = [0.1, 1, 2.5];
const eachProjection = (
  body: (p: Float64Array, fov: number, aspect: number, n: number, z: number) => void,
) => {
  for (const fov of FIELDS)
    for (const aspect of ASPECTS)
      for (const n of NEARS)
        for (const z of ZOOMS)
          body(perspectiveProjection(new Float64Array(16), fov, aspect, n, z), fov, aspect, n, z);
};

test('projection: the edges of the near rectangle map to +-1 on both axes, whatever the field, aspect, near and zoom', () => {
  eachProjection((p, fov, aspect, n, zoom) => {
    const hy = (n * Math.tan((fov * Math.PI) / 360)) / zoom;
    const hx = aspect * hy;
    const [x, y] = transformPoint(p, [hx, hy, -n]);
    assert.ok(near(x, 1, 1e-9) && near(y, 1, 1e-9), `${fov} ${aspect} ${n} ${zoom}: ${x} ${y}`);
    const [nx, ny] = transformPoint(p, [-hx, -hy, -n]);
    assert.ok(near(nx, -1, 1e-9) && near(ny, -1, 1e-9));
  });
});

test('projection: depth is near / distance, 1 on the near plane, falling toward 0 and never reaching it', () => {
  eachProjection((p, _fov, _aspect, n) => {
    assert.ok(near(transformPoint(p, [0, 0, -n])[2], 1));
    assert.ok(near(transformPoint(p, [0, 0, -4 * n])[2], 0.25));
    const far = transformPoint(p, [0, 0, -1e9 * n])[2];
    assert.ok(far > 0 && far < 1e-8);
  });
});

test('projection: every value is finite for finite positive inputs, and the last column is (0, 0, -1, 0)', () => {
  eachProjection((p) => {
    assert.ok([...p].every(Number.isFinite));
    assert.deepEqual([p[3], p[7], p[11], p[15]], [0, 0, -1, 0]);
  });
});

test('projection: a zero zoom collapses the picture scale to 0 and an infinite zoom opens it to infinity, never a NaN', () => {
  const closed = perspectiveProjection(new Float64Array(16), 60, 1.5, 0.1, 0);
  assert.equal(closed[0], 0);
  assert.equal(closed[5], 0);
  assert.ok(![...closed].some(Number.isNaN));
  const open = perspectiveProjection(new Float64Array(16), 60, 1.5, 0.1, Infinity);
  assert.equal(open[5], Infinity);
  assert.equal(open[14], 0.1);
});

test('camera frame: view-projection takes a point in front of the eye, in a rotated and shifted camera, inside clip bounds', () => {
  const tree = createTransformTree(2);
  const cam = addTransformNode(tree);
  setNodePosition(tree, cam, 5, 0, 0);
  setNodeQuaternion(tree, cam, 0, Math.SQRT1_2, 0, Math.SQRT1_2); // yaw 90: looks down -x
  updateNodeMatrixWorld(tree, cam, true);
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1);
  const frame = updateCameraFrame(createCameraFrame(), projection, tree.worldViews[cam], 1000);
  const [x, y, z] = transformPoint(frame.viewProjection, [-5, 0.2, 0]);
  assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1 && z > 0 && z < 1, `${x} ${y} ${z}`);
});
