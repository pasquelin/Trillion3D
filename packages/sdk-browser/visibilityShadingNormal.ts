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
const frameNormals = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
const frameTangents = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
const frameBitangents = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
const frameN = new Float64Array(3),
  frameT = new Float64Array(3),
  frameB = new Float64Array(3),
  frameQ = new Float64Array(3),
  frameOut = new Float64Array(3);

/**
 * World normal of a shaded pixel: the triangle's geometric normal, replaced by vertex normals
 * when the primitive carries them, then rotated by the normal map in the tangent frame — the
 * vertex-tangent frame when they exist, otherwise the one the triangle's texture coordinates
 * give. The frame is built here; the BRDF reads it in `visibilityLighting.ts`.
 *
 * No allocation: every vector is a module scratch vector, and the result is returned in one of
 * them — to be read before the next pixel.
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
  const vertexNormals = normalAttr ? frameNormals : null;
  if (normalAttr)
    for (let j = 0; j < 3; j++) {
      const i = j === 0 ? tri.i0 : j === 1 ? tri.i1 : tri.i2,
        n = frameNormals[j];
      applyMatrix3Vector3(
        n,
        normalScratch,
        normalAttr.getX(i),
        normalAttr.getY(i),
        normalAttr.getZ(i),
      );
      normalizeVector3(n);
      scaleVector3(n, side);
    }
  if (vertexNormals) {
    // Interpolation, normalisation and side kept as scalars: the same operations in the same
    // order as `copyScaledVector3`, `addScaledVector3`, `normalizeVector3` and `scaleVector3`,
    // without round-trips through a buffer whose value is never reread.
    const v0 = vertexNormals[0],
      v1 = vertexNormals[1],
      v2 = vertexNormals[2];
    const w0 = bary.w0,
      w1 = bary.w1,
      w2 = bary.w2;
    Nx = v0[0] * w0 + v1[0] * w1 + v2[0] * w2;
    Ny = v0[1] * w0 + v1[1] * w1 + v2[1] * w2;
    Nz = v0[2] * w0 + v1[2] * w1 + v2[2] * w2;
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
    const T = frameT,
      B = frameB;
    if (tangentAttr && vertexNormals) {
      for (let j = 0; j < 3; j++) {
        const i = j === 0 ? tri.i0 : j === 1 ? tri.i1 : tri.i2;
        const tangent = frameTangents[j],
          bitangent = frameBitangents[j];
        transformDirectionVector3(
          tangent,
          world,
          tangentAttr.getX(i),
          tangentAttr.getY(i),
          tangentAttr.getZ(i),
        );
        scaleVector3(tangent, side);
        crossVector3(bitangent, vertexNormals[j], tangent);
        scaleVector3(bitangent, tangentAttr.getW(i));
        normalizeVector3(bitangent);
      }
      copyScaledVector3(T, frameTangents[0], bary.w0);
      addScaledVector3(T, frameTangents[1], bary.w1);
      addScaledVector3(T, frameTangents[2], bary.w2);
      normalizeVector3(T);
      copyScaledVector3(B, frameBitangents[0], bary.w0);
      addScaledVector3(B, frameBitangents[1], bary.w1);
      addScaledVector3(B, frameBitangents[2], bary.w2);
      normalizeVector3(B);
    } else {
      const uva = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 1, 0, 0),
        uvb = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 0, 1, 0),
        uvc = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 0, 0, 1);
      const du1 = uvb[0] - uva[0],
        dv1 = uvb[1] - uva[1],
        du2 = uvc[0] - uva[0],
        dv2 = uvc[1] - uva[1];
      // `q1` occupies `frameN`, like the host frame; that is its only write of the pass.
      frameN[0] = cy * Nz - cz * Ny;
      frameN[1] = cz * Nx - cx * Nz;
      frameN[2] = cx * Ny - cy * Nx;
      frameQ[0] = Ny * nz - Nz * ny;
      frameQ[1] = Nz * nx - Nx * nz;
      frameQ[2] = Nx * ny - Ny * nx;
      copyScaledVector3(T, frameN, du1);
      addScaledVector3(T, frameQ, du2);
      copyScaledVector3(B, frameN, dv1);
      addScaledVector3(B, frameQ, dv2);
      const scale = screenFace / Math.sqrt(Math.max(lengthSqVector3(T), lengthSqVector3(B), 1e-20));
      scaleVector3(T, scale);
      scaleVector3(B, scale);
    }
    if (mat.doubleSided && normalAttr) {
      scaleVector3(T, face);
      scaleVector3(B, face);
    }
    // The geometric normal is already scalars: copying it into a buffer to add it only served to
    // go through `addScaledVector3`.
    scaleVector3(T, mapX);
    addScaledVector3(T, B, mapY);
    let tx = T[0] + Nx * mapZ,
      ty = T[1] + Ny * mapZ,
      tz = T[2] + Nz * mapZ;
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
