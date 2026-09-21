// Batch M2, mathCone.ts: rejection of a box by its normal cone, compared against a reference built
// with Three.js primitives (Vector3, Matrix3, Matrix4), under conformal and hostile placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boxConeRejects, coneRejects } from './index.ts';

/** `pageCone.ts` before batch M2, copied with Three primitives (see bench/oracles/volumes.ts). */
function reference(
  axe: number[],
  angle: number,
  min: number[],
  max: number[],
  world: THREE.Matrix4,
  normal: THREE.Matrix3,
  echelle: number,
  oeil: number[],
) {
  const centre = new THREE.Vector3(
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ).applyMatrix4(world);
  const rayon =
    Math.hypot((max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5) * echelle;
  const d = centre.distanceTo(new THREE.Vector3(...(oeil as [number, number, number])));
  const etalement = d > rayon ? Math.asin(Math.min(1, Math.max(0, rayon / d))) : Math.PI;
  const axis = new THREE.Vector3(...(axe as [number, number, number])).applyMatrix3(normal);
  const longueur = axis.length();
  if (!(longueur > 0)) return false;
  axis.multiplyScalar(1 / longueur);
  const vue = new THREE.Vector3(...(oeil as [number, number, number])).sub(centre);
  const vl = vue.length();
  if (!(vl > 0)) return false;
  const dot = Math.min(1, Math.max(-1, axis.dot(vue) / vl));
  try {
    return coneRejects(dot, angle, etalement);
  } catch {
    return false;
  }
}

function appeler(c: {
  axe: number[];
  angle: number;
  min: number[];
  max: number[];
  world: THREE.Matrix4;
  normal: THREE.Matrix3;
  echelle: number;
  oeil: number[];
}) {
  return boxConeRejects(
    c.axe,
    c.angle,
    c.min,
    c.max,
    c.world.elements,
    c.normal.elements,
    c.echelle,
    c.oeil[0],
    c.oeil[1],
    c.oeil[2],
  );
}

function place(sx: number, sy: number, sz: number, position: number[], euler: number[]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    q,
    new THREE.Vector3(sx, sy, sz),
  );
}

test('boxConeRejects matches reference under conformal placement (uniform scale and rotation)', () => {
  for (const [sx, sy, sz] of [
    [2, 2, 2],
    [0.5, 0.5, 0.5],
  ]) {
    const world = place(sx, sy, sz, [3, -1, 2], [0.4, -0.7, 1.1]);
    const normal = new THREE.Matrix3().getNormalMatrix(world);
    const c = {
      axe: [0.2, 0.9, -0.1],
      angle: Math.PI / 4,
      min: [-1, -1, -1],
      max: [1, 1, 1],
      world,
      normal,
      echelle: sx,
      oeil: [10, 8, 6],
    };
    assert.equal(
      appeler(c),
      reference(c.axe, c.angle, c.min, c.max, world, normal, c.echelle, c.oeil),
    );
  }
});

test('eye inside bounding sphere yields spread of π and never rejects', () => {
  const world = place(1, 1, 1, [0, 0, 0], [0, 0, 0]);
  const normal = new THREE.Matrix3().getNormalMatrix(world);
  const c = {
    axe: [0, 1, 0],
    angle: 0,
    min: [-1, -1, -1],
    max: [1, 1, 1],
    world,
    normal,
    echelle: 1,
    oeil: [0.1, 0.1, 0.1], // inside the box
  };
  assert.equal(appeler(c), false);
  assert.equal(
    appeler(c),
    reference(c.axe, c.angle, c.min, c.max, world, normal, c.echelle, c.oeil),
  );
});

test('zero cone axis never rejects (neither does reference)', () => {
  const world = place(1, 1, 1, [0, 0, 0], [0.3, 0.1, 0]);
  const normal = new THREE.Matrix3().getNormalMatrix(world);
  const c = {
    axe: [0, 0, 0],
    angle: Math.PI / 6,
    min: [-1, -1, -1],
    max: [1, 1, 1],
    world,
    normal,
    echelle: 1,
    oeil: [20, 0, 0],
  };
  assert.equal(appeler(c), false);
  assert.equal(reference(c.axe, c.angle, c.min, c.max, world, normal, c.echelle, c.oeil), false);
});

test('angle outside [0, π] is refused by coneRejects, so does not reject (try/catch)', () => {
  const world = place(1, 1, 1, [0, 0, 0], [0, 0, 0]);
  const normal = new THREE.Matrix3().getNormalMatrix(world);
  const c = {
    axe: [0, 1, 0],
    angle: 5, // > π
    min: [-1, -1, -1],
    max: [1, 1, 1],
    world,
    normal,
    echelle: 1,
    oeil: [20, 0, 0],
  };
  assert.equal(appeler(c), false);
  assert.equal(reference(c.axe, c.angle, c.min, c.max, world, normal, c.echelle, c.oeil), false);
});

test('tangent cone rejects exactly like reference, on both sides of tangency', () => {
  const world = place(1, 1, 1, [0, 0, 0], [0, 0, 0]);
  const normal = new THREE.Matrix3().getNormalMatrix(world);
  const base = {
    min: [-0.01, -0.01, -0.01],
    max: [0.01, 0.01, 0.01],
    world,
    normal,
    echelle: 1,
    oeil: [0, 0, 100],
  };
  for (const angle of [Math.PI / 6 - 1e-6, Math.PI / 6, Math.PI / 6 + 1e-6]) {
    const c = { ...base, axe: [0, 0, -1], angle };
    assert.equal(
      appeler(c),
      reference(c.axe, c.angle, c.min, c.max, world, normal, c.echelle, c.oeil),
    );
  }
});
