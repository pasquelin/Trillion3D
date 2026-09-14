import * as THREE from 'three';
import { collectClusterPages, selectVisiblePages } from './pageSelection.ts';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { evaluateDagSelectionKernel, packDagSelection } from './gpuDagSelection.ts';
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

export function kernelUrls(
  fixture: ReturnType<typeof dagFixture>,
  pixelError: number,
  cam: THREE.PerspectiveCamera,
  resident?: Uint32Array,
  field: 'pageIds' | 'drawablePageIds' = 'pageIds',
) {
  const { dag } = packed(fixture);
  const result = evaluateDagSelectionKernel(
    dag,
    cameraSelectionUniforms(cam, pixelError, VIEWPORT),
    resident,
  );
  return { result, urls: (result[field] ?? []).map((id) => dag.pageUrls[id]).sort() };
}

export function cpuUrls(
  fixture: ReturnType<typeof dagFixture>,
  pixelError: number,
  cam: THREE.PerspectiveCamera,
) {
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  return selectVisiblePages(roots, cam, { pixelError, viewport: VIEWPORT, frame: 1 })
    .shown.map((page) => page.url)
    .sort();
}
