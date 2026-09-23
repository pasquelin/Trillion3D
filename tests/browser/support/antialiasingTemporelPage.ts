// Page side of the "temporal antialiasing" proof: the real WebGPU engine on a scene of two
// opaque tiles — a full-frame blue background and a rotated red tile, whose edges are oblique —
// rendered with and without temporal accumulation: at rest, under a camera pan, then after a
// move of the tile.
// Nothing internal is read: `setTransform` on one side, reread pixels and `frameHeld` on the other.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/webgpuPages.ts';
import type { BackendDiagnostic } from '../../../packages/sdk-browser/backendTypes.ts';
import {
  VIEWPORT,
  batisseur,
  carre,
  cameraFace,
  libere,
  engine,
  versApi,
} from './preuveSceneCommune.ts';
import { image, jusquaTenue } from './preuveSceneImage.ts';
import { executerAccumulation } from './preuveAppareil.ts';

/** The background and the red tile, the latter rotated by a third of a radian: its edges are oblique. */
function scene() {
  const bati = batisseur();
  const fond = new THREE.Mesh(carre(4), new THREE.MeshBasicMaterial({ color: 0x1b3a5c }));
  fond.name = 'fond';
  fond.position.z = -2;
  bati.source.add(fond);
  bati.ajoute(fond, 'exact-clusters', 4);
  const rouge = new THREE.Mesh(carre(0.6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  rouge.name = 'carre';
  rouge.rotation.z = 0.33;
  bati.source.add(rouge);
  bati.ajoute(rouge, 'exact-clusters', 0.6);
  return bati.fini();
}

/** The tile's move: the same rotation, pushed 0.5 on `x`. */
const deplace = () => versApi(new THREE.Matrix4().makeRotationZ(0.33).setPosition(0.5, 0, 0));

/** A full run: at rest, then after a move. `temporel` picks the option. */
async function executionComplete(device: GPUDevice, evenements: unknown[], temporel: boolean) {
  const s = scene(),
    propres: BackendDiagnostic[] = [];
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    s,
    device,
    (e) => {
      propres.push(e);
      evenements.push(e);
    },
    { temporalAntialiasing: temporel },
  );
  const camera = cameraFace();
  try {
    await backend.prepare();
    const arret = await jusquaTenue(backend, camera);
    // Pan: the camera slides about two thirds of a pixel per frame, for sixteen frames.
    // Nothing is held; the last rendered image is the one we reread.
    let panoramique: number[] | undefined;
    for (let i = 1; i <= 16; i++) {
      const glissee = cameraFace(0.02 * i);
      panoramique = Array.from((await image(backend, glissee)).pixels);
    }
    if (!backend.setTransform) throw new Error('backend missing setTransform');
    backend.setTransform('carre', deplace());
    const deplacement = await jusquaTenue(backend, camera);
    const capacites = propres.find((e) => e.phase === 'render-capabilities')?.context ?? null;
    return { arret, panoramique, deplacement, capacites };
  } finally {
    libere(backend, canvas, s);
  }
}

/** Without, with, and with again as the A/A witness; the viewport, for the proof's counts. */
export async function executer() {
  const resultat = await executerAccumulation(executionComplete);
  return { viewport: VIEWPORT, ...resultat };
}
