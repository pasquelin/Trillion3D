import test from 'node:test';
import assert from 'node:assert/strict';
import { Path, Shape, SplineCurve } from './curves.ts';
import { Vector3 } from './vector3.ts';
import { near as within } from '../../math/near.fixture.ts';

const near = (actual: number[], expected: number[], label: string, eps = 1e-12) =>
  within(actual, expected, label, eps);
const xyz = (v: { x: number; y: number; z?: number }) => [v.x, v.y, v.z ?? 0];

test('a path runs its corners by length, clamped to its ends', () => {
  const path = new Path([[0, 0], [3, 0], { x: 3, y: 4, z: 0 }]);
  assert.deepEqual(path.points.map(xyz), [
    [0, 0, 0],
    [3, 0, 0],
    [3, 4, 0],
  ]);
  near(xyz(path.getPoint(3 / 7)), [3, 0, 0], 'the corner');
  near(xyz(path.getPoint(0.5)), [3, 0.5, 0], 'half the length');
  near(xyz(path.getPoint(0.2)), [1.4, 0, 0], 'on the first piece');
  near(xyz(path.getPoint(-1)), [0, 0, 0], 'before the start');
  near(xyz(path.getPoint(2)), [3, 4, 0], 'past the end');
  assert.equal(path.getLength(7), 7, 'a length measured through the corners');
  near(xyz(path.getTangent(0.2)), [1, 0, 0], 'the first piece’s direction');
  near(xyz(path.getTangent(1)), [0, 1, 0], 'the last piece’s, at the very end');
  const points = path.getPoints();
  points[0].x = 9;
  assert.equal(path.points[0].x, 0, 'getPoints returns copies');
  assert.equal(new Path([[1, 2, 3]]).points[0].z, 3, 'three numbers keep their height');
});

test('a path of one point, of none, or with a repeated corner', () => {
  near(xyz(new Path([[1, 2]]).getPoint(0.5)), [1, 2, 0], 'one point');
  near(xyz(new Path().getPoint(0.5)), [0, 0, 0], 'no point');
  assert.deepEqual(new Path().points, []);
  near(
    xyz(
      new Path([
        [0, 0],
        [4, 0],
      ]).getPoint(0.25),
    ),
    [1, 0, 0],
    'two points',
  );
  const repeated = new Path([
    [0, 0],
    [0, 0],
    [2, 0],
  ]);
  near(xyz(repeated.getPoint(0)), [0, 0, 0], 'a zero-length piece divides by nothing');
  near(xyz(repeated.getPoint(0.5)), [1, 0, 0], 'then the next piece');
});

test('a spline passes through its points and bends as Catmull–Rom', () => {
  const pts = [
    new Vector3(0, 0, 0),
    new Vector3(1, 1, 2),
    new Vector3(2, 0, 4),
    new Vector3(3, 1, 0),
  ];
  const open = new SplineCurve(pts);
  for (let k = 0; k < 4; k++) near(xyz(open.getPoint(k / 3)), xyz(pts[k]), `point ${k}`, 1e-12);
  // At the middle of a span, (−p0 + 9 p1 + 9 p2 − p3) / 16; an open end repeats its point.
  const mid = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) =>
    [0, 1, 2].map((k) => (-xyz(a)[k] + 9 * xyz(b)[k] + 9 * xyz(c)[k] - xyz(d)[k]) / 16);
  near(xyz(open.getPoint(0.5)), mid(pts[0], pts[1], pts[2], pts[3]), 'inner span');
  near(xyz(open.getPoint(1 / 6)), mid(pts[0], pts[0], pts[1], pts[2]), 'first span');
  near(xyz(open.getPoint(5 / 6)), mid(pts[1], pts[2], pts[3], pts[3]), 'last span');
  near(xyz(open.getPoint(-1)), [0, 0, 0], 'clamped before');
  near(xyz(open.getPoint(3)), [3, 1, 0], 'clamped after');
  const closed = new SplineCurve(pts, true);
  near(xyz(closed.getPoint(1)), [0, 0, 0], 'a closed curve comes back');
  near(xyz(closed.getPoint(1 / 8)), mid(pts[3], pts[0], pts[1], pts[2]), 'wraps before');
  near(xyz(closed.getPoint(7 / 8)), mid(pts[2], pts[3], pts[0], pts[1]), 'wraps after');
  near(xyz(new SplineCurve([pts[1]]).getPoint(0.7)), [1, 1, 2], 'one point');
  const line = new SplineCurve([new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0)]);
  assert.deepEqual(
    line.getPoints(4).map(xyz),
    [0, 7 / 16, 1, 25 / 16, 2].map((x) => [x, 0, 0]),
  );
  assert.equal(line.getPoints().length, 6, 'five divisions by default');
  assert.ok(Math.abs(line.getLength() - 2) < 1e-9, 'its length: the points run along x');
});

test('a shape samples its lines, curves and arcs, and drops a closing repeat', () => {
  const square = new Shape([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ]);
  assert.equal(square.isShape, true);
  assert.deepEqual(square.getPoints().map(xyz), [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
  ]);
  const open = new Shape([
    [0, 0],
    [1, 0],
  ]);
  assert.equal(open.getPoints().length, 2, 'distinct ends are both kept');
  const curved = new Shape()
    .moveTo(0, 0)
    .quadraticCurveTo(1.5, 2, 2, 1)
    .bezierCurveTo(3, 1, 5, 1, 6, 0);
  near(
    curved.getPoints(2).map(xyz).flat(),
    [0, 0, 0, 1.25, 1.25, 0, 2, 1, 0, 4, 7 / 8, 0, 6, 0, 0],
    'curves',
  );
  const one = new Shape().moveTo(1, 1);
  assert.equal(one.getPoints().length, 1, 'a lone point is not its own closing repeat');
  const close = new Shape([
    [0, 0],
    [1, 0],
    [1e-12, 0],
  ]);
  assert.equal(close.getPoints().length, 3, 'an end 1e-12 away is another point');
  assert.deepEqual(new Shape().holes, []);
  assert.equal(new Shape().getPoints().length, 0);
});

test('an arc sweeps the short or the long way as its direction says, and moves the pen', () => {
  const at = (a: number) => [Math.cos(a), Math.sin(a), 0];
  const q = Math.PI / 2;
  const arc = (start: number, end: number, sweep: number, clockwise?: boolean) => {
    const points = new Shape().absarc(0, 0, 1, start, end, clockwise).getPoints(4);
    // Five samples, a closing repeat dropped.
    assert.equal(points.length, sweep ? 5 : 4);
    points.forEach((p, i) => near(xyz(p), at(start + (sweep * i) / 4), `${start}→${end}`));
  };
  arc(0, q, q);
  arc(0, q, -3 * q, true);
  arc(q, 0, 3 * q, false);
  arc(q, 0, -q, true);
  arc(0, 0, 0, true);
  arc(0, 0, 0, false);
  // After an arc the pen is at its end: the next curve starts there.
  const pen = new Shape().absarc(1, 0, 2, 0, Math.PI / 3).quadraticCurveTo(0, 0, 0, 0);
  const points = pen.getPoints(2).map(xyz);
  near(points[3], [0.5, Math.sqrt(3) / 4, 0], 'a quarter of the arc end', 1e-12);
});
