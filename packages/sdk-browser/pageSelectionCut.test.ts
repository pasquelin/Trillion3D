import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { dagFixture, wideCamera } from './pageSelectionDagFixture.ts';
import { dagCulling } from './pageSelectionTestHelpers.ts';

const ASK = {
  pixelError: 0,
  viewport: [1280, 720] as [number, number],
  frame: 1,
  holdResident: true,
};

/** Le DAG de test avec sa hiérarchie de culling, donc avec la coupe hiérarchique. */
function hierarchicalFixture() {
  const fixture = dagFixture();
  fixture.metadata.primitives[0].culling = dagCulling();
  return fixture;
}

function rootsOf(fixture: ReturnType<typeof dagFixture>) {
  return collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  ).roots;
}

/** Clusters demandés et montrés par une coupe, à plat puis hiérarchique, sous la même caméra. */
function bothCuts(cam: THREE.PerspectiveCamera) {
  const cut = (fixture: ReturnType<typeof dagFixture>) => {
    const result = selectVisiblePages(rootsOf(fixture), cam, ASK);
    fixture.geometry.dispose();
    return {
      shown: result.shown.map((page) => page.url).sort(),
      wanted: result.wanted.map((page) => page.url).sort(),
    };
  };
  return { flat: cut(dagFixture()), hierarchical: cut(hierarchicalFixture()) };
}

function lookingAt(from: [number, number, number], at: [number, number, number]) {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  cam.position.set(...from);
  cam.lookAt(...at);
  cam.updateMatrixWorld();
  return cam;
}

for (const [name, cam] of [
  ['tout visible', wideCamera()],
  ['tout hors du tronc', lookingAt([0, 0, -100], [0, 0, -1000])],
  ['mixte', lookingAt([1, 0, 5], [0, 0, 0])],
] as const)
  test(`la coupe hiérarchique est identique à la coupe à plat, caméra ${name}`, () => {
    const { flat, hierarchical } = bothCuts(cam);
    assert.deepEqual(hierarchical.shown, flat.shown, 'mêmes clusters montrés');
    assert.deepEqual(hierarchical.wanted, flat.wanted, 'mêmes clusters demandés');
  });

test('un nœud accepté en bloc ne montre que des clusters sous le seuil (monotonie)', () => {
  const fixture = hierarchicalFixture();
  const roots = rootsOf(fixture);
  for (const pixelError of [0, 0.01, 0.02, 0.1, 0.2, 1]) {
    const result = selectVisiblePages(roots, wideCamera(), { ...ASK, pixelError });
    for (const cluster of result.shown)
      if (cluster.lodError !== undefined)
        assert.ok(
          cluster.lodError <= pixelError,
          `${cluster.url} : erreur ${cluster.lodError} acceptée au-dessus du seuil ${pixelError}`,
        );
  }
  fixture.geometry.dispose();
});

test('un nœud aux bornes invalides (NaN) est rejeté à la préparation', () => {
  const fixture = hierarchicalFixture();
  const page = fixture.metadata.primitives[0].pages[4];
  page.parentError = 0.1;
  page.parentSphere = [NaN, 0, 0, 1];
  assert.throws(() => rootsOf(fixture), /Parametres de cluster invalides/);
  fixture.geometry.dispose();
});

test('nodesTested est un entier positif ou nul après une image de coupe hiérarchique', () => {
  const fixture = hierarchicalFixture();
  const roots = rootsOf(fixture);
  for (const frame of [1, 2, 3]) {
    const { nodesTested } = selectVisiblePages(roots, wideCamera(), { ...ASK, frame });
    assert.ok(Number.isInteger(nodesTested) && nodesTested >= 0, `nodesTested = ${nodesTested}`);
  }
  fixture.geometry.dispose();
});

test('la coupe hiérarchique réutilise son résultat et ses tableaux d’une image à l’autre', () => {
  const fixture = hierarchicalFixture();
  const roots = rootsOf(fixture);
  const cam = wideCamera();
  const shown: PageRec[] = [];
  const wanted: PageRec[] = [];
  const result = {
    shown,
    wanted,
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    nodesTested: 0,
    lodLevel: 0,
    complete: true,
    pixelError: 0,
  };
  const ask = { ...ASK, result, wanted };
  const first = selectVisiblePages(roots, cam, ask, shown);
  const second = selectVisiblePages(roots, cam, { ...ask, frame: 2 }, shown);
  assert.equal(second, first, 'objet résultat réutilisé');
  assert.equal(second.shown, shown, 'tableau shown réutilisé');
  assert.equal(second.wanted, wanted, 'tableau wanted réutilisé');
  fixture.geometry.dispose();
});
