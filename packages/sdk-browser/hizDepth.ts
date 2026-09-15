import * as THREE from 'three';
import { HIZ_BACKGROUND, hizBuildFlat } from '../sdk-core/index.ts';
import { createVisibilityFrame } from './visibilityFrame.ts';
import { barycentricAt, signedArea } from './visibilityProjection.ts';
import type { VisPage } from './visibilityBuffer.ts';
import type { HizPyramid } from './hizTypes.ts';

const viewProjScratch = new THREE.Matrix4();

/**
 * Standard Hi-Z pyramid from visbuffer depth (background 1, max reduction). La pyramide est plate :
 * un seul tampon pour tous les niveaux. `into` la reprend d'une image sur l'autre — même taille,
 * mêmes décalages, aucune ligne réallouée ; sinon une pyramide neuve est posée.
 */
export function buildHizPyramid(
  depth: Float32Array,
  width: number,
  height: number,
  into?: HizPyramid,
): HizPyramid {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE');
  return hizBuildFlat(depth, width, height, into);
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
  camera.updateWorldMatrix(true, false);
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
      const area = signedArea(a, b, c);
      if (area === 0) continue;
      const { w0, w1, w2 } = barycentricAt(a, b, c, x, y, area);
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * a.z + w1 * b.z + w2 * c.z;
      if (!Number.isFinite(z)) continue;
      depth[y * width + x] = z;
    }
  return depth;
}
