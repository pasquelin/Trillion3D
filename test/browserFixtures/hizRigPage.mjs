// Côté page de la preuve « rig d'hôte déplacé, bornes projetées refaites ».
//
// La scène ne bouge pas : c'est la VUE. La caméra est l'enfant d'un rig que l'hôte déplace, et
// l'hôte ne remonte rien — c'est le contrat de pose caméra du moteur qui doit résoudre la chaîne.
// Sans cette résolution, l'empreinte de vue de la tenue des rectangles d'écran ne verrait aucun
// changement et le test Hi-Z recevrait les rectangles de la vue précédente.
//
// Deux relevés par pose : combien de rectangles l'image a réécrits (`rectanglesProjetes`, compteur
// public de l'étape « partition »), et l'image elle-même, comparée à celle d'un moteur neuf placé
// d'emblée à la même pose monde.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { ouvrirAppareil } from '../../packages/sdk-browser/bench/justesse/appareilWebgpu.mjs';
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

const rectangles = (backend) => comptesEtape(backend, 'partition')?.rectanglesProjetes ?? null;

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
      const projetesApresDeplacement = rectangles(backend);
      // Contre-test : plus rien ne bouge. Le cache doit tenir, donc ne rien reprojeter.
      const immobile = await image(backend, camera);
      etapes.push({
        x,
        projetesApresDeplacement,
        projetesImmobile: rectangles(backend),
        tenueImmobile: immobile.metriques.frameHeld,
        clusters: bouge.metriques.clusters,
        dalle: dallePixels(bouge.pixels),
        ecart: differences(bouge.pixels, await poseNeuve(device, x, onDiag)),
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
