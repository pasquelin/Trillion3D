import test from 'node:test';
import assert from 'node:assert/strict';
import { normalMatrix3 } from './mathMatrix3.ts';
import { dotVector3 } from './mathVector.ts';

test('normalMatrix3 : bloc identité affine rend l’identité 3×3', () => {
  const m = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
  const out = normalMatrix3(new Float64Array(9), m);
  assert.deepEqual([...out], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
});

test('normalMatrix3 : échelle non uniforme, diagonale réciproque terme à terme', () => {
  const m = Float64Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 5, 0, 1, 2, 3, 1]);
  const out = normalMatrix3(new Float64Array(9), m);
  assert.deepEqual([out[0], out[4], out[8]], [0.5, 1 / 3, 0.2]);
  assert.deepEqual([out[1], out[2], out[3], out[5], out[6], out[7]], [0, 0, 0, 0, 0, 0]);
});

test('normalMatrix3 : bloc linéaire de déterminant nul rend la matrice nulle, comme documenté', () => {
  // Colonne 1 = 2 × colonne 0 : bloc singulier.
  const m = Float64Array.from([1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const out = normalMatrix3(new Float64Array(9).fill(9), m);
  assert.deepEqual([...out], new Array(9).fill(0));
});

test('normalMatrix3 : préserve la perpendicularité normale/tangente sous cisaillement', () => {
  // Cisaillement en x selon y : une normale et une tangente perpendiculaires dans l'espace objet
  // doivent le rester dans l'espace transformé une fois la normale portée par la matrice normale.
  const m = Float64Array.from([1, 0, 0, 0, 0.7, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const normaleObjet: [number, number, number] = [0, 1, 0];
  const tangenteObjet: [number, number, number] = [1, 0, 0];
  assert.equal(dotVector3(normaleObjet, tangenteObjet), 0);
  const n = normalMatrix3(new Float64Array(9), m);
  const normaleMonde: [number, number, number] = [
    n[0] * normaleObjet[0] + n[3] * normaleObjet[1] + n[6] * normaleObjet[2],
    n[1] * normaleObjet[0] + n[4] * normaleObjet[1] + n[7] * normaleObjet[2],
    n[2] * normaleObjet[0] + n[5] * normaleObjet[1] + n[8] * normaleObjet[2],
  ];
  const tangenteMonde: [number, number, number] = [
    m[0] * tangenteObjet[0] + m[4] * tangenteObjet[1] + m[8] * tangenteObjet[2],
    m[1] * tangenteObjet[0] + m[5] * tangenteObjet[1] + m[9] * tangenteObjet[2],
    m[2] * tangenteObjet[0] + m[6] * tangenteObjet[1] + m[10] * tangenteObjet[2],
  ];
  assert.ok(Math.abs(dotVector3(normaleMonde, tangenteMonde)) < 1e-12);
});
