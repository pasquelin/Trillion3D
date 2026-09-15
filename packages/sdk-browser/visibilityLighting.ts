import * as THREE from 'three';
import { determinantMatrix4, normalMatrix3 } from '../sdk-core/index.ts';
import { attr2, sampleLinear, sampleMap, triangleAt } from './visibilityMath.ts';
import type { VisMaterial, VisPage } from './visibilityTypes.ts';

const normalScratch = new THREE.Matrix3();
const frameNormals = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameTangents = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameBitangents = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const frameN = new THREE.Vector3(),
  frameT = new THREE.Vector3(),
  frameB = new THREE.Vector3(),
  frameQ = new THREE.Vector3();

/** L'éclairage hémisphérique fixe du chemin CPU : soleil normalisé, ciel et sol. Rien ici ne dépend
 *  du pixel, et tout y était pourtant recalculé — `Math.hypot` et `new THREE.Color` compris — à
 *  chaque pixel ombré. Mêmes opérandes, mêmes divisions, une seule fois au chargement du module. */
const LRAW = [1, 3, 2] as const;
const L_LEN = Math.hypot(LRAW[0], LRAW[1], LRAW[2]);
const LX = LRAW[0] / L_LEN,
  LY = LRAW[1] / L_LEN,
  LZ = LRAW[2] / L_LEN;
const GROUND_COLOR = new THREE.Color(0x495061);
const SKY_R = 2,
  SKY_G = 2,
  SKY_B = 2;
const GROUND_R = GROUND_COLOR.r * 2,
  GROUND_G = GROUND_COLOR.g * 2,
  GROUND_B = GROUND_COLOR.b * 2;
/** Émission neutre quand le matériau n'a pas de carte : lue seule, jamais écrite ni conservée. */
const NO_EMISSIVE: readonly [number, number, number] = [1, 1, 1];

export function shadeLit(
  page: VisPage,
  tri: NonNullable<ReturnType<typeof triangleAt>>,
  affine: { area: number },
  bary: { w0: number; w1: number; w2: number },
  uv: [number, number],
  mat: VisMaterial,
  rgb: [number, number, number],
  metalness: number,
  roughness: number,
  camera: THREE.PerspectiveCamera,
): [number, number, number] {
  const world: [number, number, number] = [
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
  const face = screenFace * (determinantMatrix4(page.matrix.elements) < 0 ? -1 : 1),
    side = mat.backSide ? -1 : 1;
  const normalAttr = page.attributes.normal,
    tangentAttr = page.attributes.tangent;
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
    let T: THREE.Vector3, B: THREE.Vector3;
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
  const Vx = vx / vLen,
    Vy = vy / vLen,
    Vz = vz / vLen;
  const NdotL = Math.max(0, Nx * LX + Ny * LY + Nz * LZ),
    up = Ny * 0.5 + 0.5;
  const hemiR = GROUND_R + (SKY_R - GROUND_R) * up,
    hemiG = GROUND_G + (SKY_G - GROUND_G) * up,
    hemiB = GROUND_B + (SKY_B - GROUND_B) * up;
  const NdotV = Math.max(1e-4, Nx * Vx + Ny * Vy + Nz * Vz);
  const hx = LX + Vx,
    hy = LY + Vy,
    hz = LZ + Vz,
    hLen = Math.hypot(hx, hy, hz) || 1;
  const Hx = hx / hLen,
    Hy = hy / hLen,
    Hz = hz / hLen;
  const NdotH = Math.max(0, Nx * Hx + Ny * Hy + Nz * Hz);
  const VdotH = Math.max(0, Vx * Hx + Vy * Hy + Vz * Hz);
  const alpha = Math.max(0.0525, roughness) ** 2;
  const alpha2 = alpha * alpha;
  const dDenom = NdotH * NdotH * (alpha2 - 1) + 1;
  const D = alpha2 / (Math.PI * dDenom * dDenom);
  const gV = NdotL * Math.sqrt(NdotV * NdotV * (1 - alpha2) + alpha2);
  const gL = NdotV * Math.sqrt(NdotL * NdotL * (1 - alpha2) + alpha2);
  const Vis = 0.5 / (gV + gL + 1e-7);
  const f0r = 0.04 * (1 - metalness) + rgb[0] * metalness,
    f0g = 0.04 * (1 - metalness) + rgb[1] * metalness,
    f0b = 0.04 * (1 - metalness) + rgb[2] * metalness;
  const fTerm = Math.pow(Math.max(0, 1 - VdotH), 5);
  const specR = D * Vis * (f0r + (1 - f0r) * fTerm),
    specG = D * Vis * (f0g + (1 - f0g) * fTerm),
    specB = D * Vis * (f0b + (1 - f0b) * fTerm);
  const direct = 2.5 * NdotL;
  const dR = (rgb[0] * (1 - metalness)) / Math.PI,
    dG = (rgb[1] * (1 - metalness)) / Math.PI,
    dB = (rgb[2] * (1 - metalness)) / Math.PI;
  const ao = mat.aoMap ? 1 + mat.aoIntensity * (sampleLinear(mat.aoMap, uv[0], uv[1])[0] - 1) : 1;
  const emi = mat.emissiveMap ? sampleMap(mat.emissiveMap, uv[0], uv[1]) : NO_EMISSIVE;
  return [
    dR * (hemiR * ao + direct) + specR * direct + mat.emissive[0] * emi[0],
    dG * (hemiG * ao + direct) + specG * direct + mat.emissive[1] * emi[1],
    dB * (hemiB * ao + direct) + specB * direct + mat.emissive[2] * emi[2],
  ];
}
