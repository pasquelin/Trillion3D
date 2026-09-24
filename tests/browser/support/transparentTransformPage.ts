// Page side of the proof: the real WebGPU engine (`webgpuPagesBackend`), a real device, a real
// reread image. No internal state is inspected — the public `setTransform` call on one side,
// pixels and public counters on the other.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { RenderBackend } from '../../../packages/sdk-browser/src/backend/types.ts';
import { VIEWPORT, libere, versApi } from './sharedSceneProof.ts';
import { estRouge, image } from './sceneImageProof.ts';
import { executerPasses } from './deviceProof.ts';
import { ouvrePasse } from './transparentTransformScene.ts';
import { project } from '../probes/cameraRig.ts';

const point = new G.Vector3();

/** Colour read where world point `(x, y, z)` projects. Bottom-left origin, like `capture`. */
function couleurEn(pixels: Uint8Array, camera: G.GraphCamera, x: number, y: number, z = 0) {
  project(point.set(x, y, z), camera);
  const [w, h] = VIEWPORT;
  const px = Math.min(w - 1, Math.max(0, Math.round(((point.x + 1) / 2) * (w - 1)))),
    py = Math.min(h - 1, Math.max(0, Math.round(((point.y + 1) / 2) * (h - 1)))),
    i = (py * w + px) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

/** True when the read colour carries the tile's red and not the background blue. */
const rouge = (c: number[]) => estRouge(c, 0);

/** Pure translation on `x`. */
function translation(x: number) {
  return versApi(new G.Matrix4().makeTranslation(x, 0, 0));
}

/** A sheared matrix: `y` pushes `x`. No translation-rotation-scale decomposition yields it, and
 *  the leaning tile covers a corner a straight tile does not. */
function cisaillement(x: number, facteur: number) {
  const m = new G.Matrix4().set(1, facteur, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  return versApi(m);
}

/** A named reading: where the red sits, and what the counters say of the blend. */
function releve(
  name: string,
  backend: RenderBackend,
  camera: G.GraphCamera,
  pixels: Uint8Array,
  metriques: ReturnType<RenderBackend['metrics']>,
  sondes: [number, number][],
) {
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
async function sequence(device: GPUDevice, pagine: boolean, evenements: unknown[]) {
  const { s, backend, canvas, setTransform, camera } = ouvrePasse(device, pagine, evenements);
  const etapes: ReturnType<typeof releve>[] = [];
  // Three probes: left, right, and the top-right corner only a sheared tile covers.
  const sondes: [number, number][] = [
    [-0.8, 0],
    [0.8, 0],
    [0.5, 0.3],
  ];
  const etape = async (name: string) => {
    const { pixels, metriques } = await image(backend, camera);
    etapes.push(releve(name, backend, camera, pixels, metriques, sondes));
  };
  try {
    await backend.prepare();
    setTransform('vitre', translation(-0.8));
    await etape('gauche');
    setTransform('vitre', translation(0.8));
    await etape('droite');
    // The node comes home; it is the PARENT that carries the move.
    setTransform('vitre', translation(0));
    setTransform('pivot', translation(-0.8));
    await etape('parent-gauche');
    setTransform('pivot', translation(0));
    setTransform('vitre', cisaillement(0, 0.9));
    await etape('cisaille');
    setTransform('vitre', translation(60));
    await etape('hors-champ');
    setTransform('vitre', translation(-0.8));
    await etape('retour');
    // Stabilisation: two identical frames, then the held image. The move that follows must
    // break it and show the new location.
    for (let i = 0; i < 6; i++) await etape('stabilisation-' + i);
    setTransform('vitre', translation(0.8));
    await etape('apres-tenue');
  } finally {
    libere(backend, canvas, s);
  }
  return etapes;
}

export async function executer() {
  return executerPasses(sequence);
}
