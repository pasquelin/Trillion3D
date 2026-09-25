import {
  transformAffinePoint,
  transformDirectionVector3,
  transformHomogeneousPoint,
} from '../../../sdk-core/src/index.ts';
import type { DepthCamera } from '../camera/depthConvention.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import { lineClip } from './shader/lineWgsl.ts';
import { spriteAt } from './shader/spriteWgsl.ts';
import type { VisMaterial, VisPage } from './types.ts';
import { DEFAULT_PIXEL_RATIO } from '../backend/common.ts';

/** World vertex of the last projected point, and its clip-space point: re-read at once, never
 *  kept. A world matrix is affine, fourth row `(0, 0, 0, 1)`: the base's affine transform is then
 *  bit for bit the projective one, whose `1 / w` is 1. */
const worldScratch = new Float64Array(4);
const clipScratch = new Float64Array(4);
const alongScratch = new Float64Array(4);
const viewportScratch = new Float64Array(2);

/** The three coordinates of a vertex, as a host geometry attribute yields them. */
export type VertexReader = {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
};

/** What widens a line quad's corner on screen (`lineClip`): the corners' normals, which carry the
 *  segment's signed direction, the surface's width in CSS pixels, and the image's pixel ratio. */
export type LineCorners = { along: VertexReader; width: number; pixelRatio: number };

/** The clip-space direction of the segment at corner `vi`: its normal under the world matrix,
 *  then under the camera as a direction (`w = 0`). `lineClip` reads it up to its length. */
function clipAlong(matrix: ArrayLike<number>, cam: DepthCamera, line: LineCorners, vi: number) {
  const { along } = line,
    d = transformDirectionVector3(
      alongScratch,
      matrix,
      along.getX(vi),
      along.getY(vi),
      along.getZ(vi),
    ),
    p = cam.viewProjection,
    [x, y, z] = d;
  for (let i = 0; i < 4; i++) alongScratch[i] = p[i] * x + p[4 + i] * y + p[8 + i] * z;
  return alongScratch;
}

export function projectVisibilityVertex(
  matrix: MatrixElements,
  position: VertexReader,
  vi: number,
  cam: DepthCamera,
  width: number,
  height: number,
  line?: LineCorners,
  sprite?: VisMaterial['sprite'],
) {
  const x = position.getX(vi),
    y = position.getY(vi);
  // A sprite's corner turns to face the camera (`spriteAt`), as in every GPU raster.
  const v = sprite
    ? spriteAt(worldScratch, cam.viewProjection, matrix.elements, x, y, sprite)
    : transformAffinePoint(worldScratch, matrix.elements, x, y, position.getZ(vi));
  const clip = transformHomogeneousPoint(clipScratch, cam.viewProjection, v[0], v[1], v[2]);
  // A line quad's corner leaves its segment on screen, as in every GPU raster.
  if (line) {
    viewportScratch[0] = width;
    viewportScratch[1] = height;
    const along = clipAlong(matrix.elements, cam, line, vi);
    lineClip(clip, clip, along, line.width, viewportScratch, line.pixelRatio);
  }
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

/** A projected triangle of a page; a line page's corners widened on screen at `pixelRatio` image
 *  pixels per CSS pixel, as every GPU raster widens them (`LineCorners`), a sprite page's turned
 *  to face the camera. */
export function triangleAt(
  page: VisPage,
  triangleIndex: number,
  cam: DepthCamera,
  width: number,
  height: number,
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  const index = page.array,
    position = page.attributes.position,
    base = triangleIndex * 3;
  if (!position || base + 2 >= index.length) return null;
  const lineWidth = page.material.lineWidth ?? 0,
    along = page.attributes.normal;
  const line = lineWidth > 0 && along ? { along, width: lineWidth, pixelRatio } : undefined;
  const m = page.matrix,
    sprite = page.material.sprite;
  const corner = (i: number) =>
    projectVisibilityVertex(m, position, index[i], cam, width, height, line, sprite);
  const a = corner(base),
    b = corner(base + 1),
    c = corner(base + 2);
  if (!a || !b || !c) return null;
  return {
    a,
    b,
    c,
    page,
    triangleIndex,
    i0: index[base],
    i1: index[base + 1],
    i2: index[base + 2],
  };
}
