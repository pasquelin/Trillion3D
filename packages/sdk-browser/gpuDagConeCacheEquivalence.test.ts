import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDagSelectionKernel } from './gpuDagSelection.ts';
import { cameraSelectionUniforms, PAGE_CONE_FLOATS } from './gpuSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { packed } from './gpuDagSelectionTestHelpers.ts';

// D5 : gpuDagShader.ts calcule desormais coneRejects une seule fois par page visible (dagWanted) et
// le relit dans dagEscalate/dagCheck/dagMask au lieu de le refaire. evaluateDagSelectionKernel porte
// les deux modes derriere son 4e parametre `cacheCone` (gpuDagOracle.ts) : false recalcule a chaque
// site comme avant le lot D5, true met en cache la premiere lecture (toujours celle du parcours
// pageIds, l'equivalent CPU de dagWanted) et la relit ensuite, comme le shader depuis D5. Les deux
// modes doivent produire exactement le meme resultat.

function assertSameSelection(
  dag: ReturnType<typeof packed>['dag'],
  uniforms: ReturnType<typeof cameraSelectionUniforms>,
  resident?: Uint32Array,
) {
  const recomputed = evaluateDagSelectionKernel(dag, uniforms, resident, false);
  const cached = evaluateDagSelectionKernel(dag, uniforms, resident, true);
  assert.deepEqual(cached.pageIds, recomputed.pageIds, 'pageIds diffèrent');
  assert.deepEqual(cached.drawablePageIds, recomputed.drawablePageIds, 'drawablePageIds diffèrent');
  assert.equal(cached.frustumRejected, recomputed.frustumRejected);
  assert.equal(cached.lodLevel, recomputed.lodLevel);
  assert.equal(cached.complete, recomputed.complete);
  return recomputed;
}

test('scene normale : cache et recalcul choisissent les memes pages, plusieurs pixelError', () => {
  const { dag } = packed(dagFixture());
  const cam = wideCamera();
  for (const pixelError of [0, 1, 3.4, 20, 200]) {
    const uniforms = cameraSelectionUniforms(cam, pixelError, [1280, 720]);
    assertSameSelection(dag, uniforms);
  }
});

test('resident cut : cache et recalcul escaladent aux memes pages absentes', () => {
  const { dag } = packed(dagFixture());
  const cam = wideCamera();
  const uniforms = cameraSelectionUniforms(cam, 1, [1280, 720]);
  const allMissing = new Uint32Array(dag.pageCount); // aucune page residente
  assertSameSelection(dag, uniforms, allMissing);
  const allResident = new Uint32Array(dag.pageCount).fill(1);
  assertSameSelection(dag, uniforms, allResident);
});

test('cone dégénéré : hasBox a zero pour toutes les pages, coneRejects toujours faux', () => {
  const { dag } = packed(dagFixture());
  for (let i = 0; i < dag.pageCount; i++) dag.pageCones[i * PAGE_CONE_FLOATS + 7] = 0;
  const cam = wideCamera();
  const uniforms = cameraSelectionUniforms(cam, 1, [1280, 720]);
  const result = assertSameSelection(dag, uniforms);
  // Sans boite de cone, coneRejects rend toujours faux : aucune page visible n'est ecartee par lui.
  assert.ok(result.pageIds.length > 0);
});

test('camera loin de tout : toutes les pages sont hors frustum, le cache reste vide', () => {
  const { dag } = packed(dagFixture());
  const cam = wideCamera();
  cam.position.set(1e6, 0, 0);
  cam.lookAt(2e6, 0, 0);
  cam.updateMatrixWorld();
  const uniforms = cameraSelectionUniforms(cam, 1, [1280, 720]);
  const result = assertSameSelection(dag, uniforms, new Uint32Array(dag.pageCount));
  assert.equal(result.frustumRejected, dag.pageCount);
  assert.equal(result.pageIds.length, 0);
});
