// Cas 4 de la convention des normales singulières (lot normales singulières) : une pose non finie
// est refusée AVANT toute inversion, ici à `setTransform` plutôt qu'au chargement (`explorerScene`,
// couvert par `explorerSceneFiniteTransform.test.ts`). Fixtures communes à
// `webgpuTransformCisaillement.test.ts`, dans `webgpuTransformCisaillementFixture.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../sdk-core/index.ts';
import { setWebgpuTransform } from './webgpuPagesTransform.ts';
import { cisaillee, runtime, scene, versGpu } from './webgpuTransformCisaillementFixture.ts';

test('setWebgpuTransform refuse une matrice NaN ou infinie (NON_FINITE_TRANSFORM), le nœud reste inchangé', () => {
  const { source, mesh } = scene(),
    { rt } = runtime(source),
    intacte = mesh.matrixWorld.elements.slice();
  for (const [index, valeur] of [
    [0, NaN],
    [15, Infinity],
    [7, -Infinity],
  ] as const) {
    const demandee = versGpu(cisaillee(3, 6));
    demandee[index] = valeur;
    assert.throws(
      () => setWebgpuTransform(rt, 'cible', demandee),
      (erreur: unknown) =>
        erreur instanceof EngineError &&
        erreur.code === 'NON_FINITE_TRANSFORM' &&
        erreur.details.nodeName === 'cible' &&
        erreur.details.index === index,
      `index ${index}=${valeur} non refusé`,
    );
    assert.deepEqual(
      Array.from(mesh.matrixWorld.elements),
      Array.from(intacte),
      'une pose refusée ne doit laisser aucune trace sur le nœud',
    );
  }
});
