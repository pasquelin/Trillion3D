// Côté page de la preuve : le vrai moteur WebGPU (`webgpuPagesBackend`), un vrai appareil, une vraie
// image relue. Aucun état interne n'est inspecté — l'appel public `setTransform` d'un côté, les
// pixels et les compteurs publics de l'autre.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { ouvrirAppareil } from '../../packages/sdk-browser/bench/justesse/appareilWebgpu.mjs';
import { VIEWPORT, cameraFace, image, libere, moteur } from './preuveSceneCommune.mjs';
import { sceneTransparente } from './transparentTransformScene.mjs';

const point = new THREE.Vector3();

/** La couleur lue là où le point monde `(x, y, z)` se projette. Origine bas-gauche, comme `capture`. */
function couleurEn(pixels, camera, x, y, z = 0) {
  point.set(x, y, z).project(camera);
  const [w, h] = VIEWPORT;
  const px = Math.min(w - 1, Math.max(0, Math.round(((point.x + 1) / 2) * (w - 1)))),
    py = Math.min(h - 1, Math.max(0, Math.round(((point.y + 1) / 2) * (h - 1)))),
    i = (py * w + px) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/** Vrai quand la couleur lue porte le rouge du carreau et non le bleu du fond. */
const rouge = (c) => c[0] > 110 && c[0] > c[2] + 40;

/** Une matrice monde colonne-major, prête pour `setTransform`. */
const versApi = (matrice) => new Float32Array(matrice.elements);

/** Translation pure sur `x`. */
function translation(x) {
  return versApi(new THREE.Matrix4().makeTranslation(x, 0, 0));
}

/** Une matrice cisaillée : `y` pousse `x`. Aucune décomposition translation-rotation-échelle ne la
 *  rend, et le carreau penché couvre un coin qu'un carreau droit ne couvre pas. */
function cisaillement(x, facteur) {
  const m = new THREE.Matrix4().set(1, facteur, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  return versApi(m);
}

/** Un relevé nommé : où le rouge se trouve, et ce que les compteurs disent du mélange. */
function releve(nom, backend, camera, pixels, metriques, sondes) {
  return {
    nom,
    rouge: sondes.map(([x, y]) => rouge(couleurEn(pixels, camera, x, y))),
    dessins: metriques.transparentDrawCalls,
    rejetes: metriques.transparentFrustumRejected,
    tenue: metriques.frameHeld,
    items: metriques.transparentMeshes,
  };
}

/**
 * La séquence de la preuve pour une passe donnée : départ, déplacement du nœud, déplacement par le
 * parent, cisaillement, sortie du champ, retour, puis stabilisation et déplacement après tenue.
 */
async function sequence(device, pagine, evenements) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = moteur(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  const camera = cameraFace(),
    etapes = [];
  // Trois sondes : à gauche, à droite, et le coin haut-droit que seul un carreau cisaillé couvre.
  const sondes = [
    [-0.8, 0],
    [0.8, 0],
    [0.5, 0.3],
  ];
  const etape = async (nom) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push(releve(nom, backend, camera, pixels, metriques, sondes));
  };
  try {
    await backend.prepare();
    backend.setTransform('vitre', translation(-0.8));
    await etape('gauche');
    backend.setTransform('vitre', translation(0.8));
    await etape('droite');
    // Le nœud revient chez lui ; c'est le PARENT qui porte le déplacement.
    backend.setTransform('vitre', translation(0));
    backend.setTransform('pivot', translation(-0.8));
    await etape('parent-gauche');
    backend.setTransform('pivot', translation(0));
    backend.setTransform('vitre', cisaillement(0, 0.9));
    await etape('cisaille');
    backend.setTransform('vitre', translation(60));
    await etape('hors-champ');
    backend.setTransform('vitre', translation(-0.8));
    await etape('retour');
    // Stabilisation : deux images identiques, puis l'image tenue. Le déplacement qui suit doit la
    // casser et montrer le nouvel emplacement.
    for (let i = 0; i < 6; i++) await etape('stabilisation-' + i);
    backend.setTransform('vitre', translation(0.8));
    await etape('apres-tenue');
  } finally {
    libere(backend, canvas, s);
  }
  return etapes;
}

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const evenements = [],
    passes = {};
  try {
    for (const pagine of [false, true])
      passes[pagine ? 'pagine' : 'non-pagine'] = await sequence(device, pagine, evenements);
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), passes, evenements, erreurs };
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, passes, evenements, erreurs };
}
