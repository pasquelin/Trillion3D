import {
  addScaledVector3,
  applyMatrix3Vector3,
  copyScaledVector3,
  crossVector3,
  lengthSqVector3,
  matrixWindingCw,
  normalMatrix3,
  normalizeVector3,
  scaleVector3,
  transformDirectionVector3,
} from '../sdk-core/index.ts';
import { attr2, sampleLinear, triangleAt } from './visibilityMath.ts';
import type { VisMaterial, VisPage } from './visibilityTypes.ts';

const normalScratch = new Float64Array(9);
/**
 * Every vector of the pixel's frame in one buffer, each read and written at its offset — the
 * form the kernels' offsets exist for (#72): the three vertex normals, tangents and bitangents,
 * then `N`, `T`, `B`, `Q` and the returned normal.
 */
const NORMALS = 0,
  TANGENTS = 9,
  BITANGENTS = 18,
  N_AT = 27,
  T_AT = 30,
  B_AT = 33,
  Q_AT = 36,
  OUT_AT = 39;
const frame = new Float64Array(OUT_AT + 3);
const frameOut = frame.subarray(OUT_AT, OUT_AT + 3);

/**
 * World normal of a shaded pixel: the triangle's geometric normal, replaced by vertex normals
 * when the primitive carries them, then rotated by the normal map in the tangent frame — the
 * vertex-tangent frame when they exist, otherwise the one the triangle's texture coordinates
 * give. The frame is built here; the BRDF reads it in `visibilityLighting.ts`.
 *
 * No allocation: every vector lives in the module's frame buffer, and the result is returned as
 * a view on it — to be read before the next pixel.
 *
 * `screenFace` is the sign of the triangle's screen area, which only the rasterizer knows;
 * `face` is deduced from it with the world-matrix orientation, and decides which side of a
 * two-sided surface is seen.
 */
