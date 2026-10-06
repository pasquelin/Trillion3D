// A moved host rig on the real engine: the scene does not move, the view does. The camera is the
// child of a rig the host moves and walks nothing up; the engine's camera-pose contract must
// resolve the chain. The GPU partition reprojects every resident row's screen rectangle each frame
// from the matrices the frame sends it, so what is left to prove is the rig resolution: two frames
// per pose — the one after the move and the one that no longer moves —, each compared byte for
// byte to a fresh engine placed at once at the same world pose.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type {
  BackendDiagnostic,
  RenderBackend,
} from '../../../packages/sdk-browser/src/backend/types.ts';
import { cameraFace, countsStep } from '../kit/sharedSceneProof.ts';
import { image } from '../kit/sceneImageProof.ts';
import { occluderEngine, onOccluderScene, slabPixels } from './occluderScene.ts';

/** Rig poses; the camera itself never changes its local pose. */
const POSES = [0, 0.35, 0.7, 1.05, 1.4];

/** Bytes that differ between two images. */
const differingBytes = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

/** Rows the frame's partition processed: every drawable row, each frame. */
const rows = (backend: RenderBackend) => countsStep(backend, 'partition')?.rows ?? null;

/** A pose rendered by an engine that never saw another, its camera parentless: the witness. */
async function freshPose(
  device: GPUDevice,
  x: number,
  onDiagnostic: (e: BackendDiagnostic) => void,
) {
  const { backend, release } = occluderEngine(device, onDiagnostic);
  try {
    await backend.prepare();
    return (await image(backend, cameraFace(x))).pixels.slice();
  } finally {
    release();
  }
}

/** One rig pose: the cut, the rows each frame processed, whether the still frame was held, the
 *  slab's pixels, and the bytes each frame differs from the witness on. */
interface RigStep {
  x: number;
  clusters: number | null | undefined;
  rowsMoved: number | null;
  rowsStill: number | null;
  stillHeld: boolean | null | undefined;
  slab: number;
  gapMoved: number;
  gapStill: number;
}

export function runRigCamera() {
  // The camera's one local pose, set once: the rig carries the whole move.
  const camera = cameraFace(0),
    rig = new G.Group();
  rig.add(camera);
  return onOccluderScene<RigStep>(
    { stageProfile: true },
    async (backend, device, onDiagnostic, steps) => {
      for (const x of POSES) {
        // The host writes the rig and nothing else: neither `updateMatrixWorld` nor the camera.
        rig.position.x = x;
        const moved = await image(backend, camera);
        const rowsMoved = rows(backend);
        // Nothing moves any more: the image must stay the witness's, drawn, not held.
        const still = await image(backend, camera);
        const witness = await freshPose(device, x, onDiagnostic);
        steps.push({
          x,
          clusters: moved.metrics.clusters,
          rowsMoved,
          rowsStill: rows(backend),
          stillHeld: still.metrics.frameHeld,
          slab: slabPixels(moved.pixels),
          gapMoved: differingBytes(moved.pixels, witness),
          gapStill: differingBytes(still.pixels, witness),
        });
      }
    },
  );
}
