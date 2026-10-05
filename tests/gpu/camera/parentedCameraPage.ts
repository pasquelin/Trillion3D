// Page of the parented-camera proof: the engine's real WebGPU selection (`createGpuDagSelection`,
// its buffers, kernel and readout), fed by the real `cameraSelectionUniforms`, frame after frame,
// for the child camera of a host parent that is moved then rotated, then for the parentless
// camera of the same world pose. Nothing is replayed off the GPU.
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import {
  createGpuDagSelection,
  packDagSelection,
} from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { collectClusterPages } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { dagFixture } from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import type { HostCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import { POSES_PARENT, flattenedCamera, creeRig, poseRig } from '../kit/cameraRig.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';

const VIEWPORT: [number, number] = [1280, 720];

/** What the selection kept of one frame: its pages by URL, and how many the frustum rejected. */
export type FrameSelection = { pages: string[]; frustumRejected: number };

/** A fresh GPU selection per sequence: no reading of one sequence serves the other. */
async function sequence(
  device: GPUDevice,
  cameras: (pose: (typeof POSES_PARENT)[number]) => HostCamera,
  pixelError: number,
): Promise<FrameSelection[]> {
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const packed = packDagSelection(roots);
  const selection = await createGpuDagSelection(device, packed);
  if (!selection) throw new Error('GPU_SELECTION_UNAVAILABLE');
  const frames: FrameSelection[] = [];
  for (const pose of POSES_PARENT) {
    selection.dispatch(cameraSelectionUniforms(cameraMoteur(cameras(pose)), pixelError, VIEWPORT));
    const result = await selection.flush();
    if (!result) throw new Error('GPU_SELECTION_FAILED');
    frames.push({
      pages: result.pageIds.map((id) => packed.pageUrlOf(id)!).sort(),
      frustumRejected: result.frustumRejected,
    });
  }
  selection.dispose();
  return frames;
}

/** At each pixel error, the selections of the parented rig and of its flattened twin, frame by
 *  frame, and the errors the device raised. */
export async function run(pixelErrors: number[]) {
  const gpu = await openGpuDevice();
  if (!gpu) throw new Error('no WebGPU adapter');
  const cases = [];
  for (const pixelError of pixelErrors) {
    const rig = creeRig();
    const parented = await sequence(gpu.device, (pose) => poseRig(rig, pose, false), pixelError);
    // One flattened camera for the whole sequence, as the rig is one camera.
    const flat = flattenedCamera(POSES_PARENT[0]);
    const flattened = await sequence(
      gpu.device,
      (pose) => flattenedCamera(pose, 55, 16 / 9, flat),
      pixelError,
    );
    cases.push({ pixelError, parented, flattened });
  }
  const adapter = (await gpu.fermer()).court;
  return { adapter, cases, errors: gpu.errors };
}
