import test from 'node:test';
import assert from 'node:assert/strict';
import { dropSphere } from './drop.ts';

test('a sphere grazing a corner still hits when both incident edge roots lie outside the edges', () => {
  const touch = {
    point: new Float64Array(3),
    normal: new Float64Array(3),
    surface: new Float64Array(3),
    depth: 0,
  };
  assert.equal(dropSphere([-3, 10, -4], 5, [0, 0, 0, 20, -20, 0, 0, -20, 20], 0, touch), 10);
  assert.deepEqual([...touch.point], [0, 0, 0]);
  assert.deepEqual([...touch.normal], [-0.6, 0, -0.8]);
});

test('a vertical triangle keeps its authored face orientation while its contact normal points to the sphere', () => {
  const vertices = [
    [0, 0, 0],
    [0, 6, 0],
    [0, 0, 6],
  ];
  for (const reverse of [false, true]) {
    const touch = {
      point: new Float64Array(3),
      normal: new Float64Array(3),
      surface: new Float64Array(3),
      depth: 0,
    };
    const distance = dropSphere(
      [0.6, 10, 0],
      1,
      (reverse ? vertices.toReversed() : vertices).flat(),
      0,
      touch,
    );
    assert.ok(Math.abs(distance - 3.2) < 1e-12);
    assert.equal(touch.surface[0], reverse ? -1 : 1);
    assert.ok(touch.surface[1] === 0 && touch.surface[2] === 0);
    assert.ok(Math.abs(touch.normal[0] - 0.6) < 1e-12);
    assert.ok(Math.abs(touch.normal[1] - 0.8) < 1e-12);
  }
});

test('a nearly vertical edge at the finite sweep threshold still supports an interior contact', () => {
  // This finite edge is one metre tall and roughly one micrometre wide. The sphere
  // touches its interior after descending one metre; neither endpoint is in reach.
  const triangle = [0, 0, 0, 5.477225575054399e-9, 1, 9.999849998879983e-7, 1, 0, 0];
  const centre = [2.1908902300223075e-9, 1.5000000000001, 3.999939999552993e-7];
  const touch = {
    point: new Float64Array(3),
    normal: new Float64Array(3),
    surface: new Float64Array(3),
    depth: 0,
  };
  assert.ok(Math.abs(dropSphere(centre, 1e-7, triangle, 0, touch) - 1) < 1e-10);
  assert.ok(touch.point[1] > 0.49 && touch.point[1] < 0.51);
});

test('a finite edge steeper than one micrometre per metre retains its interior contact', () => {
  const triangle = [0, 0, 0, 2.7386127875271995e-9, 1, 4.999924999439991e-7, 1, 0, 0];
  const centre = [1.31453413801309e-9, 1.5000000000000049, 2.3999639997312586e-7];
  const touch = {
    point: new Float64Array(3),
    normal: new Float64Array(3),
    surface: new Float64Array(3),
    depth: 0,
  };
  assert.ok(Math.abs(dropSphere(centre, 1e-8, triangle, 0, touch) - 1) < 1e-10);
  assert.ok(touch.point[1] > 0.49 && touch.point[1] < 0.51);
});

test('an exactly vertical edge with a decimal length is contacted at its top endpoint', () => {
  const touch = {
    point: new Float64Array(3),
    normal: new Float64Array(3),
    surface: new Float64Array(3),
    depth: 0,
  };
  const distance = dropSphere([0, 10, 0.05], 0.1, [0, 0, 0, 0, 0.7, 0, 1, 0, 0], 0, touch);
  assert.ok(Math.abs(distance - 9.213397459621556) < 1e-12);
  assert.deepEqual([...touch.point], [0, 0.7, 0]);
  assert.ok(Math.abs(touch.normal[1] - Math.sqrt(3) / 2) < 1e-12);
});

test('grazing a translated corner preserves its position and contact normal', () => {
  const touch = {
    point: new Float64Array(3),
    normal: new Float64Array(3),
    surface: new Float64Array(3),
    depth: 0,
  };
  const triangle = [7, 2, 11, 27, -18, 11, 7, -18, 31];
  assert.equal(dropSphere([4, 12, 7], 5, triangle, 0, touch), 10);
  assert.deepEqual([...touch.point], [7, 2, 11]);
  assert.deepEqual([...touch.normal], [-0.6, 0, -0.8]);
});
