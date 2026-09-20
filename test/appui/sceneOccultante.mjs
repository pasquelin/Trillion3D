// The occluding scene the Hi-Z proofs share: a near opaque wall and a far opaque slab, offset,
// so that view parallax takes the slab out from behind the wall and the occlusion verdict of
// its clusters flips with the camera.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';
import { batisseur, carre, engine, libere } from './preuveSceneCommune.mjs';

export function sceneOccultante() {
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

/** How many pixels carry the far slab's colour: what occlusion takes from it. */
export function dallePixels(pixels) {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 1] > 110 && pixels[i + 1] > pixels[i] + 40 && pixels[i + 1] > pixels[i + 2] + 40)
      n++;
  return n;
}

/**
 * Runs `corps(backend, device, onDiag, etapes)` on the real engine mounted on this scene, with
 * `options` completing the host context. What every proof of this scene shares: the device, the
 * diagnostic events, the release of the engine, and the shape of the answer — the steps the body
 * filled, or the error that stopped it.
 */
export async function surSceneOccultante(options, corps) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const evenements = [],
    onDiag = (e) => evenements.push(e);
  const scene = sceneOccultante();
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, onDiag, options);
  const etapes = [];
  try {
    await backend.prepare();
    await corps(backend, device, onDiag, etapes);
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), etapes, evenements, erreurs };
  } finally {
    libere(backend, canvas, scene);
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, etapes, evenements, erreurs };
}
