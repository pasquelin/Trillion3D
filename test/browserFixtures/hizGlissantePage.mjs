// Côté page de la preuve « bornes projetées à caméra mobile ».
//
// Les bornes envoyées au test Hi-Z sont des rectangles d'ÉCRAN : elles dépendent de la caméra, pas
// seulement des pages. Une caméra qui glisse sans changer ni la coupe ni la partition d'occultation
// doit donc les réécrire. La preuve est un témoin : chaque pose atteinte en glissant est comparée à
// la même pose rendue par un moteur NEUF, qui n'a aucun rectangle à tenir. Un rectangle tenu d'une
// pose précédente rejetterait un cluster que le moteur neuf dessine, et les images différeraient.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { ouvrirAppareil } from '../../packages/sdk-browser/bench/justesse/appareilWebgpu.mjs';
import { batisseur, cameraFace, carre, image, libere, moteur } from './preuveSceneCommune.mjs';

/** Un mur opaque proche et une dalle opaque lointaine, décalée : par parallaxe, la dalle sort de
 *  derrière le mur au fil de la glissade, et le verdict d'occultation de ses clusters bascule. */
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

/** Les poses de la glissade : la caméra translate, la scène ne bouge pas. */
const GLISSADE = [0, 0.35, 0.7, 1.05, 1.4];

const differences = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

/** Combien de pixels portent la couleur de la dalle lointaine : ce que l'occultation lui retire. */
function dallePixels(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 1] > 110 && pixels[i + 1] > pixels[i] + 40 && pixels[i + 1] > pixels[i + 2] + 40)
      n++;
  return n;
}

/** Une pose rendue par un moteur qui n'a jamais rien vu d'autre : le témoin. */
async function poseNeuve(device, x, onDiag) {
  const scene = sceneOccultante();
  const { backend, canvas } = moteur(webgpuPagesBackend, scene, device, onDiag);
  try {
    await backend.prepare();
    const { pixels, metriques } = await image(backend, cameraFace(x));
    return { pixels: pixels.slice(), clusters: metriques.clusters };
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
  const glissee = sceneOccultante();
  const a = moteur(webgpuPagesBackend, glissee, device, onDiag);
  const etapes = [];
  try {
    await a.backend.prepare();
    for (const x of GLISSADE) {
      const { pixels, metriques } = await image(a.backend, cameraFace(x));
      const temoin = await poseNeuve(device, x, onDiag);
      etapes.push({
        x,
        clusters: metriques.clusters,
        clustersTemoin: temoin.clusters,
        testes: metriques.hizTestedClusters,
        dalle: dallePixels(pixels),
        dalleTemoin: dallePixels(temoin.pixels),
        ecart: differences(pixels, temoin.pixels),
      });
    }
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), etapes, evenements, erreurs };
  } finally {
    libere(a.backend, a.canvas, glissee);
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, etapes, evenements, erreurs };
}
