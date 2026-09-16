import { createEngineCamera, readCameraWorld, type HostCamera } from './cameraWorld.ts';
import { collectClusterPages, selectVisiblePages } from './pageSelection.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from './gpuDagSelection.ts';
import { dagFixture } from './pageSelectionDagFixture.ts';

export const VIEWPORT: [number, number] = [1280, 720];
export function packed(fixture: ReturnType<typeof dagFixture>) {
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  return { roots, dag: packDagSelection(roots) };
}

const helperCam = createEngineCamera();

/**
 * Les uniformes du noyau ET le repère de rendu où ses matrices monde sont posées : les deux ne se
 * fabriquent jamais l'un sans l'autre, pas plus ici que dans le moteur, où l'entrée d'image rebase
 * les matrices sur l'œil avant de les porter à la carte. Un montage qui ne poserait que les
 * uniformes laisserait des matrices monde absolues sous une vue sans translation : deux repères
 * dans la même formule, et une coupe fausse sans rien qui le dise.
 */
export function kernelUniforms(
  dag: ReturnType<typeof packDagSelection>,
  roots: Parameters<typeof packDagSelection>[0],
  camera: HostCamera,
  pixelError: number,
  viewport: [number, number] = VIEWPORT,
) {
  const cam = readCameraWorld(helperCam, camera);
  packedWorldsToRenderOrigin(dag, roots, cam.eye);
  return cameraSelectionUniforms(cam, pixelError, viewport);
}

export function kernelUrls(
  fixture: ReturnType<typeof dagFixture>,
  pixelError: number,
  camera: HostCamera,
  resident?: Uint32Array,
  field: 'pageIds' | 'drawablePageIds' = 'pageIds',
) {
  const { dag, roots } = packed(fixture);
  const result = evaluateDagSelectionKernel(
    dag,
    kernelUniforms(dag, roots, camera, pixelError),
    resident,
  );
  return { result, urls: (result[field] ?? []).map((id) => dag.pageUrls[id]).sort() };
}

export function cpuUrls(
  fixture: ReturnType<typeof dagFixture>,
  pixelError: number,
  camera: HostCamera,
) {
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  return selectVisiblePages(roots, readCameraWorld(helperCam, camera), {
    pixelError,
    viewport: VIEWPORT,
  })
    .shown.map((page) => page.url)
    .sort();
}
