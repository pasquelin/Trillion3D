// Oracles purs de A3 et A4, sans effet de bord : `occlusion.bench.mjs` les mesure, les tests
// unitaires les importent comme référence.
import * as THREE from 'three';
import { HIZ_BOUNDS_VALUES, projectBoxInto } from '../../hizCorners.ts';
import { hizOversized } from '../../hizCounts.ts';
import { hizRejects } from '../../hizOcclusion.ts';

const viewProjScratch = new THREE.Matrix4();
const boundsScratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** `hizProjection.ts:65-92` avant le lot A : un objet `HizBounds` alloué par boîte et par image. */
function referenceProjectBoxToScreen(min, max, world, cam, viewport) {
  cam.updateMatrixWorld();
  const viewProj = viewProjScratch.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
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

/** `hizSplit.ts:70-91` avant le lot A : `.map` d'objets, `.sort` par comparateur, deux `.filter`. */
export function referenceSplitOccluders(pages, cam, viewport) {
  const ranked = pages.map((page, index) => {
    const bounds = referenceProjectBoxToScreen(page.min, page.max, page.matrix, cam, viewport);
    return { page, index, nearest: bounds.nearestDepth, clipsNear: bounds.clipsNear };
  });
  ranked.sort((a, b) => a.nearest - b.nearest || a.index - b.index);
  const inFront = ranked.filter((item) => !item.clipsNear),
    crossing = ranked.filter((item) => item.clipsNear);
  if (!inFront.length) return { occluders: [], rest: pages };
  const mid = Math.max(1, Math.floor(inFront.length / 2));
  return {
    occluders: inFront.slice(0, mid).map((item) => item.page),
    rest: [...inFront.slice(mid), ...crossing].map((item) => item.page),
  };
}

/** `hizOcclusion.ts:152-178` avant le lot A : projection non cachée, allocation par page. */
export function referenceCountUnoccluded(pages, pyramid, cam, viewport, counts, bias = 0) {
  const kept = [];
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
