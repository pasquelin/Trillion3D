// `composeFace` est passée d'un produit 4×4 écrit en ligne (accumulateur initialisé à `0`) à
// `multiplyMatrix4`, qui ne part d'aucun zéro : `mathMatrix4.test.ts` prouve que cette forme peut
// rendre -0 là où l'ancienne rendait toujours +0. Ce test vérifie si cet écart atteint la sortie
// publique de `composeFace`, sur des directions et yeux hostiles aux zéros signés ; l'oracle est le
// code d'avant, recopié tel quel dans `sdk-browser/bench/oracles/socle-math-ombres.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFace, shadowOrthographic, shadowProjection } from './sceneLightShadowMath.ts';
import {
  referenceComposeFace,
  referenceShadowOrthographic,
  referenceShadowProjection,
} from '../sdk-browser/bench/oracles/socle-math-ombres.mjs';

/** Les six axes ponctuels, puis chacun avec ses composantes nulles rendues négatives, une à une et
 *  toutes ensemble : la même hostilité que `POINT_FACE_AXES` du banc. */
const AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
function variantesZeroSigne(axe: readonly [number, number, number]) {
  const variantes: Array<[number, number, number]> = [[...axe]];
  for (let signes = 1; signes < 8; signes++)
    variantes.push(
      axe.map((c, k) => (c === 0 && signes & (1 << k) ? -0 : c)) as [number, number, number],
    );
  return variantes;
}
const YEUX: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
];

test('composeFace : axes et zéros signés hostiles, perspective et orthographique — bit à bit contre le code d’avant', () => {
  let compares = 0;
  for (const axe of AXES)
    for (const avant of variantesZeroSigne(axe))
      for (const oeil of YEUX)
        for (const perspective of [true, false]) {
          const proj = new Float32Array(16);
          if (perspective) {
            referenceShadowProjection(proj, Math.PI / 2, 10);
            shadowProjection(Math.PI / 2, 10);
          } else {
            referenceShadowOrthographic(proj, 5, 100);
            shadowOrthographic(5, 100);
          }
          const attendu = new Float32Array(16),
            recu = new Float32Array(16);
          referenceComposeFace(attendu, 0, oeil, avant, proj);
          composeFace(recu, 0, oeil, avant);
          compares++;
          for (let i = 0; i < 16; i++)
            assert.ok(
              Object.is(attendu[i], recu[i]),
              `avant=${avant} oeil=${oeil} perspective=${perspective} i=${i} : ${attendu[i]} ≠ ${recu[i]}`,
            );
        }
  assert.ok(compares >= 200, `${compares} comparaisons, jeu trop petit`);
});

// Lot perf-2 : `composeFace` compose désormais à part (`multiplyMatrix4` sans décalage) puis recopie
// ses seize nombres à `out[base..base+15]`. Le test ci-dessus ne porte que sur `base = 0` ; les
// appelants réels (`sceneLightShadowFaces.ts`, `sceneLightSunFaces.ts`) empaquettent plusieurs faces
// dans un même tampon à des décalages non nuls. Ce test tient la recopie : bit à bit contre la même
// référence à un décalage quelconque, et rien d'écrit hors des seize indices ciblés.
test('composeFace : la recopie à un décalage non nul rend les mêmes bits, sans toucher au reste du tampon', () => {
  const BASE = 32; // une troisième face dans un tampon de faces packées à seize flottants chacune
  const eyes: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0],
    [3, -4, 5],
    [-0, -0, -0],
  ];
  const avants: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ];
  for (const oeil of eyes)
    for (const avant of avants)
      for (const perspective of [true, false]) {
        const proj = new Float32Array(16);
        if (perspective) {
          referenceShadowProjection(proj, Math.PI / 2, 10);
          shadowProjection(Math.PI / 2, 10);
        } else {
          referenceShadowOrthographic(proj, 5, 100);
          shadowOrthographic(5, 100);
        }
        // Rempli d'une sentinelle avant la face : les deux côtés partent du même tampon « sale », et
        // un écart hors de [BASE, BASE+16[ — recopie décalée d'un cran, garde débordante — le montre.
        const gardeAttendu = new Float32Array(BASE + 16).fill(7),
          gardeRecu = new Float32Array(BASE + 16).fill(7);
        referenceComposeFace(gardeAttendu, BASE, oeil, avant, proj);
        composeFace(gardeRecu, BASE, oeil, avant);
        for (let i = 0; i < BASE + 16; i++)
          assert.ok(
            Object.is(gardeAttendu[i], gardeRecu[i]),
            `oeil=${oeil} avant=${avant} i=${i} : ${gardeAttendu[i]} ≠ ${gardeRecu[i]}`,
          );
      }
});
