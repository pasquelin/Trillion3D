// Oracle for batch 4: `visibilityShadingNormal.ts` before refactoring to core, copied as is. The
// tangent frame was assembled using host library `Matrix3` and `Vector3` —
// `applyMatrix3`, `transformDirection`, `normalize`, `addScaledVector`, `crossVectors`,
// `multiplyScalar`, `lengthSq`. It serves as bit-by-bit reference for new code. What previous
// batches already moved out of host — `matrixWindingCw`, `normalMatrix3` — remains as is on both
// sides: this benchmark only proves vector algebra moved in this batch.
import * as THREE from 'three';
import { asHostLibrary } from '../../hostResources.ts';
import { matrixWindingCw, normalMatrix3 } from '../../../sdk-core/index.ts';
import { attr2, sampleLinear, triangleAt } from '../../visibilityMath.ts';
import type { VisMaterial, VisPage } from '../../visibilityTypes.ts';

const normalScratch = new THREE.Matrix3();
const frameNormals = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameTangents = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameBitangents = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameN = new THREE.Vector3(),
  frameT = new THREE.Vector3(),
  frameB = new THREE.Vector3(),
  frameQ = new THREE.Vector3(),
  frameOut = new THREE.Vector3();

export function referenceShadingNormal(
  page: VisPage,
  tri: NonNullable<ReturnType<typeof triangleAt>>,
  bary: { w0: number; w1: number; w2: number },
  uv: [number, number],
  mat: VisMaterial,
  screenFace: number,
) {
  const nx = tri.b.worldX - tri.a.worldX,
    ny = tri.b.worldY - tri.a.worldY,
    nz = tri.b.worldZ - tri.a.worldZ;
  const cx = tri.c.worldX - tri.a.worldX,
    cy = tri.c.worldY - tri.a.worldY,
    cz = tri.c.worldZ - tri.a.worldZ;
  let Nx = ny * cz - nz * cy,
    Ny = nz * cx - nx * cz,
    Nz = nx * cy - ny * cx;
  const face = screenFace * (matrixWindingCw(page.matrix.elements) ? -1 : 1),
    side = mat.backSide ? -1 : 1;
  const world = asHostLibrary<THREE.Matrix4>(page.matrix);
  const normalAttr = asHostLibrary<THREE.BufferAttribute | undefined>(page.attributes.normal),
    tangentAttr = asHostLibrary<THREE.BufferAttribute | undefined>(page.attributes.tangent);
  normalMatrix3(normalScratch.elements, page.matrix.elements);
  const vertexNormals = normalAttr ? frameNormals : null;
  if (normalAttr)
    for (let j = 0; j < 3; j++)
      frameNormals[j]
        .fromBufferAttribute(normalAttr, j === 0 ? tri.i0 : j === 1 ? tri.i1 : tri.i2)
        .applyMatrix3(normalScratch)
        .normalize()
        .multiplyScalar(side);
  if (vertexNormals) {
    const n = frameN
      .copy(vertexNormals[0])
      .multiplyScalar(bary.w0)
      .addScaledVector(vertexNormals[1], bary.w1)
      .addScaledVector(vertexNormals[2], bary.w2)
      .normalize();
    if (mat.doubleSided) n.multiplyScalar(face);
    Nx = n.x;
    Ny = n.y;
    Nz = n.z;
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
    let T, B;
    if (tangentAttr && vertexNormals) {
      const tangents = frameTangents,
        bitangents = frameBitangents;
      for (let j = 0; j < 3; j++) {
        const i = j === 0 ? tri.i0 : j === 1 ? tri.i1 : tri.i2;
        tangents[j]
          .fromBufferAttribute(tangentAttr, i)
          .transformDirection(world)
          .multiplyScalar(side);
        bitangents[j]
          .crossVectors(vertexNormals[j], tangents[j])
          .multiplyScalar(tangentAttr.getW(i))
          .normalize();
      }
      T = frameT
        .copy(tangents[0])
        .multiplyScalar(bary.w0)
        .addScaledVector(tangents[1], bary.w1)
        .addScaledVector(tangents[2], bary.w2)
        .normalize();
      B = frameB
        .copy(bitangents[0])
        .multiplyScalar(bary.w0)
        .addScaledVector(bitangents[1], bary.w1)
        .addScaledVector(bitangents[2], bary.w2)
        .normalize();
    } else {
      const uva = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 1, 0, 0),
        uvb = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 0, 1, 0),
        uvc = attr2(page.attributes.uv, tri.i0, tri.i1, tri.i2, 0, 0, 1);
      const du1 = uvb[0] - uva[0],
        dv1 = uvb[1] - uva[1],
        du2 = uvc[0] - uva[0],
        dv2 = uvc[1] - uva[1];
      const q1 = frameN.set(cy * Nz - cz * Ny, cz * Nx - cx * Nz, cx * Ny - cy * Nx);
      const q0 = frameQ.set(Ny * nz - Nz * ny, Nz * nx - Nx * nz, Nx * ny - Ny * nx);
      T = frameT.copy(q1).multiplyScalar(du1).addScaledVector(q0, du2);
      B = frameB.copy(q1).multiplyScalar(dv1).addScaledVector(q0, dv2);
      const scale = screenFace / Math.sqrt(Math.max(T.lengthSq(), B.lengthSq(), 1e-20));
      T.multiplyScalar(scale);
      B.multiplyScalar(scale);
    }
    if (mat.doubleSided && normalAttr) {
      T.multiplyScalar(face);
      B.multiplyScalar(face);
    }
    const n = T.multiplyScalar(mapN[0])
      .addScaledVector(B, mapN[1])
      .addScaledVector(frameN.set(Nx, Ny, Nz), mapN[2])
      .normalize();
    Nx = n.x;
    Ny = n.y;
    Nz = n.z;
  }
  return frameOut.set(Nx, Ny, Nz);
}
