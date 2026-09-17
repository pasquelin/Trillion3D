// L'élagage PAR LE HAUT ne retire aucune grappe que la coupe aurait prise.
//
// La descente écarte un sous-arbre dont le PLANCHER d'erreur dépasse le seuil : aucune de ses
// grappes n'est assez fine, donc aucune n'aurait été retenue. La borne est un minorant, et un
// minorant SURESTIMÉ retire de la géométrie sans rien dire — c'est le seul risque du lot, et c'est
// ce que ce fichier interdit.
//
// La référence n'est pas une autre formule : c'est le MÊME oracle, ses nœuds tous ouverts. La coupe
// obtenue avec la descente complète, page par page, doit être celle que la descente élaguée rend.
// Les deux lisent les mêmes enregistrements f32 : ce qui les sépare est l'élagage, et rien d'autre.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { packDagSelection, packedWorldsToRenderOrigin } from './gpuDagPack.ts';
import { evaluateDagSelectionKernel } from './gpuDagSelection.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { cameraMoteur } from './cameraFixture.ts';
import { dagRecords, worldOf } from './gpuDagLayout.ts';
import { dagViewFrames } from './gpuDagOracleMath.ts';
import { createDagOraclePredicates } from './gpuDagOraclePredicates.ts';
import { descenteComptee } from './gpuDagCutFrontierFixture.ts';
import { scenePages, sceneRoots } from './gpuDagCutFrontierScene.ts';

const pages = scenePages(4096, 8);
const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);

/** La coupe qu'une descente SANS élagage rendrait : tous les nœuds ouverts, donc le seul filtre
 *  restant est celui que `dagWanted` pose par grappe — tronc, cône, bande d'erreur. */
function coupeSansElagage(packed: ReturnType<typeof packDagSelection>, uniforms: unknown) {
  const frames = dagViewFrames(packed, uniforms as Parameters<typeof dagViewFrames>[1]);
  const records = dagRecords(packed);
  const { coneRejects, visible, selects } = createDagOraclePredicates({
    packed,
    records,
    nodeFlags: new Uint8Array(Math.max(1, packed.nodeCount)),
    ...frames,
  });
  const retenues: number[] = [];
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i);
    if (visible(i) && selects(i, frames.pixelError) && !coneRejects(i, w)) retenues.push(i);
  }
  return retenues;
}

const POSES: Array<[string, number, number]> = [
  ['face', 0, 16],
  ['de biais', 9, 14],
  ['de loin', 0, 60],
  ['au contact', 1.5, 3],
];
const SEUILS = [0.25, 1, 4];

for (const parNiveaux of [false, true]) {
  const nomHierarchie = parNiveaux ? 'hiérarchie du compilateur' : 'hiérarchie du rangement';
  test(`${nomHierarchie} : l'élagage par le haut ne retire aucune grappe retenue`, () => {
    const roots = sceneRoots(
      pages,
      Array.from({ length: 4 }, () => new THREE.Matrix4()),
      parNiveaux,
    );
    const packed = packDagSelection(roots);
    let elagages = 0;
    for (const [nom, x, z] of POSES)
      for (const seuil of SEUILS) {
        for (let w = 0; w < roots.length; w++)
          roots[w].world.makeTranslation((w % 2) * 6.5 - 3.25, Math.floor(w / 2) * 6.5 - 3.25, 0);
        cam.position.set(x, 0, z);
        cam.lookAt(x, 0, 0);
        cam.updateMatrixWorld();
        const uniforms = cameraSelectionUniforms(cameraMoteur(cam), seuil, [1280, 720]);
        packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);
        const attendu = coupeSansElagage(packed, uniforms);
        const obtenu = [...evaluateDagSelectionKernel(packed, uniforms).pageIds].sort(
          (a, b) => a - b,
        );
        assert.deepEqual(obtenu, attendu, `${nom} à ${seuil} px`);
        elagages += descenteComptee(packed, uniforms, true).plancherCoupe;
      }
    // Sans élagage, la preuve serait vide : le seuil dit que la borne a bien tranché quelque part.
    assert.ok(elagages > 0, `aucun sous-arbre élagué : la preuve ne porte sur rien`);
  });
}
