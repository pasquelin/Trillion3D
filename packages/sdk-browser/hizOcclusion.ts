import * as THREE from 'three';
import { hizFootprintFar, hizOccluded } from '../sdk-core/index.ts';
import { projectBoxToScreen } from './hizProjection.ts';
import type { HizBounds, HizPage, HizPyramid } from './hizTypes.ts';

function footprintLevel(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  clipsNear: boolean,
  width: number,
  height: number,
  levels: number,
): number | undefined {
  if (
    clipsNear ||
    !Number.isInteger(minX) ||
    !Number.isInteger(minY) ||
    !Number.isInteger(maxX) ||
    !Number.isInteger(maxY) ||
    minX < 0 ||
    minY < 0 ||
    maxX >= width ||
    maxY >= height ||
    maxX < minX ||
    maxY < minY
  )
    return undefined;
  for (let level = 0; level < levels; level++) {
    const scale = 2 ** level;
    if (
      Math.floor(maxX / scale) - Math.floor(minX / scale) < 16 &&
      Math.floor(maxY / scale) - Math.floor(minY / scale) < 16
    )
      return level;
  }
  return undefined;
}

/** Pick the first mip whose outward-rounded inclusive footprint fits the test kernel. */
function hizFootprintLevel(
  bounds: HizBounds,
  width: number,
  height: number,
  levels: number,
): number | undefined {
  return footprintLevel(
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
    bounds.clipsNear,
    width,
    height,
    levels,
  );
}

/** `hizFootprintLevel` over the flat bounds layout `projectBoxesFlat` writes. */
export function hizFootprintLevelFlat(
  bounds: Float64Array,
  base: number,
  width: number,
  height: number,
  levels: number,
): number | undefined {
  return footprintLevel(
    bounds[base],
    bounds[base + 1],
    bounds[base + 2],
    bounds[base + 3],
    bounds[base + 5] !== 0,
    width,
    height,
    levels,
  );
}

export function hizRejects(pyramid: HizPyramid, bounds: HizBounds, bias = 0) {
  const level = hizFootprintLevel(bounds, pyramid.width, pyramid.height, pyramid.levels.length);
  if (level === undefined) return false;
  const far = hizFootprintFar(
    pyramid.levels,
    bounds.minX,
    bounds.minY,
    bounds.maxX + 1,
    bounds.maxY + 1,
    level,
  );
  return hizOccluded(bounds.nearestDepth, far, bias);
}

export function filterUnoccluded<T extends HizPage>(
  pages: T[],
  pyramid: HizPyramid,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  bias = 0,
) {
  return pages.filter(
    (page) =>
      !hizRejects(
        pyramid,
        projectBoxToScreen(page.min, page.max, page.matrix, camera, viewport),
        bias,
      ),
  );
}
