// Pose immobile : la coupe est un point fixe, et le parcours qui la trouve doit se compter une seule
// fois. Le repli par forçage redescend l'arbre après avoir abandonné une première descente ; les
// rejets par le tronc de cette descente abandonnée s'ajoutaient à ceux de la descente retenue. Deux
// images portant exactement la même coupe annonçaient alors deux parcours différents, et le témoin
// d'image tenue ne les voyait jamais identiques.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages, type PageRec } from './pageSelection.ts';
import { dagFixture } from './pageSelectionDagFixture.ts';
import { createWebglFrameGate } from './webglFrameGate.ts';

/** La fixture DAG, toutes pages résidentes, vue serrée sur la moitié gauche : les clusters de
 *  droite sortent du tronc et s'y font compter. */
function coupe() {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const pages = roots.flatMap((root) => root.pages);
  for (const page of pages) page.array = new Uint32Array([0, 1, 2]);
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 1000);
  camera.position.set(-1, 0, 2);
  camera.lookAt(-1, 0, 0);
  camera.updateMatrixWorld();
  const shown: PageRec[] = [],
    wanted: PageRec[] = [];
  const options = {
    pixelError: 0.05,
    viewport: [1280, 720] as [number, number],
    holdResident: true,
    wanted,
  };
  return {
    pages,
    shown,
    tour: () => selectVisiblePages(roots, camera, options, shown),
  };
}

const identifiants = (recs: ReadonlyArray<PageRec>) => recs.map((rec) => rec.id).join(',');

test('pose identique : deux coupes consécutives rendent la même coupe, page pour page', () => {
  const { tour } = coupe();
  const premiere = tour();
  const ids = identifiants(premiere.shown);
  const rejets = premiere.frustumRejected;
  for (let i = 0; i < 3; i++) {
    const suivante = tour();
    assert.equal(identifiants(suivante.shown), ids, 'la coupe a changé sans que rien ne bouge');
    assert.equal(suivante.frustumRejected, rejets, 'le compteur de parcours a changé');
  }
});

test('le repli par forçage ne compte pas la descente qu’il abandonne', () => {
  const { pages, tour } = coupe();
  const sansRepli = tour();
  const rejets = sansRepli.frustumRejected;
  // La liste est réutilisée d'une coupe à l'autre : son contenu se relève avant la coupe suivante.
  const ids = identifiants(sansRepli.shown);
  assert.ok(rejets > 0, 'la vue doit rejeter des clusters pour que le compte ait un sens');
  // Une page absente arme le repli : la coupe change, le nombre de clusters hors tronc, non.
  pages.find((page) => page.url === 'leaf0')!.array = undefined;
  const avecRepli = tour();
  assert.notEqual(identifiants(avecRepli.shown), ids, 'le repli ne s’est pas armé');
  assert.equal(avecRepli.frustumRejected, rejets, 'la descente abandonnée est comptée deux fois');
});

test('le témoin d’image tenue repose sur la coupe, pas sur le compteur de parcours', () => {
  const gate = createWebglFrameGate();
  const a = [{ id: 3 }, { id: 7 }] as PageRec[];
  const b = [{ id: 7 }, { id: 3 }] as PageRec[];
  gate.keep(2, 100, a, 0, false);
  gate.keep(2, 100, a, 0, false);
  assert.equal(gate.held(), true, 'deux images de coupe identique doivent être tenues');
  // Même nombre de pages et mêmes triangles, mais pas les mêmes pages ni le même ordre.
  gate.keep(2, 100, b, 0, false);
  assert.equal(gate.held(), false, 'une coupe différente ne doit jamais être tenue');
});
