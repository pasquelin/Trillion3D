// Case 4 of the singular-normals convention (singular-normals lot): a non-finite pose is refused
// BEFORE any inversion, here at `setTransform` rather than at load (`explorerScene`, covered by
// `../../world/scene/finiteTransform.test.ts`). Fixtures shared with `transformShear.test.ts`,
// in `transformShear.fixture.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../../../../sdk-core/src/index.ts';
import { setWebgpuTransform } from '../pages/render/transform.ts';
import { cisaillee, runtime, scene, versGpu } from './transformShear.fixture.ts';

test('setWebgpuTransform refuses a NaN or infinite matrix (NON_FINITE_TRANSFORM), the node stays unchanged', () => {
  const { source, mesh, worlds } = scene(),
    { rt } = runtime(source, [], worlds),
    monde = worlds.of(mesh),
    intacte = Array.from(monde.elements);
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
      `index ${index}=${valeur} not refused`,
    );
    assert.deepEqual(
      Array.from(monde.elements),
      Array.from(intacte),
      'a refused pose must leave no trace on the node',
    );
  }
});
