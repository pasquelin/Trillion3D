// Pure A1 and A5 oracles, no side effects: `hiz.bench.ts` measures them; unit tests import
// them as reference. Importing this module runs neither a bench nor a file write.
import * as THREE from 'three';
import { perspectiveProjection } from '../../../packages/sdk-core/index.ts';
import { DEPTH_CLEAR } from '../../../packages/sdk-browser/depthConvention.ts';
import { HIZ_KERNEL_TEXELS } from '../../../packages/sdk-browser/hizCounts.ts';
import { projectVisibilityVertex } from '../../../packages/sdk-browser/visibilityProjection.ts';
import { unpackVisibilityId } from '../../../packages/sdk-browser/visibilityTypes.ts';
import type { VisPage } from '../../../packages/sdk-browser/visibilityBuffer.ts';

const viewProjScratch = new THREE.Matrix4(),
  projScratch = new THREE.Matrix4();
/** The oracle's view-projection: the engine has only one depth convention, so there is
 *  nothing left to travel with it. Rewritten per call, never reallocated. `DepthCamera` reads a
 *  `Float64Array` specifically, so the matrix elements are copied into one rather than shared. */
const viewProjFlat = new Float64Array(16);
const depthCam = { viewProjection: viewProjFlat };
/** `hizDepth.ts:25-84` before batch A: three projections per pixel. */
export function referenceVisibilityDepth(
  ids: Uint32Array,
  pages: readonly (VisPage | undefined)[],
  cam: THREE.PerspectiveCamera,
  viewport: [number, number],
) {
  const [width, height] = viewport,
    depth = new Float32Array(width * height);
  depth.fill(DEPTH_CLEAR);
  cam.updateMatrixWorld();
  // The engine projection, not the host's: reversed depth, infinite far plane.
  perspectiveProjection(projScratch.elements, cam.fov, cam.aspect, cam.near, cam.zoom);
  viewProjScratch.multiplyMatrices(projScratch, cam.matrixWorldInverse);
  viewProjFlat.set(viewProjScratch.elements);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const unpacked = unpackVisibilityId(ids[y * width + x]);
      if (!unpacked) continue;
      const page = pages[unpacked.pageIndex];
      if (!page?.attributes.position) continue;
      const index = page.array,
        base = unpacked.triangleIndex * 3;
      if (base + 2 >= index.length) continue;
      const p = page.attributes.position;
      const a = projectVisibilityVertex(page.matrix, p, index[base], depthCam, width, height);
      const b = projectVisibilityVertex(page.matrix, p, index[base + 1], depthCam, width, height);
      const c = projectVisibilityVertex(page.matrix, p, index[base + 2], depthCam, width, height);
      if (!a || !b || !c) continue;
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

/** `hizOcclusion.ts:37-81` before batch A: linear search of the level, from mip 0 to the last. */
export function referenceHizTestRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  clipsNear: boolean,
  width: number,
  height: number,
  levels: number,
  into: Int32Array,
) {
  if (
    clipsNear ||
    !Number.isInteger(minX) ||
    !Number.isInteger(minY) ||
    !Number.isInteger(maxX) ||
    !Number.isInteger(maxY) ||
    maxX < minX ||
    maxY < minY ||
    width < 1 ||
    height < 1 ||
    levels < 1
  )
    return false;
  const x0 = minX < 0 ? 0 : minX,
    y0 = minY < 0 ? 0 : minY,
    x1 = maxX > width - 1 ? width - 1 : maxX,
    y1 = maxY > height - 1 ? height - 1 : maxY;
  if (x1 < x0 || y1 < y0) return false;
  for (let level = 0; level < levels; level++) {
    const scale = 2 ** level;
    if (
      Math.floor(x1 / scale) - Math.floor(x0 / scale) < HIZ_KERNEL_TEXELS &&
      Math.floor(y1 / scale) - Math.floor(y0 / scale) < HIZ_KERNEL_TEXELS
    ) {
      into[0] = level;
      into[1] = x0;
      into[2] = y0;
      into[3] = x1;
      into[4] = y1;
      return true;
    }
  }
  return false;
}
