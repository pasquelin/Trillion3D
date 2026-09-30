import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drawsImpostor,
  impostorRadius,
  impostorSwitchDepth,
  impostorSwitchOf,
  impostorTexelDepth,
  impostorTriangleDepth,
} from './switch.ts';
import type { ImpostorMesh } from '../contracts/impostor.ts';

const mesh: ImpostorMesh = {
  mesh: 3,
  sourceMesh: 3,
  name: 'tree',
  placements: 1,
  masked: true,
  rootTriangles: 128,
  radius: 2,
  objectRadius: 2,
  status: 'baked',
  coverage: 0.5,
  frames: 8,
  frameSide: 64,
  maps: {
    colourCoverage: { kind: 'coverage', levels: [] },
    normalDepth: { kind: 'data', levels: [] },
    orm: { kind: 'data', levels: [] },
  },
};

test('atlas resolution and covered triangle area independently delay the switch', () => {
  assert.equal(impostorRadius(3), 3);
  assert.equal(impostorRadius(3, 2), 6);
  assert.equal(impostorTexelDepth(2, 8, 4), 2);
  assert.ok(Math.abs(impostorTriangleDepth(1, 4, 1, 2) - Math.sqrt(Math.PI)) < 1e-14);
  const sharpnessLimited = { objectRadius: 2, rootTriangles: 10000, coverage: 0.5, frameSide: 8 };
  assert.equal(impostorSwitchDepth(sharpnessLimited, 4), 2);
  assert.equal(drawsImpostor(sharpnessLimited, 4, 1.999), false);
  assert.equal(drawsImpostor(sharpnessLimited, 4, 2), true);
  assert.equal(drawsImpostor(sharpnessLimited, 4, 2.001), true);
  const triangleLimited = { objectRadius: 1, rootTriangles: 4, coverage: 1, frameSide: 1000 };
  assert.ok(Math.abs(impostorSwitchDepth(triangleLimited, 2) - Math.sqrt(Math.PI)) < 1e-14);
  assert.equal(drawsImpostor(triangleLimited, 2, 1.7), false);
  assert.equal(drawsImpostor(triangleLimited, 2, 1.8), true);
});

test('baked switch inputs carry their values and the supplied placement scale', () => {
  assert.deepEqual(impostorSwitchOf(mesh), {
    objectRadius: 2,
    rootTriangles: 128,
    coverage: 0.5,
    frameSide: 64,
    maxWorldScale: 1,
  });
  assert.deepEqual(impostorSwitchOf(mesh, 3), {
    objectRadius: 2,
    rootTriangles: 128,
    coverage: 0.5,
    frameSide: 64,
    maxWorldScale: 3,
  });
  assert.equal(impostorSwitchOf({ ...mesh, status: 'refused' }), undefined);
  assert.equal(impostorSwitchOf({ ...mesh, maps: undefined }), undefined);
  for (const field of ['objectRadius', 'rootTriangles', 'coverage'])
    for (const bad of [0, -1, NaN, Infinity, -Infinity, undefined])
      assert.equal(impostorSwitchOf({ ...mesh, [field]: bad }), undefined, `${field}: ${bad}`);
  for (const field of ['frames', 'frameSide'])
    for (const bad of [0, -1, 1.5, NaN, undefined])
      assert.equal(impostorSwitchOf({ ...mesh, [field]: bad }), undefined, `${field}: ${bad}`);
});
