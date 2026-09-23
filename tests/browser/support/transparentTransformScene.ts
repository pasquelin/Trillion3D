// Scene of the proof "a transparent follows `setTransform`": a full-frame opaque background, and a
// transparent tile named `vitre` under a `pivot` node. The engine distinguishes it only by the
// declared pass and by its material.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import { batisseur, cameraFace, carre, engine, type ScenePreparee } from './sharedSceneProof.ts';

/** Half-width of the transparent tile: the sampling window depends on it, not the reverse. */
export const DEMI = 0.35;

/**
 * `pagine` chooses the tile's pass — `clustered-blend` sends it through the DAG pages,
 * `shared-blend` through the unpaged path.
 */
export function sceneTransparente(pagine: boolean): ScenePreparee {
  const bati = batisseur();
  const fond = new THREE.Mesh(
    carre(4),
    new THREE.MeshBasicMaterial({ color: 0x1b3a5c, side: THREE.DoubleSide }),
  );
  fond.name = 'fond';
  fond.position.z = -2;
  bati.source.add(fond);
  bati.ajoute(fond, 'exact-clusters', 4);
  const vitre = new THREE.Mesh(
    carre(DEMI),
    new THREE.MeshBasicMaterial({
      color: 0xff2020,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  vitre.name = 'vitre';
  const pivot = new THREE.Group();
  pivot.name = 'pivot';
  pivot.add(vitre);
  bati.source.add(pivot);
  bati.ajoute(vitre, pagine ? 'clustered-blend' : 'shared-blend', DEMI);
  return bati.fini();
}

/** One pass of the transparent-tile proofs: the scene, its pages engine on `device` reporting into
 *  `evenements`, the `setTransform` both proofs drive, and the camera facing the tile. */
export function ouvrePasse(device: GPUDevice, pagine: boolean, evenements: unknown[]) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  if (!backend.setTransform) throw new Error('backend missing setTransform');
  return { s, backend, canvas, setTransform: backend.setTransform, camera: cameraFace() };
}
