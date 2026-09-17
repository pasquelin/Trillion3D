// Lot « sélection persistante, coupe en une passe », moitié LANCEMENTS : les files de la descente
// tournent à trois, la remise à zéro du compteur quitte le processeur, et une image n'ouvre plus
// 3·profondeur+3 commandes mais 2·profondeur+4.
//
// Oracle = le noyau d'avant, recopié dans `oracles/coupe-lancements.mjs`. Les deux textes tournent
// sur la même scène, dans le même appareil : la mesure n'est recevable que s'ils retiennent les
// mêmes pages et dessinent les mêmes, au bit près.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dag } from '../dagC.mjs';
import { packDagSelection, packedWorldsToRenderOrigin } from '../../gpuDagPack.ts';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import { cameraMoteur } from '../../cameraFixture.ts';
import { DAG_SELECTION_SHADER } from '../../gpuDagShader.ts';
import { DAG_LEVEL_WGSL } from '../../gpuDagLevelWgsl.ts';
import { SELECTION_WORKGROUP } from '../../gpuSelection.ts';
import { residentBase, residentWords } from '../../gpuDagLayout.ts';
import { DAG_LEVEL_WGSL_AVANT } from '../oracles/coupe-lancements.mjs';
import { dansPageWebgpu } from './pageWebgpu.mjs';
import { executer } from './coupeLancementsGpu.mjs';
import { decalages } from './coupeLancementsDecalages.mjs';
import { versPage } from './noyauSelectionGpu.mjs';

const SHADER_AVANT = DAG_SELECTION_SHADER.replace(DAG_LEVEL_WGSL, DAG_LEVEL_WGSL_AVANT);
assert.notEqual(SHADER_AVANT, DAG_SELECTION_SHADER, "l'oracle doit remplacer la descente livrée");

/** Une scène de coupe : les pages d'un DAG de niveaux, toutes résidentes, vues de face. */
function scene(feuilles) {
  const pages = dag({ feuilles, etendue: 3 });
  const packed = packDagSelection([{ world: new THREE.Matrix4(), pages }]);
  const bits = new Uint32Array(
    packed.pageCones.buffer,
    packed.pageCones.byteOffset,
    packed.pageCones.length,
  );
  bits.fill(
    0xffffffff,
    residentBase(packed.pageCount),
    residentBase(packed.pageCount) + residentWords(packed.pageCount),
  );
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
  cam.position.set(0, 0, 7);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const uniforms = cameraSelectionUniforms(cameraMoteur(cam), 1, [1280, 720]);
  packedWorldsToRenderOrigin(packed, [{ world: new THREE.Matrix4() }], uniforms.cameraWorld);
  return { packed, uniforms };
}

/** Le nombre de commandes — passes de calcul et copies hors passe — qu'une image ouvre. Avant, trois
 *  par niveau ; après, six quelle que soit la profondeur : trois copies d'armement et trois passes. */
const commandesAvant = (profondeur) => 3 * profondeur + 3;
const COMMANDES_APRES = 6;

const mediane = (valeurs, champ) => {
  const triees = valeurs.map((v) => v[champ]).sort((a, b) => a - b);
  return Number(triees[triees.length >> 1].toFixed(4));
};

test('la coupe ouvre moins de commandes et retient exactement les mêmes pages', async () => {
  const { packed, uniforms } = scene(12000);
  const cas = versPage('coupe', packed, uniforms, true);
  // La profondeur livrée de cette hiérarchie, puis deux profondeurs de plus : les niveaux de trop
  // trouvent une file vide, mais leurs commandes sont bien ouvertes. C'est la PENTE qu'ils donnent.
  const niveaux = [cas.levelCount, 13, 21];
  const blocs = Math.max(1, Math.ceil(cas.pageCount / SELECTION_WORKGROUP));
  const variante = (nom, shader, files, lancement) => ({
    nom,
    shader,
    files,
    lancement,
    bornes: Array.from(packed.levelSizes),
    decalages: decalages(cas.worldCount, blocs, files, files === 2),
  });
  const releve = await dansPageWebgpu(executer, {
    variantes: [
      variante('avant (deux files)', SHADER_AVANT, 2),
      variante(
        'après (trois files, descente à plat en une passe)',
        DAG_SELECTION_SHADER,
        3,
        'plat',
      ),
      variante('diagnostic : niveau lancé à plat', DAG_SELECTION_SHADER, 3, 'direct'),
      variante('diagnostic : indirect sans armement', DAG_SELECTION_SHADER, 3, 'sansCopie'),
      variante('diagnostic : niveau réduit à une passe vide', DAG_SELECTION_SHADER, 3, 'vide'),
    ],
    cas,
    workgroup: SELECTION_WORKGROUP,
    tours: 200,
    rondes: 5,
    niveaux,
  });
  assert.equal(releve.indisponible, undefined, 'WebGPU doit être disponible');
  assert.deepEqual(releve.compilation ?? [], [], 'les deux noyaux doivent compiler');
  assert.deepEqual(releve.erreurs, []);
  const [avant, apres] = releve.sorties;
  assert.ok(avant.pages.length > 0, 'la coupe doit retenir des pages');
  assert.deepEqual(apres.pages, avant.pages, 'mêmes pages voulues, au bit près');
  assert.deepEqual(apres.dessinees, avant.dessinees, 'mêmes pages dessinées, au bit près');
  assert.equal(apres.overflow, avant.overflow);
  assert.equal(apres.frustumRejected, avant.frustumRejected);

  const lignes = niveaux.map((profondeur, n) => ({
    profondeur,
    commandesAvant: commandesAvant(profondeur),
    commandesApres: COMMANDES_APRES,
    msEncodageAvant: mediane(releve.mesures[0][n], 'encodage'),
    msEncodageApres: mediane(releve.mesures[1][n], 'encodage'),
    msTotalAvant: mediane(releve.mesures[0][n], 'total'),
    msTotalApres: mediane(releve.mesures[1][n], 'total'),
    msNiveauALaPlat: mediane(releve.mesures[2][n], 'total'),
    msNiveauIndirectSansArmement: mediane(releve.mesures[3][n], 'total'),
    msNiveauPasseVide: mediane(releve.mesures[4][n], 'total'),
  }));
  for (const ligne of lignes)
    ligne.gainPourCent = Number((100 * (1 - ligne.msTotalApres / ligne.msTotalAvant)).toFixed(1));
  console.log(
    JSON.stringify(
      {
        adaptateur: releve.adaptateur,
        pages: packed.pageCount,
        noeuds: packed.nodeCount,
        profondeurLivree: cas.levelCount,
        pagesRetenues: avant.pages.length,
        pagesDessinees: avant.dessinees.length,
        imagesParMesure: 200,
        rondes: 5,
        lignes,
      },
      null,
      2,
    ),
  );
  // La seule promesse tenue ici est le nombre de commandes : le temps est publié, jamais asserté.
  for (const ligne of lignes) assert.equal(ligne.commandesApres, 6);
});
