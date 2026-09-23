// The tiled scene the "compute raster is watertight" proof shares: tiles tilted at angles that
// do not repeat, a face-on tile whose diagonal falls exactly on pixel centres, a huge tile whose
// vertices round far outside the image, and a tile that crosses the near plane.
import * as THREE from 'three';
import { VIEWPORT, batisseur, carre, type ScenePreparee } from './sharedSceneProof.ts';

/** Pixels of one world unit at this distance from the face-on camera, 55° vertical aperture. */
export const pixelsParUnite = (distance: number): number =>
  VIEWPORT[1] / 2 / Math.tan((55 / 2) * (Math.PI / 180)) / distance;

/** Tiles tilted at angles that do not repeat, plus one that crosses the near plane. */
export function sceneCarreaux(): ScenePreparee {
  const bati = batisseur();
  const material = new THREE.MeshBasicMaterial({ color: 0x20c040, side: THREE.DoubleSide });
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Mesh(carre(0.45), material);
    mesh.name = `carreau-${i}`;
    mesh.position.set(((i % 4) - 1.5) * 0.7, (Math.floor(i / 4) - 1) * 0.7, -0.2 * (i % 3));
    mesh.rotation.set(0.3 * i, 0.17 * i, 0.61 * i);
    bati.source.add(mesh);
    bati.ajoute(mesh, 'exact-clusters', 0.45);
  }
  // A face-on tile, unrotated, whose corners fall on pixel corners: its 45° diagonal
  // passes through the CENTRE of each pixel it crosses. A pixel exactly on a shared
  // edge is the one two inclusive rules can leave to nobody: the dotted crack.
  const face = new THREE.Mesh(carre(24 / pixelsParUnite(3)), material);
  face.name = 'face';
  face.position.set(0, 0, 0);
  bati.source.add(face);
  bati.ajoute(face, 'exact-clusters', 0.8);
  // A huge tile behind the others, whose vertices fall thousands of pixels outside the
  // image and whose diagonal crosses it: that is where derived weights round enough
  // to open a crack between its two triangles.
  const immense = new THREE.Mesh(carre(60), material);
  immense.name = 'immense';
  immense.position.set(1.3, -0.8, -1.5);
  immense.rotation.set(0.05, 0.02, 0.35);
  bati.source.add(immense);
  bati.ajoute(immense, 'exact-clusters', 60);
  // A large tile whose one corner goes behind the eye: the camera is at z = 3, the near
  // plane at z = 2.9; tilted 60°, it crosses that plane in the middle of the image.
  const proche = new THREE.Mesh(carre(3), material);
  proche.name = 'proche';
  proche.position.set(0, -2.2, 2.95);
  proche.rotation.set(0, Math.PI / 3, 0);
  bati.source.add(proche);
  bati.ajoute(proche, 'exact-clusters', 3);
  return bati.fini();
}
