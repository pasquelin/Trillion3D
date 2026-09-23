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
import type {
  BackendDiagnostic,
  RenderBackend,
} from '../../../packages/sdk-browser/backendTypes.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/webgpuPages.ts';
import { cameraFace, comptesEtape, libere, engine } from './preuveSceneCommune.ts';
import { image } from './preuveSceneImage.ts';
import { dallePixels, sceneOccultante, surSceneOccultante } from './sceneOccultante.ts';

/** Rig poses. The camera itself never changes local pose. */
const POSES = [0, 0.35, 0.7, 1.05, 1.4];

const differences = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

/** Rows the frame's partition processed: every drawable row, each frame. */
const lignes = (backend: RenderBackend) => comptesEtape(backend, 'partition')?.lignes ?? null;

/** A pose rendered by an engine that has never seen anything else, parentless camera: the witness. */
async function poseNeuve(device: GPUDevice, x: number, onDiag: (e: BackendDiagnostic) => void) {
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
  // The camera has only one local pose, set once: the rig carries the whole move.
  const camera = cameraFace(0),
    rig = new THREE.Group();
  rig.add(camera);
  return surSceneOccultante({ stageProfile: true }, async (backend, device, onDiag, etapes) => {
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
  });
}
