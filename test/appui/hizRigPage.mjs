// Côté page de la preuve « rig d'hôte déplacé, bornes projetées refaites ».
//
// La scène ne bouge pas : c'est la VUE. La caméra est l'enfant d'un rig que l'hôte déplace, et
// l'hôte ne remonte rien — c'est le contrat de pose caméra du moteur qui doit résoudre la chaîne.
// Sans cette résolution, l'empreinte de vue de la tenue des rectangles d'écran ne verrait aucun
// changement et le test Hi-Z recevrait les rectangles de la vue précédente.
//
// Les rectangles d'écran ne sont plus tenus : la partition GPU les reprojette à chaque image, pour
// toutes les lignes résidentes, depuis les matrices que l'image lui envoie. Ce qui reste à prouver
// est donc exactement la résolution du rig — deux images par pose, celle qui suit le déplacement et
// celle qui ne bouge plus, chacune comparée octet pour octet à un moteur neuf placé d'emblée à la
// même pose monde. Des matrices d'une vue précédente feraient diverger l'une ou l'autre.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';
import {
  batisseur,
  cameraFace,
  carre,
  comptesEtape,
  image,
  libere,
  moteur,
} from './preuveSceneCommune.mjs';

/** Un mur opaque proche et une dalle opaque lointaine, décalée : la parallaxe de la vue fait sortir
 *  la dalle de derrière le mur, et le verdict d'occultation de ses clusters bascule. */
function sceneOccultante() {
  const bati = batisseur();
  const mur = new THREE.Mesh(
    carre(0.8),
    new THREE.MeshBasicMaterial({ color: 0xdedede, side: THREE.DoubleSide }),
  );
  mur.name = 'mur';
  mur.position.set(0, 0, 1);
  bati.source.add(mur);
  bati.ajoute(mur, 'exact-clusters', 0.8);
  const dalle = new THREE.Mesh(
    carre(0.25),
    new THREE.MeshBasicMaterial({ color: 0x20c040, side: THREE.DoubleSide }),
  );
  dalle.name = 'dalle';
  dalle.position.set(0.9, 0, -3);
  bati.source.add(dalle);
  bati.ajoute(dalle, 'exact-clusters', 0.25);
  return bati.fini();
}

/** Les poses du rig. La caméra, elle, ne change jamais de pose locale. */
const POSES = [0, 0.35, 0.7, 1.05, 1.4];

const differences = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

/** Les lignes que la partition de l'image a traitées : toutes les lignes dessinables, chaque image. */
const lignes = (backend) => comptesEtape(backend, 'partition')?.lignes ?? null;

/** Combien de pixels portent la couleur de la dalle lointaine : ce que l'occultation lui retire. */
function dallePixels(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 1] > 110 && pixels[i + 1] > pixels[i] + 40 && pixels[i + 1] > pixels[i + 2] + 40)
      n++;
  return n;
}

/** Une pose rendue par un moteur qui n'a jamais rien vu d'autre, caméra sans parent : le témoin. */
async function poseNeuve(device, x, onDiag) {
  const scene = sceneOccultante();
  const { backend, canvas } = moteur(webgpuPagesBackend, scene, device, onDiag);
  try {
    await backend.prepare();
    return (await image(backend, cameraFace(x))).pixels.slice();
  } finally {
    libere(backend, canvas, scene);
  }
}

export async function executer() {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const evenements = [],
    onDiag = (e) => evenements.push(e);
  const scene = sceneOccultante();
  const { backend, canvas } = moteur(webgpuPagesBackend, scene, device, onDiag, {
    stageProfile: true,
  });
  // La caméra n'a qu'une pose locale, posée une fois : le rig porte tout le déplacement.
  const camera = cameraFace(0),
    rig = new THREE.Group();
  rig.add(camera);
  const etapes = [];
  try {
    await backend.prepare();
    for (const x of POSES) {
      // L'hôte écrit le rig et RIEN d'autre : ni `updateMatrixWorld`, ni la caméra.
      rig.position.x = x;
      const bouge = await image(backend, camera);
      const lignesApresDeplacement = lignes(backend);
      // Contre-test : plus rien ne bouge. L'image doit rester celle du témoin, pas une image tenue.
      const immobile = await image(backend, camera);
      const temoin = await poseNeuve(device, x, onDiag);
      etapes.push({
        x,
        lignesApresDeplacement,
        lignesImmobile: lignes(backend),
        tenueImmobile: immobile.metriques.frameHeld,
        clusters: bouge.metriques.clusters,
        dalle: dallePixels(bouge.pixels),
        ecart: differences(bouge.pixels, temoin),
        ecartImmobile: differences(immobile.pixels, temoin),
      });
    }
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), etapes, evenements, erreurs };
  } finally {
    libere(backend, canvas, scene);
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, etapes, evenements, erreurs };
}
