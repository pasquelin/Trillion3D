import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES } from './hiz.ts';
import { projectCornersInto } from './hizCorners.ts';

/**
 * L'arithmétique d'avant les raccourcis, écrite ici une fois : un produit scalaire pour le
 * dénominateur de vue, un autre pour `cw`, et la conversion écran appliquée à chaque coin. C'est la
 * référence bit à bit que les deux raccourcis — `cw = -viewZ` et la conversion hissée sur les
 * extrema — doivent rendre terme pour terme, quelle que soit la vue et quelle que soit la
 * projection.
 */
function reference(
  corners: Float64Array,
  v: ArrayLike<number>,
  e: ArrayLike<number>,
  near: number,
  width: number,
  height: number,
) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    nearest = Infinity;
  for (let i = 0; i < 8; i++) {
    const x = corners[i * 3],
      y = corners[i * 3 + 1],
      z = corners[i * 3 + 2];
    const vd = v[3] * x + v[7] * y + v[11] * z + v[15];
    const vw = vd === 1 ? 1 : 1 / vd;
    if (-((v[2] * x + v[6] * y + v[10] * z + v[14]) * vw) <= near) return [0, 0, 0, 0, 0, 1];
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0 || !Number.isFinite(cw)) return [0, 0, 0, 0, 0, 1];
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw) * 0.5 + 0.5,
      sy = 1 - (((e[1] * x + e[5] * y + e[9] * z + e[13]) / cw) * 0.5 + 0.5),
      sz = ((e[2] * x + e[6] * y + e[10] * z + e[14]) / cw) * 0.5 + 0.5;
    minX = Math.min(minX, sx * width);
    maxX = Math.max(maxX, sx * width);
    minY = Math.min(minY, sy * height);
    maxY = Math.max(maxY, sy * height);
    nearest = Math.min(nearest, sz);
  }
  return [
    Math.floor(minX),
    Math.floor(minY),
    Math.ceil(maxX),
    Math.ceil(maxY),
    nearest,
    0,
  ] as number[];
}

/** Un générateur à graine fixe : les mêmes boîtes à chaque exécution. */
function graine(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function boites(count: number) {
  const next = graine(20260916);
  const out: Float64Array[] = [];
  for (let b = 0; b < count; b++) {
    const cx = (next() - 0.5) * 400,
      cy = (next() - 0.5) * 120,
      cz = (next() - 0.5) * 400,
      half = 0.05 + next() * 30;
    const corners = new Float64Array(24);
    for (let i = 0; i < 8; i++) {
      corners[i * 3] = cx + (i & 1 ? half : -half);
      corners[i * 3 + 1] = cy + (i & 2 ? half : -half);
      corners[i * 3 + 2] = cz + (i & 4 ? half : -half);
    }
    out.push(corners);
  }
  return out;
}

function compare(
  camera: THREE.Camera,
  view: THREE.Matrix4,
  near: number,
  label: string,
  boxes: Float64Array[],
) {
  const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, view);
  const into = new Float64Array(HIZ_BOUNDS_VALUES);
  let projected = 0;
  for (const corners of boxes) {
    projectCornersInto(
      corners,
      0,
      view.elements,
      viewProj.elements,
      near,
      1280,
      720,
      false,
      into,
      0,
    );
    const expected = reference(corners, view.elements, viewProj.elements, near, 1280, 720);
    for (let k = 0; k < HIZ_BOUNDS_VALUES; k++)
      assert.ok(
        Object.is(into[k], expected[k]),
        `${label} valeur ${k} : ${into[k]} au lieu de ${expected[k]}`,
      );
    if (into[5] === 0) projected++;
  }
  assert.ok(projected > boxes.length / 4, `${label} : trop peu de boîtes projetées (${projected})`);
}

test('la projection rend, bit pour bit, ce que rendait le produit scalaire complet par coin', () => {
  const boxes = boites(400);
  const perspective = new THREE.PerspectiveCamera(50, 1280 / 720, 0.1, 5000);
  perspective.position.set(3, 40, 160);
  perspective.rotation.set(-0.2, 0.4, 0.1);
  perspective.updateMatrixWorld(true);
  compare(perspective, perspective.matrixWorldInverse, perspective.near, 'perspective', boxes);

  // Une projection orthographique n'a pas (0,0,-1,0) pour quatrième ligne : `cw` repasse par son
  // produit scalaire, et la boîte doit sortir aux mêmes bits.
  const ortho = new THREE.OrthographicCamera(-200, 200, 120, -120, 0.1, 5000);
  ortho.position.set(3, 40, 160);
  ortho.updateMatrixWorld(true);
  compare(ortho, ortho.matrixWorldInverse, ortho.near, 'orthographique', boxes);

  // Une vue dont la quatrième ligne n'est pas (0,0,0,1) : le dénominateur de vue revit.
  const oblique = perspective.matrixWorldInverse.clone();
  oblique.elements[3] = 1e-4;
  oblique.elements[7] = -2e-4;
  oblique.elements[11] = 3e-4;
  oblique.elements[15] = 1.0000001;
  compare(perspective, oblique, perspective.near, 'vue non affine', boxes);
});
