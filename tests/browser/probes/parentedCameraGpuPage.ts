// Page side of the GPU reproduction: the engine's real WebGPU selection (`createGpuDagSelection`,
// its buffers, kernel and readout), fed by the real `cameraSelectionUniforms`.
// Bundled by esbuild then run in Chromium: nothing is replayed off the GPU.
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import {
  createGpuDagSelection,
  packDagSelection,
} from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { collectClusterPages } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { dagFixture } from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts';
import { POSES_PARENT, cameraAplatie, creeRig, poseRig } from './cameraRig.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import type { HostCamera } from '../../../packages/sdk-browser/src/camera/world.ts';

const VIEWPORT: [number, number] = [1280, 720];

/** A fresh GPU selection per sequence: no reading from one sequence serves the other. */
async function sequence(
  device: GPUDevice,
  cameras: () => Generator<HostCamera>,
  pixelError: number,
): Promise<Array<{ pages: string[]; frustumRejected: number }>> {
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
  const images: Array<{ pages: string[]; frustumRejected: number }> = [];
  for (const camera of cameras()) {
    selection.dispatch(cameraSelectionUniforms(cameraMoteur(camera), pixelError, VIEWPORT));
    const result = await selection.flush();
    if (!result) throw new Error('GPU_SELECTION_FAILED');
    images.push({
      pages: result.pageIds.map((id) => packed.pageUrls[id]).sort(),
      frustumRejected: result.frustumRejected,
    });
  }
  selection.dispose();
  return images;
}

/** One flat, all-optional shape for both outcomes: no adapter, or a completed run. */
export interface ExecuterResultat {
  indisponible?: string;
  adaptateur?: string;
  cas?: Array<{
    pixelError: number;
    avecParent: Array<{ pages: string[]; frustumRejected: number }>;
    sansParent: Array<{ pages: string[]; frustumRejected: number }>;
  }>;
  erreurs?: string[];
}

export async function executer(pixelErrors: number[]): Promise<ExecuterResultat> {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const cas: NonNullable<ExecuterResultat['cas']> = [];
  for (const pixelError of pixelErrors) {
    const rig = creeRig();
    const avecParent = await sequence(
      device,
      function* () {
        for (const pose of POSES_PARENT) yield poseRig(rig, pose, false);
      },
      pixelError,
    );
    const sansParent = await sequence(
      device,
      function* () {
        for (const pose of POSES_PARENT) yield cameraAplatie(pose);
      },
      pixelError,
    );
    cas.push({ pixelError, avecParent, sansParent });
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, cas, erreurs };
}
