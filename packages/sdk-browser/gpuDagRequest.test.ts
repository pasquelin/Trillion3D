// La DEMANDE de diffusion : la page et sa priorité dans un mot, et l'ordre que cette priorité donne.
//
// Le chemin WebGL2 classe ses requêtes depuis toujours par l'erreur d'écran du REMPLAÇANT — une
// grappe absente est dessinée par un ancêtre plus grossier, et l'erreur de cet ancêtre est ce que
// l'œil voit (`streamingPriority.ts`, `orderPendingUrls`). Le chemin WebGPU les publiait dans
// l'ordre d'un compteur atomique, c'est-à-dire dans aucun. Ce test tient les deux moitiés :
// ① le mot rend exactement ce qu'on y a mis, et la quantification ne renverse jamais deux erreurs ;
// ② l'ordre que la coupe publie est celui de la formule WebGL2, sur la même scène.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  packRequest,
  quantizeRequestPriority,
  REQUEST_PAGE_MAX,
  REQUEST_PRIORITY_MAX,
  REQUEST_PRIORITY_SCALE,
  requestPage,
  requestPriority,
} from './gpuDagRequest.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from './gpuDagSelection.ts';
import { scenePages, sceneRoots } from './gpuDagCutFrontierScene.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { cameraMoteur } from './cameraFixture.ts';
import {
  clusterErrorPixels,
  maxStretch,
  multiplyMatrix4,
  transformAffinePoint,
} from '../sdk-core/index.ts';

test('le mot de demande rend la page et la priorité qu’on y a mises', () => {
  for (const page of [0, 1, 4095, 1959791, REQUEST_PAGE_MAX - 1])
    for (const priorite of [0, 1, 512, REQUEST_PRIORITY_MAX]) {
      const mot = packRequest(page, priorite);
      assert.equal(requestPage(mot), page, `page ${page} / priorité ${priorite}`);
      assert.equal(requestPriority(mot), priorite, `page ${page} / priorité ${priorite}`);
    }
});

test('la quantification est monotone : elle n’inverse jamais deux erreurs', () => {
  const erreurs = [0, 0.001, 0.01, 0.1, 0.5, 1, 2, 4, 16, 64, 256, 4096, 65536, Infinity];
  let precedent = -1;
  for (const pixels of erreurs) {
    const q = quantizeRequestPriority(pixels);
    assert.ok(q >= precedent, `${pixels} px : ${q} < ${precedent}`);
    assert.ok(q >= 0 && q <= REQUEST_PRIORITY_MAX, `${pixels} px hors bornes : ${q}`);
    precedent = q;
  }
  // Une erreur nulle ou absurde ne passe jamais devant une erreur réelle.
  assert.equal(quantizeRequestPriority(0), 0);
  assert.equal(quantizeRequestPriority(-1), 0);
  assert.equal(quantizeRequestPriority(NaN), 0);
  assert.equal(quantizeRequestPriority(Infinity), REQUEST_PRIORITY_MAX);
});

/**
 * La scène du comptage de frontière, posée à QUATRE PROFONDEURS : une seule pose ne retient qu'un
 * étage de détail, donc une seule bande, et l'ordre s'y vérifierait sur rien. Éloignées, les copies
 * se résolvent à des étages différents et la coupe porte plusieurs bandes à la fois — ce qu'une
 * scène réelle fait tout le temps.
 */
function coupe(seuil: number) {
  const pages = scenePages(4096, 8);
  const poses = [0, 12, 30, 70].map((z) => new THREE.Matrix4().makeTranslation(0, 0, -z));
  const roots = sceneRoots(pages, poses, true);
  const packed = packDagSelection(roots);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 200);
  camera.position.set(0, 0, 16);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const cam = cameraMoteur(camera);
  const uni = cameraSelectionUniforms(cam, seuil, [1280, 720]);
  // Le classement WebGL2 lit la MÊME pose : la vue relative du repère de rendu et les poses qui y
  // sont ramenées. Les donner en monde absolu sous une vue relative comparerait deux repères.
  packedWorldsToRenderOrigin(packed, roots, uni.cameraWorld);
  const matrices = roots.map((root) => ({ elements: Array.from(root.world.elements) }));
  return {
    pages,
    packed,
    uni,
    cam,
    roots,
    matrices,
    releve: evaluateDagSelectionKernel(packed, uni),
  };
}

test('l’ordre publié décroît avec l’erreur d’écran du remplaçant, comme le chemin WebGL2', () => {
  const { pages, packed, cam, uni, releve } = coupe(1);
  assert.ok(releve.pageIds.length > 100, 'la coupe doit retenir de quoi classer');
  const focal = Math.max(uni.pixelScale[0], uni.pixelScale[1]);
  // La vue de chaque pose, composée comme le noyau la compose : sur les matrices RAMENÉES AU REPÈRE
  // DE RENDU, celles que `packedWorldsToRenderOrigin` a écrites dans `packed.worlds`. Reprendre
  // celles des racines mêlerait un monde absolu à une vue relative, et poserait toute la scène sur
  // l'œil — ce qui rendrait une erreur infinie pour la moitié de la coupe, en silence.
  const vues = Array.from({ length: packed.worldCount }, (_, w) => {
    const vue = new Float64Array(16);
    multiplyMatrix4(vue, cam.viewRelative, packed.worlds.subarray(w * 16, w * 16 + 16));
    return { vue, stretch: maxStretch(vue as unknown as readonly number[]) };
  });
  // L'erreur d'écran du REMPLAÇANT, par la formule du socle — celle que `orderPendingUrls` emploie,
  // et dont `projected` (WGSL) est le miroir prouvé. La recalculer ici, et non la relire du relevé,
  // est ce qui rend la preuve non circulaire.
  const centre = new Float64Array(4);
  const pixelsDe = (id: number) => {
    const page = pages[id % pages.length],
      { vue, stretch } = vues[Math.floor(id / pages.length)];
    const sphere = (page.parentError === null ? page.sphere : page.parentSphere) as number[];
    const bande = page.parentError === null ? (page.lodError ?? 0) : page.parentError;
    transformAffinePoint(centre, vue, sphere[0], sphere[1], sphere[2]);
    return clusterErrorPixels(
      bande,
      stretch,
      centre[0],
      centre[1],
      centre[2],
      sphere[3],
      focal,
      cam.near,
    );
  };
  const pixels = releve.pageIds.map(pixelsDe);
  assert.ok(
    new Set(pixels.map((p) => p.toFixed(3))).size > 8,
    'la coupe doit porter des erreurs variées',
  );
  // L'ordre publié ne remonte jamais au-delà d'UN PAS de quantification. Deux raisons, et pas une
  // de plus : entre deux grappes d'un même pas l'ordre est indifférent — la référence ne les
  // départage pas non plus —, et la frontière entre deux pas est flottante, le noyau arrondissant
  // en f32 ce que cette preuve recalcule en f64. Un pas vaut 2^(1/16), soit 4,43 %.
  const PAS = 2 ** (1 / REQUEST_PRIORITY_SCALE);
  for (let i = 1; i < pixels.length; i++)
    assert.ok(
      pixels[i] <= pixels[i - 1] * PAS,
      `rang ${i} : ${pixels[i]} px passe plus d'un pas devant ${pixels[i - 1]} px`,
    );
  // Et la première est bien la plus coûteuse absence de toute la coupe, au pas près.
  assert.ok(pixels[0] * PAS >= Math.max(...pixels), 'la tête n’est pas la plus coûteuse');
});
