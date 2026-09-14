import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectClusterPages,
  selectVisiblePages,
  type PageRec,
  type SelectionResult,
} from './pageSelection.ts';
import { blendFixture, camera } from './pageSelectionBlendFixture.ts';

test("une image de coupe réutilise sa table plate, son résultat et ses tableaux : elle n'alloue rien", () => {
  const fixture = blendFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const table = roots[0].table,
    shown: PageRec[] = [],
    wanted: PageRec[] = [];
  const result: SelectionResult<PageRec> = {
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
  const cam = camera(),
    ask = {
      pixelError: 100,
      viewport: [960, 540] as [number, number],
      frame: 1,
      holdResident: true,
      wanted,
      result,
    };
  const first = selectVisiblePages(roots, cam, ask, shown);
  ask.frame = 2;
  const second = selectVisiblePages(roots, cam, ask, shown);
  assert.equal(second, first, 'le résultat rendu est celui fourni, image après image');
  assert.equal(second, result);
  assert.equal(second.shown, shown);
  assert.equal(second.wanted, wanted);
  assert.equal(
    roots[0].table,
    table,
    'la table plate est construite avec la primitive, jamais par image',
  );
  assert.deepEqual(
    second.shown.map((page) => page.url),
    ['near'],
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test("une bande de cluster invalide est refusée à la préparation, pas au milieu d'une image", () => {
  const fixture = blendFixture();
  // La sphère propre est déjà validée au chargement ; celle du remplaçant ne l'était nulle part.
  const page = fixture.metadata.primitives[0].pages[0] as {
    parentError: number | null;
    parentSphere: number[] | null;
  };
  page.parentError = 1;
  page.parentSphere = [0, 0, 0, -1];
  assert.throws(
    () =>
      collectClusterPages(fixture.source, fixture.metadata, fixture.indices, fixture.associations),
    /Parametres de cluster invalides/,
  );
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('deux appels successifs avec la même caméra sélectionnent le même ensemble de clusters', () => {
  const fixture = blendFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = camera();
  const shown1: PageRec[] = [];
  const first = selectVisiblePages(
    roots,
    cam,
    { pixelError: 100, viewport: [960, 540], frame: 1, holdResident: true },
    shown1,
  );
  const shown2: PageRec[] = [];
  const second = selectVisiblePages(
    roots,
    cam,
    { pixelError: 100, viewport: [960, 540], frame: 2, holdResident: true },
    shown2,
  );
  assert.deepEqual(
    first.shown.map((p) => p.url),
    second.shown.map((p) => p.url),
    'même ensemble montré',
  );
  assert.deepEqual(
    first.wanted.map((p) => p.url),
    second.wanted.map((p) => p.url),
    'même ensemble voulu',
  );
  assert.equal(first.frustumRejected, second.frustumRejected, 'même rejet frustum');
  assert.equal(first.lodLevel, second.lodLevel, 'même niveau LOD');
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test("les tableaux de travail de la sélection sont réutilisés d'une image à l'autre", () => {
  const fixture = blendFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const cam = camera(),
    ask = {
      pixelError: 100,
      viewport: [960, 540] as [number, number],
      frame: 0,
      holdResident: true,
    };
  const hint: PageRec[] = [];
  const first = selectVisiblePages(roots, cam, ask, hint);
  ask.frame = 1;
  const second = selectVisiblePages(roots, cam, ask, hint);
  assert.deepEqual(
    first.shown.map((p) => p.url),
    second.shown.map((p) => p.url),
    'même ensemble montré',
  );
  assert.deepEqual(
    first.wanted.map((p) => p.url),
    second.wanted.map((p) => p.url),
    'même ensemble voulu',
  );
  assert.equal(first.frustumRejected, second.frustumRejected, 'même rejet frustum');
  fixture.geometry.dispose();
  fixture.material.dispose();
});
