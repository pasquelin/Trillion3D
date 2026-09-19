import * as THREE from 'three';
import { sampleLinear, sampleMap, triangleAt } from './visibilityMath.ts';
import { shadingNormal } from './visibilityShadingNormal.ts';
import type { VisMaterial, VisPage } from './visibilityTypes.ts';
import type { EngineCamera } from './cameraWorld.ts';

/** Fixed hemispheric lighting of the CPU path: normalised sun, sky and ground. Nothing here
 *  depends on the pixel, yet everything was still recomputed — `Math.hypot` and `new THREE.Color`
 *  included — at each shaded pixel. Same operands, same divisions, once at module load. */
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
/** Neutral emission when the material has no map: read only, never written nor kept. */
const NO_EMISSIVE: readonly [number, number, number] = [1, 1, 1];

/**
 * The CPU-path BRDF, and it alone: the pixel's normal frame is built by
 * `shadingNormal`, and what follows only reads the normal, world position and material.
 */
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
  cam: EngineCamera,
): [number, number, number] {
  const world: [number, number, number] = [
    tri.a.worldX * bary.w0 + tri.b.worldX * bary.w1 + tri.c.worldX * bary.w2,
    tri.a.worldY * bary.w0 + tri.b.worldY * bary.w1 + tri.c.worldY * bary.w2,
    tri.a.worldZ * bary.w0 + tri.b.worldZ * bary.w1 + tri.c.worldZ * bary.w2,
  ];
  const screenFace = affine.area * tri.a.invW * tri.b.invW * tri.c.invW < 0 ? 1 : -1;
  const normal = shadingNormal(page, tri, bary, uv, mat, screenFace);
  const Nx = normal[0],
    Ny = normal[1],
    Nz = normal[2];
  // The eye in world space, taken from the engine camera that the frame entry copied.
  const eye = cam.eye;
  const vx = eye[0] - world[0],
    vy = eye[1] - world[1],
    vz = eye[2] - world[2],
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
