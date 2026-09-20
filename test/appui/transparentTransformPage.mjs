// Page side of the proof: the real WebGPU engine (`webgpuPagesBackend`), a real device, a real
// reread image. No internal state is inspected — the public `setTransform` call on one side,
// pixels and public counters on the other.
import * as THREE from 'three';
import { webgpuPagesBackend } from '../../packages/sdk-browser/webgpuPages.ts';
import {
  VIEWPORT,
  cameraFace,
  estRouge,
  image,
  libere,
  engine,
  versApi,
} from './preuveSceneCommune.mjs';
import { executerPasses } from './preuveAppareil.mjs';
import { sceneTransparente } from './transparentTransformScene.mjs';

const point = new THREE.Vector3();

/** Colour read where world point `(x, y, z)` projects. Bottom-left origin, like `capture`. */
function couleurEn(pixels, camera, x, y, z = 0) {
  point.set(x, y, z).project(camera);
  const [w, h] = VIEWPORT;
  const px = Math.min(w - 1, Math.max(0, Math.round(((point.x + 1) / 2) * (w - 1)))),
    py = Math.min(h - 1, Math.max(0, Math.round(((point.y + 1) / 2) * (h - 1)))),
    i = (py * w + px) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/** True when the read colour carries the tile's red and not the background blue. */
const rouge = (c) => estRouge(c, 0);

/** Pure translation on `x`. */
function translation(x) {
  return versApi(new THREE.Matrix4().makeTranslation(x, 0, 0));
}

/** A sheared matrix: `y` pushes `x`. No translation-rotation-scale decomposition yields it, and
 *  the leaning tile covers a corner a straight tile does not. */
function cisaillement(x, facteur) {
  const m = new THREE.Matrix4().set(1, facteur, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  return versApi(m);
}

/** A named reading: where the red sits, and what the counters say of the blend. */
function releve(name, backend, camera, pixels, metriques, sondes) {
  return {
    name,
    rouge: sondes.map(([x, y]) => rouge(couleurEn(pixels, camera, x, y))),
    dessins: metriques.transparentDrawCalls,
    rejetes: metriques.transparentFrustumRejected,
    tenue: metriques.frameHeld,
    items: metriques.transparentMeshes,
  };
}

/**
 * Proof sequence for a given pass: start, node move, parent move, shear, out of view, return,
 * then stabilisation and a move after hold.
 */
async function sequence(device, pagine, evenements) {
  const s = sceneTransparente(pagine);
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) =>
    evenements.push({ pagine, ...e }),
  );
  const camera = cameraFace(),
    etapes = [];
  // Three probes: left, right, and the top-right corner only a sheared tile covers.
  const sondes = [
    [-0.8, 0],
    [0.8, 0],
    [0.5, 0.3],
  ];
  const etape = async (name) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push(releve(name, backend, camera, pixels, metriques, sondes));
  };
  try {
    await backend.prepare();
    backend.setTransform('vitre', translation(-0.8));
    await etape('gauche');
    backend.setTransform('vitre', translation(0.8));
    await etape('droite');
    // The node comes home; it is the PARENT that carries the move.
    backend.setTransform('vitre', translation(0));
    backend.setTransform('pivot', translation(-0.8));
    await etape('parent-gauche');
    backend.setTransform('pivot', translation(0));
    backend.setTransform('vitre', cisaillement(0, 0.9));
    await etape('cisaille');
    backend.setTransform('vitre', translation(60));
    await etape('hors-champ');
    backend.setTransform('vitre', translation(-0.8));
    await etape('retour');
    // Stabilisation: two identical frames, then the held image. The move that follows must
    // break it and show the new location.
    for (let i = 0; i < 6; i++) await etape('stabilisation-' + i);
    backend.setTransform('vitre', translation(0.8));
    await etape('apres-tenue');
  } finally {
    libere(backend, canvas, s);
  }
  return etapes;
}

export async function executer() {
  return executerPasses(sequence);
}
