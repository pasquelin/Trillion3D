// Page of the transparent-transform proof: the real WebGPU engine (`webgpuPagesBackend`), a real
// device, a real reread image. No internal state is inspected — the public `setTransform` call on
// one side, pixels and public counters on the other.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { RenderBackend } from '../../../packages/sdk-browser/src/backend/types.ts';
import { libere, versApi } from '../kit/sharedSceneProof.ts';
import { couleurEn, estRouge, image } from '../kit/sceneImageProof.ts';
import { executerPasses } from '../kit/deviceProof.ts';
import { PIVOT, TILE, openPass, translation } from './transformScene.ts';

/** A sheared matrix: `y` pushes `x`. No translation-rotation-scale product yields it, and the
 *  leaning tile covers a corner a straight tile does not. */
const shear = (x: number, factor: number) =>
  versApi(new G.Matrix4().set(1, factor, 0, x, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));

/** The three probes, in world units: left, right, and the top-right corner only a sheared tile
 *  covers. */
const PROBES: [number, number][] = [
  [-0.8, 0],
  [0.8, 0],
  [0.5, 0.3],
];

/** A named reading: where the red sits, and what the counters say of the blend. */
function reading(
  name: string,
  camera: G.Camera,
  pixels: Uint8Array,
  metrics: ReturnType<RenderBackend['metrics']>,
) {
  return {
    name,
    red: PROBES.map(([x, y]) => estRouge(couleurEn(pixels, camera, x, y), 0)),
    draws: metrics.transparentDrawCalls,
    rejected: metrics.transparentFrustumRejected,
    held: metrics.frameHeld,
  };
}

/**
 * One pass: start, node move, parent move, shear, out of view, return, then settling and a move
 * after the held image.
 */
async function sequence(device: GPUDevice, paged: boolean, events: unknown[]) {
  const { s, backend, canvas, setTransform, camera } = openPass(device, paged, events);
  const steps: ReturnType<typeof reading>[] = [];
  const step = async (name: string) => {
    const { pixels, metriques } = await image(backend, camera);
    steps.push(reading(name, camera, pixels, metriques));
  };
  try {
    await backend.prepare();
    setTransform(TILE, translation(-0.8));
    await step('left');
    setTransform(TILE, translation(0.8));
    await step('right');
    // The node comes home; the PARENT carries the move.
    setTransform(TILE, translation(0));
    setTransform(PIVOT, translation(-0.8));
    await step('parent-left');
    setTransform(PIVOT, translation(0));
    setTransform(TILE, shear(0, 0.9));
    await step('sheared');
    setTransform(TILE, translation(60));
    await step('out-of-view');
    setTransform(TILE, translation(-0.8));
    await step('back');
    // Settling: two identical frames, then the held image. The move that follows must break it
    // and show the new place.
    for (let i = 0; i < 6; i++) await step(`settling-${i}`);
    setTransform(TILE, translation(0.8));
    await step('after-hold');
  } finally {
    libere(backend, canvas, s);
  }
  return steps;
}

/** The sequence, unpaged then paged. */
export const run = () => executerPasses(sequence);
