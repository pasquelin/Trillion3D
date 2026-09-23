import test from 'node:test';
import assert from 'node:assert/strict';
import type { MeshPart } from '../plan/contract.ts';
import {
  box,
  cone,
  cylinder,
  extrude,
  lathe,
  merge,
  partBounds,
  plane,
  placeLamps,
  prop,
  roofPrism,
  sphere,
  surface,
  SURFACES,
  transform,
  triangleCount,
  triangulate,
  tube,
} from './index.ts';
import { inwardFaces, propProblems } from './validate.ts';

const S = SURFACES.concrete;

test('each shape has its documented triangle count, sound data and outward faces', () => {
  const shapes: [string, MeshPart, number][] = [
    ['box', box(S, [2, 3, 4]), 12],
    ['plane', plane(S, 5, 5), 2],
    ['roof', roofPrism(S, 4, 6, 2, { overhang: 0.3 }), 6],
    ['cylinder', cylinder(S, 1, 5), 12 * 2 + 10 * 2],
    ['cone', cone(S, 2, 4, { segments: 8 }), 8 + 6],
    ['sphere', sphere(S, 1), 12 * 2 + 12 * 6 * 2],
    [
      'lathe',
      lathe(
        S,
        [
          [1, 0],
          [1.2, 1],
          [0.5, 2],
        ],
        { segments: 10, caps: false },
      ),
      40,
    ],
    [
      'tube',
      tube(
        S,
        [
          [0, 0, 0],
          [0, 5, 0],
        ],
        0.2,
        { caps: true },
      ),
      12 + 4 * 2,
    ],
    [
      'prism',
      extrude(
        S,
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
        ],
        3,
      ),
      8 + 4,
    ],
  ];
  for (const [name, part, triangles] of shapes) {
    assert.equal(triangleCount(part), triangles, name);
    assert.deepEqual(propProblems(prop(name, [part])), [], name);
    if (name !== 'plane') assert.equal(inwardFaces(part), 0, `${name} faces inward`);
  }
});

test('extrude accepts either winding and caps a concave outline', () => {
  const outline: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 2],
    [2, 2],
    [2, 4],
    [0, 4],
  ];
  const a = extrude(S, outline, 3),
    b = extrude(S, [...outline].reverse(), 3);
  assert.equal(triangleCount(a), 6 * 2 + 4 * 2);
  assert.deepEqual(partBounds([a]), partBounds([b]));
  const caps = triangulate(outline);
  let area = 0;
  for (let t = 0; t < caps.length; t += 3) {
    const [p, q, r] = [outline[caps[t]], outline[caps[t + 1]], outline[caps[t + 2]]];
    area += ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
  }
  assert.equal(area, 12);
});

test('a mirroring transform keeps faces outward; a rotation turns +X toward -Z', () => {
  const mirrored = transform(box(S, [1, 1, 1]), { scale: [-1, 1, 1] });
  assert.equal(inwardFaces(mirrored), 0);
  const turned = transform(box(S, [2, 0.1, 0.1]), { yaw: Math.PI / 2, at: [10, 0, 0] }),
    [min, max] = partBounds([turned]);
  assert.ok(Math.abs(min[2] + 1) < 1e-6 && Math.abs(max[2] - 1) < 1e-6 && max[0] < 10.1);
});

test('merge keeps one part per surface and refuses two surfaces under one name', () => {
  const merged = merge([box(S, [1, 1, 1]), box(SURFACES.glass, [1, 1, 1]), plane(S, 1, 1)]);
  assert.deepEqual(
    merged.map((part) => part.surface.name),
    ['concrete', 'glass'],
  );
  assert.equal(triangleCount(merged), 26);
  const impostor = surface('concrete', [1, 0, 0]);
  assert.throws(() => merge([box(S, [1, 1, 1]), box(impostor, [1, 1, 1])]), /two different/);
});

test('a prop lamp follows its instance position, yaw and scale', () => {
  const [lamp] = placeLamps(
    [
      {
        id: 'l',
        type: 'spot',
        offset: [1, 2, 0],
        direction: [1, 0, 0],
        color: [1, 1, 1],
        intensity: 1,
        range: 1,
        night: true,
      },
    ],
    { prop: 'p', position: [100, 0, 50], yaw: Math.PI / 2, scale: 2, name: 'n' },
  );
  assert.equal(lamp.name, 'n/l');
  assert.deepEqual(
    lamp.position.map((v) => Math.round(v * 1e6) / 1e6),
    [100, 4, 48],
  );
  assert.deepEqual(
    lamp.direction?.map((v) => Math.round(v * 1e6) / 1e6),
    [0, 0, -1],
  );
});
