import * as THREE from 'three';
import { HIZ_BACKGROUND, hizBuildPyramid } from '../sdk-core/index.ts';
import { createVisibilityFrame } from './visibilityFrame.ts';
import type { VisPage } from './visibilityBuffer.ts';
import type { HizPyramid } from './hizTypes.ts';

const viewProjScratch = new THREE.Matrix4();

function rowsOf(depth: Float32Array, width: number, height: number) {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width);
    for (let x = 0; x < width; x++) row[x] = depth[y * width + x];
    rows.push(row);
  }
  return rows;
}
/** Standard Hi-Z pyramid from visbuffer depth (background 1, max reduction). */
export function buildHizPyramid(depth: Float32Array, width: number, height: number): HizPyramid {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE');
  return { levels: hizBuildPyramid(rowsOf(depth, width, height)), width, height };
}

/** NDC z of the visbuffer winner. Background pixels stay 1. Les sommets d'un triangle ne sont
 *  projetés qu'une fois par image, jamais une fois par pixel : mêmes opérandes, moins souvent. */
export function visibilityDepth(
  ids: Uint32Array,
  pages: VisPage[],
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
) {
  const [width, height] = viewport,
    depth = new Float32Array(width * height);
  depth.fill(HIZ_BACKGROUND);
  camera.updateMatrixWorld();
  const viewProj = viewProjScratch.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const frame = createVisibilityFrame(pages, viewProj, width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const triangle = frame.triangle(ids[y * width + x]);
      if (!triangle) continue;
      const { a, b, c } = triangle;
      const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (area === 0) continue;
      const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area,
        w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area,
        w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a.z + w1 * b.z + w2 * c.z;
      if (!Number.isFinite(z)) continue;
      depth[y * width + x] = z;
    }
  return depth;
}
