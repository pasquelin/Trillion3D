// The occluding scene the Hi-Z proofs share: a near opaque wall and a far opaque slab, offset,
// so that view parallax takes the slab out from behind the wall and the occlusion verdict of
// its clusters flips with the camera.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import { ouvrirAppareil } from '../probes/webgpuDevice.ts';
import type {
  BackendContext,
  BackendDiagnostic,
  RenderBackend,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import { batisseur, carre, engine, libere, type ScenePreparee } from './sharedSceneProof.ts';

export function sceneOccultante(): ScenePreparee {
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
export function dallePixels(pixels: Uint8Array | number[]): number {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 1] > 110 && pixels[i + 1] > pixels[i] + 40 && pixels[i + 1] > pixels[i + 2] + 40)
      n++;
  return n;
}

/** Result of `surSceneOccultante`: no adapter, a failure mid-run, or the steps `corps` filled. */
interface ResultatOccultante {
  indisponible?: string;
  erreur?: string;
  adaptateur?: string;
  etapes?: unknown[];
  evenements?: BackendDiagnostic[];
  erreurs?: string[];
}

/**
 * Runs `corps(backend, device, onDiag, etapes)` on the real engine mounted on this scene, with
 * `options` completing the host context. What every proof of this scene shares: the device, the
 * diagnostic events, the release of the engine, and the shape of the answer — the steps the body
 * filled, or the error that stopped it.
 */
export async function surSceneOccultante(
  options: Partial<BackendContext>,
  corps: (
    backend: RenderBackend,
    device: GPUDevice,
    onDiag: (e: BackendDiagnostic) => void,
    etapes: unknown[],
  ) => Promise<void>,
): Promise<ResultatOccultante> {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const evenements: BackendDiagnostic[] = [],
    onDiag = (e: BackendDiagnostic) => evenements.push(e);
  const scene = sceneOccultante();
  const { backend, canvas } = engine(webgpuPagesBackend, scene, device, onDiag, options);
  const etapes: unknown[] = [];
  try {
    await backend.prepare();
    await corps(backend, device, onDiag, etapes);
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : '';
    return { erreur: String(error) + trace, etapes, evenements, erreurs };
  } finally {
    libere(backend, canvas, scene);
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, etapes, evenements, erreurs };
}
