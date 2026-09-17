// Côté page de la preuve « convention de profondeur, moteur complet » : la même caméra physique
// (near 2,8, far 12), un carreau transparent incliné qui traverse le plan proche, et seule la
// convention de découpe déclarée par l'hôte change — `coordinateSystem`, comme le ferait un hôte
// qui bascule son renderer. Le moteur n'en lit plus rien : il compose sa propre projection, en
// profondeur inversée et plan lointain infini (`readCameraWorld`, `depthConvention.ts`). L'image
// doit rester identique au pixel près, et l'image tenue doit le RESTER — il n'y a plus rien à
// recalculer quand l'hôte change d'avis.
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

/**
 * La séquence pour une passe donnée : poser un carreau incliné sous la convention WebGL, la
 * stabiliser, passer en convention WebGPU, la stabiliser, revenir en WebGL, la stabiliser. La vue
 * physique — position, visée, near, far, champ — ne change jamais.
 */
async function sequence(device, pagine, evenements) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = moteur(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  const camera = cameraFace();
  camera.near = 2.8;
  camera.far = 12;
  camera.updateProjectionMatrix();
  const etapes = [];
  const etape = async (nom) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push({ nom, tenue: metriques.frameHeld });
    return pixels;
  };
  try {
    await backend.prepare();
    // Une inclinaison autour de Y sort les coins du carreau du plan z = 0 : à near = 2,8, l'un
    // d'eux passe devant le plan proche de la caméra plutôt que derrière.
    const incline = new Float32Array(new THREE.Matrix4().makeRotationY(0.9).elements);
    backend.setTransform('vitre', incline);
    let webgl;
    for (let i = 0; i < 6; i++) webgl = await etape('webgl-' + i);
    camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
    camera.updateProjectionMatrix();
    let webgpu;
    for (let i = 0; i < 6; i++) webgpu = await etape('webgpu-' + i);
    camera.coordinateSystem = THREE.WebGLCoordinateSystem;
    camera.updateProjectionMatrix();
    let retour;
    for (let i = 0; i < 6; i++) retour = await etape('retour-' + i);
    return {
      pagine,
      etapes,
      rougeWebgl: redCount(webgl),
      versWebgpu: difference(webgl, webgpu),
      versRetour: difference(webgl, retour),
    };
  } finally {
    libere(backend, canvas, s);
  }
}

export async function executer() {
  return executerPasses(sequence);
}
