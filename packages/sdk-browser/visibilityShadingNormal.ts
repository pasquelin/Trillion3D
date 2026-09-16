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
 * La normale monde d'un pixel ombré : normale géométrique du triangle, remplacée par les normales
 * de sommets quand la primitive en porte, puis tournée par la carte de normales dans le repère
 * tangent — celui des tangentes de sommets quand elles existent, sinon celui que les coordonnées de
 * texture du triangle donnent. Le repère est monté ici, la BRDF le lit dans `visibilityLighting.ts`.
 *
 * Aucune allocation : tous les vecteurs sont des vecteurs de travail du module, et le résultat est
 * rendu dans l'un d'eux — à lire avant le pixel suivant.
 *
 * `screenFace` est le signe de l'aire écran du triangle, que le rasteriseur connaît seul ; `face`
 * s'en déduit avec l'orientation de la matrice monde, et décide de quel côté une surface à deux
 * faces est vue.
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
    copyScaledVector3(frameN, vertexNormals[0], bary.w0);
    addScaledVector3(frameN, vertexNormals[1], bary.w1);
    addScaledVector3(frameN, vertexNormals[2], bary.w2);
    normalizeVector3(frameN);
    if (mat.doubleSided) scaleVector3(frameN, face);
    Nx = frameN[0];
    Ny = frameN[1];
    Nz = frameN[2];
  } else {
    const length = Math.hypot(Nx, Ny, Nz) || 1;
    Nx *= screenFace / length;
    Ny *= screenFace / length;
    Nz *= screenFace / length;
  }
  if (mat.normalMap) {
    const nrm = sampleLinear(mat.normalMap, uv[0], uv[1]);
    const mapN = [
      (nrm[0] * 2 - 1) * mat.normalScale,
      (nrm[1] * 2 - 1) * mat.normalScaleY,
      nrm[2] * 2 - 1,
    ];
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
      // `q1` occupe `frameN`, comme le repère de l'hôte : sa valeur d'avant est déjà recopiée.
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
    scaleVector3(T, mapN[0]);
    addScaledVector3(T, B, mapN[1]);
    frameN[0] = Nx;
    frameN[1] = Ny;
    frameN[2] = Nz;
    addScaledVector3(T, frameN, mapN[2]);
    normalizeVector3(T);
    Nx = T[0];
    Ny = T[1];
    Nz = T[2];
  }
  frameOut[0] = Nx;
  frameOut[1] = Ny;
  frameOut[2] = Nz;
  return frameOut;
}
