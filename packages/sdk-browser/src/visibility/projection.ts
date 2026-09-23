import { transformAffinePoint, transformHomogeneousPoint } from '../../../sdk-core/src/index.ts';
import type { DepthCamera } from '../camera/depthConvention.ts';
import type { MatrixElements } from '../math/matrixElements.ts';

/** World vertex of the last projected point, and its clip-space point: re-read at once, never
 *  kept. A world matrix is affine, fourth row `(0, 0, 0, 1)`: the base's affine transform is then
 *  bit for bit the projective one, whose `1 / w` is 1. */
const worldScratch = new Float64Array(3);
const clipScratch = new Float64Array(4);

/** The three coordinates of a vertex, as a host geometry attribute yields them. */
export type VertexReader = {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
};

export function projectVisibilityVertex(
  matrix: MatrixElements,
  position: VertexReader,
  vi: number,
  cam: DepthCamera,
  width: number,
  height: number,
) {
  const v = transformAffinePoint(
    worldScratch,
    matrix.elements,
    position.getX(vi),
    position.getY(vi),
    position.getZ(vi),
  );
  const clip = transformHomogeneousPoint(clipScratch, cam.viewProjection, v[0], v[1], v[2]);
  const cw = clip[3];
  if (cw === 0 || !Number.isFinite(cw)) return null;
  const ndcX = clip[0] / cw,
    ndcY = clip[1] / cw,
    ndcZ = clip[2] / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    z: ndcZ,
    invW: 1 / cw,
    worldX: v[0],
    worldY: v[1],
    worldZ: v[2],
  };
}

export type Projected = {
  x: number;
  y: number;
  z: number;
  invW: number;
  worldX: number;
  worldY: number;
  worldZ: number;
};

/** A vertex whose only two screen coordinates matter: a projected one, or a raster point. */
type ScreenPoint = { x: number; y: number };

/**
 * Signed area of the screen triangle `(a, b, c)`: the barycentric denominator, and the sign that
 * says from which side the face is seen. The visibility-buffer raster, reconstructed depth and the
 * page reference raster each used to take their own copy of the same line.
 */
export function signedArea(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/**
 * The three affine barycentric weights of the point `(x, y)`, the signed area already known.
 *
 * The result is a work object reused from one call to the next: a raster reads it per pixel, and
 * allocating three numbers per pixel would cost more than the computation itself. The caller reads
 * it before the next call, or copies its fields, as `barycentric` does.
 */
const poids = { w0: 0, w1: 0, w2: 0 };
export function barycentricAt(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  x: number,
  y: number,
  area: number,
) {
  poids.w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
  poids.w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
  poids.w2 = 1 - poids.w0 - poids.w1;
  return poids;
}
