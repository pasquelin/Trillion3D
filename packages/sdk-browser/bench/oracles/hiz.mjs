// Oracles purs de A1 et A5, sans effet de bord : `hiz.bench.mjs` les mesure, les tests unitaires les
// importent comme référence. Importer ce module n'exécute ni banc ni écriture de fichier.
import * as THREE from 'three';
import { HIZ_BACKGROUND } from '../../../sdk-core/index.ts';
import { HIZ_KERNEL_TEXELS } from '../../hizCounts.ts';
import { projectVisibilityVertex } from '../../visibilityProjection.ts';
import { unpackVisibilityId } from '../../visibilityTypes.ts';

const viewProjScratch = new THREE.Matrix4();
/** `hizDepth.ts:25-84` avant le lot A : trois projections par pixel. */
export function referenceVisibilityDepth(ids, pages, cam, viewport) {
  const [width, height] = viewport,
    depth = new Float32Array(width * height);
  depth.fill(HIZ_BACKGROUND);
  cam.updateMatrixWorld();
  const viewProj = viewProjScratch.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
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
      const a = projectVisibilityVertex(
        page.matrix,
        p,
        index[base],
        viewProj.elements,
        width,
        height,
      );
      const b = projectVisibilityVertex(
        page.matrix,
        p,
        index[base + 1],
        viewProj.elements,
        width,
        height,
      );
      const c = projectVisibilityVertex(
        page.matrix,
        p,
        index[base + 2],
        viewProj.elements,
        width,
        height,
      );
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

/** `hizOcclusion.ts:37-81` avant le lot A : recherche linéaire du niveau, du mip 0 au dernier. */
export function referenceHizTestRect(
  minX,
  minY,
  maxX,
  maxY,
  clipsNear,
  width,
  height,
  levels,
  into,
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
