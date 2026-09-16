// `writeConeVolume` lit `faceBasis`, écrit par `composeFace` (voir `sceneLightShadowMath.test.ts` pour
// le rattachement au socle et ses zéros signés) et son propre produit scalaire est passé à
// `dotVector3`. Ce test vérifie que la sortie publique du cône reste identique à celle du code
// d'avant sur des rectangles et directions hostiles aux zéros signés.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFace, shadowProjection } from './sceneLightShadowMath.ts';
import { writeConeVolume } from './sceneLightShadowVolume.ts';
import {
  referenceComposeFace,
  referenceConeAxisCosine,
  referenceShadowProjection,
} from '../sdk-browser/bench/oracles/socle-math-ombres.mjs';

const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [0, -0, 1],
  [-0, 1, -0],
  [0.6, -0.8, 0],
];
const RECTS = [
  Float64Array.from([-1, 1, -1, 1]),
  Float64Array.from([-0, 1, -0, 1]),
  Float64Array.from([0, 0, 0, -0]),
  Float64Array.from([-0.3, 0.3, -0.2, 0.2]),
];

test('writeConeVolume : rectangles et directions hostiles aux zéros signés — bit à bit contre le code d’avant', () => {
  let compares = 0;
  for (const avant of DIRECTIONS) {
    const eye: [number, number, number] = [0, 0, 0];
    const proj = new Float32Array(16);
    referenceShadowProjection(proj, Math.PI / 2, 10);
    shadowProjection(Math.PI / 2, 10);
    // Compose la face des deux côtés : `writeConeVolume` comme l'oracle lisent le dernier repère écrit.
    referenceComposeFace(new Float32Array(16), 0, eye, avant, proj);
    composeFace(new Float32Array(16), 0, eye, avant);
    for (const rect of RECTS) {
      const attendu = new Float32Array(8),
        recu = new Float32Array(8);
      const cone = referenceConeAxisCosine(rect, Math.PI / 4);
      attendu.set(cone, 4);
      writeConeVolume(recu, 0, eye, 10, Math.PI / 4, rect);
      compares++;
      for (let i = 4; i < 8; i++)
        assert.ok(
          Object.is(attendu[i], recu[i]),
          `avant=${avant} rect=${[...rect]} i=${i} : ${attendu[i]} ≠ ${recu[i]}`,
        );
    }
  }
  assert.ok(compares >= 12, `${compares} comparaisons, jeu trop petit`);
});
