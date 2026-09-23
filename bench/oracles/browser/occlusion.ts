// Pure oracles for A3 and A4, side-effect free: `occlusion.bench.ts` measures them, unit tests
// import them as reference.
import * as THREE from 'three';
import { perspectiveProjection } from '../../../packages/sdk-core/index.ts';
import { HIZ_BOUNDS_VALUES, projectBoxInto } from '../../../packages/sdk-browser/hizCorners.ts';
import { hizOversized, type HizCounts } from '../../../packages/sdk-browser/hizCounts.ts';
import { hizRejects } from '../../../packages/sdk-browser/hizOcclusion.ts';
import type { HizBounds, HizPage, HizPyramid } from '../../../packages/sdk-browser/hizTypes.ts';

const viewProjScratch = new THREE.Matrix4(),
  projScratch = new THREE.Matrix4();
const boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** `hizProjection.ts:65-92` before batch A: an `HizBounds` object allocated per box per frame. */
function referenceProjectBoxToScreen(
  min: readonly number[],
  max: readonly number[],
  world: HizPage['matrix'],
  cam: THREE.PerspectiveCamera,
  viewport: [number, number],
): HizBounds {
  cam.updateMatrixWorld();
  // Engine projection, not host: reversed depth, infinite far plane.
  perspectiveProjection(projScratch.elements, cam.fov, cam.aspect, cam.near, cam.zoom);
  const viewProj = viewProjScratch.multiplyMatrices(projScratch, cam.matrixWorldInverse);
  projectBoxInto(
    min,
    max,
    world,
    cam.matrixWorldInverse.elements,
    viewProj.elements,
    cam.near,
    viewport[0],
    viewport[1],
    boundsScratch,
    0,
  );
  const b = boundsScratch;
  if (b[5] !== 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, nearestDepth: 0, clipsNear: true };
  return { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3], nearestDepth: b[4], clipsNear: false };
}

/** `hizSplit.ts:70-91` before batch A: `.map` of objects, `.sort` by comparator, two `.filter`.
 *  Reversed depth: nearest carries GREATER depth, so order is descending. */
export function referenceSplitOccluders<T extends HizPage>(
  pages: T[],
  cam: THREE.PerspectiveCamera,
  viewport: [number, number],
) {
  const ranked = pages.map((page, index) => {
    const bounds = referenceProjectBoxToScreen(page.min, page.max, page.matrix, cam, viewport);
    return { page, index, nearest: bounds.nearestDepth, clipsNear: bounds.clipsNear };
  });
  ranked.sort((a, b) => b.nearest - a.nearest || a.index - b.index);
  const inFront = ranked.filter((item) => !item.clipsNear),
    crossing = ranked.filter((item) => item.clipsNear);
  if (!inFront.length) return { occluders: [], rest: pages };
  const mid = Math.max(1, Math.floor(inFront.length / 2));
  return {
    occluders: inFront.slice(0, mid).map((item) => item.page),
    rest: [...inFront.slice(mid), ...crossing].map((item) => item.page),
  };
}

/** `hizOcclusion.ts:152-178` before batch A: un-cached projection, allocation per page. */
export function referenceCountUnoccluded<T extends HizPage & { array?: ArrayLike<number> }>(
  pages: T[],
  pyramid: HizPyramid,
  cam: THREE.PerspectiveCamera,
  viewport: [number, number],
  counts: HizCounts,
  bias = 0,
) {
  const kept: T[] = [];
  for (const page of pages) {
    const bounds = referenceProjectBoxToScreen(page.min, page.max, page.matrix, cam, viewport);
    const triangles = page.array ? Math.floor(page.array.length / 3) : 0;
    counts.tested++;
    counts.testedTriangles += triangles;
    if (hizOversized(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, bounds.clipsNear)) {
      counts.oversized++;
      counts.oversizedTriangles += triangles;
    }
    if (hizRejects(pyramid, bounds, bias)) {
      counts.rejected++;
      counts.rejectedTriangles += triangles;
      continue;
    }
    kept.push(page);
  }
  return kept;
}
