// Côté page de la preuve « `setTransform` sous un parent périmé » : le vrai moteur WebGPU, un vrai
// appareil, une vraie image relue. L'hôte écrit directement la position, la rotation et l'échelle
// du parent — jamais par `setTransform`, jamais suivi d'un `updateMatrixWorld` manuel — pour que la
// seule façon dont le moteur peut voir ce changement soit la résolution qu'il fait lui-même avant
// d'inverser la matrice du parent (`resolveHostNode`, dans `setWebgpuTransform`).
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import {
  cameraFace,
  difference,
  executerPasses,
  image,
  libere,
  moteur,
  redCount,
} from './preuveSceneCommune.mjs';
import { sceneTransparente } from './transparentTransformScene.mjs';

/** Une matrice monde colonne-major, translation pure sur `x`. */
function translation(x) {
  return new Float32Array(new THREE.Matrix4().makeTranslation(x, 0, 0).elements);
}

/**
 * La séquence pour une passe donnée : poser, salir le parent sans le notifier, redemander la même
 * pose monde, stabiliser, saler encore et redemander, demander une autre pose, puis rendre le
 * parent singulier et observer le refus nommé.
 */
async function sequence(device, pagine, evenements) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = moteur(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  const camera = cameraFace(),
    pivot = s.source.getObjectByName('pivot'),
    etapes = [];
  const etape = async (nom) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push({ nom, tenue: metriques.frameHeld, rouge: redCount(pixels) });
    return pixels;
  };
  try {
    await backend.prepare();
    backend.setTransform('vitre', translation(-0.8));
    let reference;
    for (let i = 0; i < 6; i++) reference = await etape('initial-' + i);
    // L'hôte écrit le parent SANS passer par `setTransform` ni appeler `updateMatrixWorld` : sa
    // matrice monde reste périmée tant que rien ne la remonte.
    pivot.position.set(10, 3, -2);
    pivot.rotation.set(0.2, -0.3, 0.4);
    pivot.scale.set(2, 0.7, 1.5);
    backend.setTransform('vitre', translation(-0.8));
    const dirty = await etape('parent-dirty');
    let stable;
    for (let i = 0; i < 6; i++) stable = await etape('stable-' + i);
    pivot.position.x = -12;
    backend.setTransform('vitre', translation(-0.8));
    const repete = await etape('repeat-after-parent');
    backend.setTransform('vitre', translation(0.8));
    const deplace = await etape('moved');
    pivot.scale.y = 0;
    let singulier = null;
    try {
      backend.setTransform('vitre', translation(0));
    } catch (error) {
      singulier = error.code ?? String(error);
    }
    return {
      pagine,
      etapes,
      initialRouge: redCount(reference),
      dirtyPixels: difference(reference, dirty),
      stablePixels: difference(reference, stable),
      repeatPixels: difference(reference, repete),
      movedPixels: difference(reference, deplace),
      singulier,
    };
  } finally {
    libere(backend, canvas, s);
  }
}

export async function executer() {
  return executerPasses(sequence);
}
