// Oracle du point G3 : `visibilityLighting.ts` avant le lot G, recopié tel quel. Les constantes de
// l'éclairage hémisphérique — direction du soleil, longueur, couleur du sol, couleur du ciel — y sont
// recalculées et réallouées à chaque pixel, et les canaux passent par des tableaux temporaires.
import * as THREE from 'three';
import { attr2, sampleLinear, sampleMap } from '../../visibilityMath.ts';

const normalScratch = new THREE.Matrix3();
const frameNormals = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameTangents = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameBitangents = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameN = new THREE.Vector3(),
  frameT = new THREE.Vector3(),
  frameB = new THREE.Vector3(),
  frameQ = new THREE.Vector3();

export function referenceShadeLit(
  page,
  tri,
  affine,
  bary,
  uv,
  mat,
  rgb,
  metalness,
  roughness,
  camera,
) {
  const world = [
    tri.a.worldX * bary.w0 + tri.b.worldX * bary.w1 + tri.c.worldX * bary.w2,
    tri.a.worldY * bary.w0 + tri.b.worldY * bary.w1 + tri.c.worldY * bary.w2,
    tri.a.worldZ * bary.w0 + tri.b.worldZ * bary.w1 + tri.c.worldZ * bary.w2,
  ];
  const nx = tri.b.worldX - tri.a.worldX,
    ny = tri.b.worldY - tri.a.worldY,
    nz = tri.b.worldZ - tri.a.worldZ;
  const cx = tri.c.worldX - tri.a.worldX,
    cy = tri.c.worldY - tri.a.worldY,
    cz = tri.c.worldZ - tri.a.worldZ;
  let Nx = ny * cz - nz * cy,
    Ny = nz * cx - nx * cz,
    Nz = nx * cy - ny * cx;
  const screenFace = affine.area * tri.a.invW * tri.b.invW * tri.c.invW < 0 ? 1 : -1;
  const face = screenFace * (page.matrix.determinant() < 0 ? -1 : 1),
    side = mat.backSide ? -1 : 1;
  const normalAttr = page.attributes.normal,
    tangentAttr = page.attributes.tangent;
  normalScratch.getNormalMatrix(page.matrix);
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
          .transformDirection(page.matrix)
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
  const vx = camera.position.x - world[0],
    vy = camera.position.y - world[1],
    vz = camera.position.z - world[2],
    vLen = Math.hypot(vx, vy, vz) || 1;
  const V = [vx / vLen, vy / vLen, vz / vLen];
  const Lraw = [1, 3, 2],
    lLen = Math.hypot(Lraw[0], Lraw[1], Lraw[2]),
    L = [Lraw[0] / lLen, Lraw[1] / lLen, Lraw[2] / lLen];
  const NdotL = Math.max(0, Nx * L[0] + Ny * L[1] + Nz * L[2]),
    up = Ny * 0.5 + 0.5;
  const groundColor = new THREE.Color(0x495061);
  const sky = [2, 2, 2],
    ground = [groundColor.r * 2, groundColor.g * 2, groundColor.b * 2];
  const hemi = [
    ground[0] + (sky[0] - ground[0]) * up,
    ground[1] + (sky[1] - ground[1]) * up,
    ground[2] + (sky[2] - ground[2]) * up,
  ];
  const NdotV = Math.max(1e-4, Nx * V[0] + Ny * V[1] + Nz * V[2]);
  const hx = L[0] + V[0],
    hy = L[1] + V[1],
    hz = L[2] + V[2],
    hLen = Math.hypot(hx, hy, hz) || 1;
  const H = [hx / hLen, hy / hLen, hz / hLen];
  const NdotH = Math.max(0, Nx * H[0] + Ny * H[1] + Nz * H[2]);
  const VdotH = Math.max(0, V[0] * H[0] + V[1] * H[1] + V[2] * H[2]);
  const alpha = Math.max(0.0525, roughness) ** 2;
  const alpha2 = alpha * alpha;
  const dDenom = NdotH * NdotH * (alpha2 - 1) + 1;
  const D = alpha2 / (Math.PI * dDenom * dDenom);
  const gV = NdotL * Math.sqrt(NdotV * NdotV * (1 - alpha2) + alpha2);
  const gL = NdotV * Math.sqrt(NdotL * NdotL * (1 - alpha2) + alpha2);
  const Vis = 0.5 / (gV + gL + 1e-7);
  const f0 = [
    0.04 * (1 - metalness) + rgb[0] * metalness,
    0.04 * (1 - metalness) + rgb[1] * metalness,
    0.04 * (1 - metalness) + rgb[2] * metalness,
  ];
  const fTerm = Math.pow(Math.max(0, 1 - VdotH), 5);
  const F = [f0[0] + (1 - f0[0]) * fTerm, f0[1] + (1 - f0[1]) * fTerm, f0[2] + (1 - f0[2]) * fTerm];
  const spec = [D * Vis * F[0], D * Vis * F[1], D * Vis * F[2]];
  const direct = 2.5 * NdotL;
  const diffuse = rgb.map((c) => (c * (1 - metalness)) / Math.PI);
  const ao = mat.aoMap ? 1 + mat.aoIntensity * (sampleLinear(mat.aoMap, uv[0], uv[1])[0] - 1) : 1;
  const emissiveSample = mat.emissiveMap ? sampleMap(mat.emissiveMap, uv[0], uv[1]) : [1, 1, 1];
  return [0, 1, 2].map(
    (c) =>
      diffuse[c] * (hemi[c] * ao + direct) + spec[c] * direct + mat.emissive[c] * emissiveSample[c],
  );
}