export function shadingNormal(
  page: VisPage,
  tri: NonNullable<ReturnType<typeof triangleAt>>,
  bary: { w0: number; w1: number; w2: number },
  uv: [number, number],
  mat: VisMaterial,
  screenFace: number,
): Float64Array {
  const nx = tri.b.worldX - tri.a.worldX,
    ny = tri.b.worldY - tri.a.worldY,
    nz = tri.b.worldZ - tri.a.worldZ;
  const cx = tri.c.worldX - tri.a.worldX,
    cy = tri.c.worldY - tri.a.worldY,
    cz = tri.c.worldZ - tri.a.worldZ;
  let Nx = ny * cz - nz * cy,
    Ny = nz * cx - nx * cz,
    Nz = nx * cy - ny * cx;
  const world = page.matrix.elements;
  const face = screenFace * (matrixWindingCw(world) ? -1 : 1),
    side = mat.backSide ? -1 : 1;
  const normalAttr = page.attributes.normal,
    tangentAttr = page.attributes.tangent;
  normalMatrix3(normalScratch, world);
  if (normalAttr)
    for (let j = 0; j < 3; j++) {
      const i = j === 0 ? tri.i0 : j === 1 ? tri.i1 : tri.i2,
        at = NORMALS + j * 3;
      applyMatrix3Vector3(
        frame,
        normalScratch,
        normalAttr.getX(i),
        normalAttr.getY(i),
        normalAttr.getZ(i),
        at,
      );
      normalizeVector3(frame, at);
      scaleVector3(frame, side, at);
    }
  if (normalAttr) {
    // Interpolation, normalisation and side kept as scalars: the same operations in the same
    // order as `copyScaledVector3`, `addScaledVector3`, `normalizeVector3` and `scaleVector3`,
    // without round-trips through a buffer whose value is never reread.
    const w0 = bary.w0,
      w1 = bary.w1,
      w2 = bary.w2;
    Nx = frame[NORMALS] * w0 + frame[NORMALS + 3] * w1 + frame[NORMALS + 6] * w2;
    Ny = frame[NORMALS + 1] * w0 + frame[NORMALS + 4] * w1 + frame[NORMALS + 7] * w2;
    Nz = frame[NORMALS + 2] * w0 + frame[NORMALS + 5] * w1 + frame[NORMALS + 8] * w2;
    const inverse = 1 / (Math.sqrt(Nx * Nx + Ny * Ny + Nz * Nz) || 1);
    Nx *= inverse;
    Ny *= inverse;
    Nz *= inverse;
    if (mat.doubleSided) {
      Nx *= face;
      Ny *= face;
      Nz *= face;
    }
  } else {
    const length = Math.hypot(Nx, Ny, Nz) || 1;
    Nx *= screenFace / length;
    Ny *= screenFace / length;
    Nz *= screenFace / length;
  }
  if (mat.normalMap) {
    const nrm = sampleLinear(mat.normalMap, uv[0], uv[1]);
    // The three map components as scalars: an array here is an allocation per shaded pixel of a
    // surface that carries a normal map.
    const mapX = (nrm[0] * 2 - 1) * mat.normalScale,
      mapY = (nrm[1] * 2 - 1) * mat.normalScaleY,
      mapZ = nrm[2] * 2 - 1;
    if (tangentAttr && normalAttr) {
      for (let j = 0; j < 3; j++) {
        const i = j === 0 ? tri.i0 : j === 1 ? tri.i1 : tri.i2;
        const tangent = TANGENTS + j * 3,
          bitangent = BITANGENTS + j * 3;
        transformDirectionVector3(
          frame,
          world,
          tangentAttr.getX(i),
          tangentAttr.getY(i),
          tangentAttr.getZ(i),
          tangent,
        );
        scaleVector3(frame, side, tangent);
        crossVector3(frame, frame, frame, bitangent, NORMALS + j * 3, tangent);
        scaleVector3(frame, tangentAttr.getW(i), bitangent);
        normalizeVector3(frame, bitangent);
      }
      copyScaledVector3(frame, frame, bary.w0, T_AT, TANGENTS);
      addScaledVector3(frame, frame, bary.w1, T_AT, TANGENTS + 3);
      addScaledVector3(frame, frame, bary.w2, T_AT, TANGENTS + 6);
      normalizeVector3(frame, T_AT);
      copyScaledVector3(frame, frame, bary.w0, B_AT, BITANGENTS);
      addScaledVector3(frame, frame, bary.w1, B_AT, BITANGENTS + 3);
      addScaledVector3(frame, frame, bary.w2, B_AT, BITANGENTS + 6);
      normalizeVector3(frame, B_AT);
    } else {
      const uva = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 1, 0, 0),
        uvb = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 0, 1, 0),
        uvc = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 0, 0, 1);
      const du1 = uvb[0] - uva[0],
        dv1 = uvb[1] - uva[1],
        du2 = uvc[0] - uva[0],
        dv2 = uvc[1] - uva[1];
      // `q1` occupies the `N` slot, like the host frame; that is its only write of the pass.
      frame[N_AT] = cy * Nz - cz * Ny;
      frame[N_AT + 1] = cz * Nx - cx * Nz;
      frame[N_AT + 2] = cx * Ny - cy * Nx;
      frame[Q_AT] = Ny * nz - Nz * ny;
      frame[Q_AT + 1] = Nz * nx - Nx * nz;
      frame[Q_AT + 2] = Nx * ny - Ny * nx;
      copyScaledVector3(frame, frame, du1, T_AT, N_AT);
      addScaledVector3(frame, frame, du2, T_AT, Q_AT);
      copyScaledVector3(frame, frame, dv1, B_AT, N_AT);
      addScaledVector3(frame, frame, dv2, B_AT, Q_AT);
      const scale =
        screenFace /
        Math.sqrt(Math.max(lengthSqVector3(frame, T_AT), lengthSqVector3(frame, B_AT), 1e-20));
      scaleVector3(frame, scale, T_AT);
      scaleVector3(frame, scale, B_AT);
    }
    if (mat.doubleSided && normalAttr) {
      scaleVector3(frame, face, T_AT);
      scaleVector3(frame, face, B_AT);
    }
    // The geometric normal is already scalars: copying it into a buffer to add it only served to
    // go through `addScaledVector3`.
    scaleVector3(frame, mapX, T_AT);
    addScaledVector3(frame, frame, mapY, T_AT, B_AT);
    let tx = frame[T_AT] + Nx * mapZ,
      ty = frame[T_AT + 1] + Ny * mapZ,
      tz = frame[T_AT + 2] + Nz * mapZ;
    const inverse = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
    tx *= inverse;
    ty *= inverse;
    tz *= inverse;
    Nx = tx;
    Ny = ty;
    Nz = tz;
  }
  frameOut[0] = Nx;
  frameOut[1] = Ny;
  frameOut[2] = Nz;
  return frameOut;
}
