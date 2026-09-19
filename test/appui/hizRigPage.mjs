// Page side of the proof "moved host rig, projected bounds remade".
//
// The scene does not move: it is the VIEW. The camera is the child of a rig the host moves, and
// the host walks nothing up — it is the engine's camera-pose contract that must resolve the
// chain. Without that resolution, the view fingerprint of held screen rectangles would see no
// change and the Hi-Z test would receive the previous view's rectangles.
//
// Screen rectangles are no longer held: the GPU partition reprojects them every frame, for every
// resident row, from the matrices the frame sends it. What remains to prove is therefore exactly
// the rig resolution — two frames per pose, the one that follows the move and the one that no
// longer moves, each compared byte for byte to a fresh engine placed at once at the same world
// pose. Matrices from a previous view would make one or the other diverge.
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
  engine,
} from './preuveSceneCommune.mjs';

/** A near opaque wall and a far opaque slab, offset: view parallax takes the slab out from
 *  behind the wall, and the occlusion verdict of its clusters flips. */
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

/** Rig poses. The camera itself never changes local pose. */
const POSES = [0, 0.35, 0.7, 1.05, 1.4];

const differences = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

/** Rows the frame's partition processed: every drawable row, each frame. */
const lignes = (backend) => comptesEtape(backend, 'partition')?.lignes ?? null;

/** How many pixels carry the far slab's colour: what occlusion takes from it. */
function dallePixels(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 1] > 110 && pixels[i + 1] > pixels[i] + 40 && pixels[i + 1] > pixels[i + 2] + 40)
      n++;
  return n;
}

/** A pose rendered by an engine that has never seen anything else, parentless camera: the witness. */
async function poseNeuve(device, x, onDiag) {
  const scene = sceneOccultante();
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, onDiag);
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
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, onDiag, {
    stageProfile: true,
  });
  // The camera has only one local pose, set once: the rig carries the whole move.
  const camera = cameraFace(0),
    rig = new THREE.Group();
  rig.add(camera);
  const etapes = [];
  try {
    await backend.prepare();
    for (const x of POSES) {
      // The host writes the rig and NOTHING else: neither `updateMatrixWorld` nor the camera.
      rig.position.x = x;
      const bouge = await image(backend, camera);
      const lignesApresDeplacement = lignes(backend);
      // Counter-test: nothing moves any more. The image must stay the witness's, not a held image.
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
