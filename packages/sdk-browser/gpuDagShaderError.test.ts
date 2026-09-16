// Le miroir WGSL de la variante d'EXPÉRIENCE : le texte livré porte la nôtre, la campagne de la
// référence externe ne retourne qu'une constante, et la branche du nuanceur reprend mot pour mot
// `referenceScreenError` de sdk-core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceScreenError } from '../sdk-core/index.ts';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
import { REFERENCE_ERROR_DECL, withScreenErrorVariant } from './gpuDagShaderError.ts';

test('le texte par défaut est rendu caractère pour caractère, la constante étant fausse', () => {
  assert.ok(DAG_SELECTION_SHADER.includes(REFERENCE_ERROR_DECL));
  assert.equal(withScreenErrorVariant(DAG_SELECTION_SHADER, 'certifiee'), DAG_SELECTION_SHADER);
  // La borne certifiée est toujours là, opérandes et ordre inchangés.
  assert.match(DAG_SELECTION_SHADER, /return \(\(shift\*focal\)\/nearest\)\*\(slant\/closest\);/);
});

test('la variante reference ne retourne que la constante, et porte la même formule que le CPU', () => {
  const code = withScreenErrorVariant(DAG_SELECTION_SHADER, 'reference');
  assert.equal(code.split('const REFERENCE_ERROR:bool=true;').length, 2);
  assert.ok(!code.includes(REFERENCE_ERROR_DECL));
  assert.equal(
    code.replace('const REFERENCE_ERROR:bool=true;', REFERENCE_ERROR_DECL),
    DAG_SELECTION_SHADER,
  );
  // La branche du nuanceur, recopiée : mêmes opérandes, même ordre que `referenceScreenError`.
  assert.match(
    code,
    /if\(!\(depth>uni\.near\)\)\{return INF;\}\n {2}let delta=error\*stretch;\n {2}return \(delta\*focal\)\/depth;/,
  );
  for (const [error, stretch, depth, focal, near] of [
    [0.05, 1, 10, 600, 0.1],
    [0.5, 0.02, 12, 900, 0.1],
    [7, 1.5, 0.05, 512, 0.1],
  ] as const) {
    const delta = error * stretch;
    const noyau = !(depth > near) ? Infinity : (delta * focal) / depth;
    assert.equal(noyau, referenceScreenError(error, stretch, depth, focal, near));
  }
});

test('un texte sans la déclaration est refusé plutôt que rendu inchangé', () => {
  assert.throws(
    () => withScreenErrorVariant('fn projected(){}', 'reference'),
    /declaration REFERENCE_ERROR absente/,
  );
});
