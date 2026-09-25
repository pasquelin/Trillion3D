import { createEngineCamera, readCameraWorld, type HostCamera } from '../../camera/world.ts';
import { collectClusterPages, selectVisiblePages } from '../../page/selection/selection.ts';
import { cameraSelectionUniforms } from '../core/selection.ts';
import {
  evaluateDagSelectionKernel,
  packDagSelection,
  packedWorldsToRenderOrigin,
} from './selection.ts';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { mockDagDevice } from './selection.fixture.ts';
import { ruleResidency } from './readiness.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

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
 * The kernel uniforms AND the render frame where its world matrices are set: the two are
 * never built one without the other, no more here than in the engine, where frame entry
 * rebases the matrices on the eye before carrying them to the GPU. A setup that only set
 * the uniforms would leave absolute world matrices under a view with no translation: two
 * frames in the same formula, and a wrong cut with nothing to say so.
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
    resident && ruleResidency(dag, resident),
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

/** The wide-camera DAG on a device whose readbacks wait for `release`: a snapshot held in flight. */
export function gatedDag() {
  installGpuGlobals();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = dagFixture();
  const { dag, roots } = packed(fixture);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0);
  const { device, destroyedMaps } = mockDagDevice(dag, { mapGate: gate });
  return { release, fixture, dag, uniforms, device, destroyedMaps };
}
