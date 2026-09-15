// Oracles du lot M1 « socle mathématique » : le code d'avant le rattachement au socle, recopié tel
// quel depuis `develop` au commit d016f88. Ces copies sont des doublons voulus — c'est contre elles
// que les consommateurs rattachés sont opposés, valeur par valeur, par `Object.is`.
import * as THREE from 'three';
import { EPSILON } from '../../../sdk-core/lightingTransportIntersections.ts';

/** `streamingPriority.ts:27-45` d'avant : produit en boucle depuis zéro, puis centre de vue. */
export function referenceComposeView(view, camera, world) {
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += camera[k * 4 + row] * world[column * 4 + k];
      view[column * 4 + row] = sum;
    }
}
export function referenceProject(view, sphere, out) {
  const cx = sphere[0],
    cy = sphere[1],
    cz = sphere[2];
  out[0] = view[0] * cx + view[4] * cy + view[8] * cz + view[12];
  out[1] = view[1] * cx + view[5] * cy + view[9] * cz + view[13];
  out[2] = view[2] * cx + view[6] * cy + view[10] * cz + view[14];
  out[3] = sphere[3];
}

/** `webgpuShadowBounds.ts:13-28` d'avant : la sphère monde d'un cluster. */
export function referenceClusterSphere(rec, out, base) {
  const e = rec.matrix.elements;
  const cx = (rec.min[0] + rec.max[0]) / 2,
    cy = (rec.min[1] + rec.max[1]) / 2,
    cz = (rec.min[2] + rec.max[2]) / 2;
  const hx = (rec.max[0] - rec.min[0]) / 2,
    hy = (rec.max[1] - rec.min[1]) / 2,
    hz = (rec.max[2] - rec.min[2]) / 2;
  out[base] = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
  out[base + 1] = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
  out[base + 2] = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
  out[base + 3] = Math.hypot(
    Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz,
  );
}

/** `webgpuPagesWinding.ts:23-28` d'avant : le sens de parcours, déterminant développé en ligne. */
export function referenceWindingCw(e) {
  return (
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
      e[1] * (e[4] * e[10] - e[6] * e[8]) +
      e[2] * (e[4] * e[9] - e[5] * e[8]) <
    0
  );
}

/** `visibilityProjection.ts:5-34` d'avant : l'espace de découpe écrit en ligne. */
const projectScratch = new THREE.Vector3();
export function referenceProjectVisibilityVertex(matrix, position, vi, viewProj, width, height) {
  const v = projectScratch
    .set(position.getX(vi), position.getY(vi), position.getZ(vi))
    .applyMatrix4(matrix);
  const e = viewProj.elements;
  const cx = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12],
    cy = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13],
    cz = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14],
    cw = e[3] * v.x + e[7] * v.y + e[11] * v.z + e[15];
  if (cw === 0 || !Number.isFinite(cw)) return null;
  const ndcX = cx / cw,
    ndcY = cy / cw,
    ndcZ = cz / cw;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (1 - (ndcY * 0.5 + 0.5)) * height,
    z: ndcZ * 0.5 + 0.5,
    invW: 1 / cw,
    worldX: v.x,
    worldY: v.y,
    worldZ: v.z,
  };
}

/** `visibilityMath.ts:97-106` d'avant : la table sRGB et l'encodage 8 bits écrits en ligne. */
export function referenceSrgb8Linear(octet) {
  const c = octet / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function referenceLinearToSrgb8(c) {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** `lightingSceneMath.ts:9-13` d'avant. */
export const referenceCross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** `lightingTransportIntersections.ts:7-31` d'avant, sans la levée : la garde est inchangée. */
export function referencePackedSurface(surface) {
  const u = surface.u,
    v = surface.v;
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const uv = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const determinant = uu * vv - uv * uv;
  if (!(determinant > 1e-15)) return 'INVALID_SCENE';
  return Float64Array.from([
    ...surface.origin,
    ...u,
    ...v,
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
    vv / determinant,
    -uv / determinant,
    uu / determinant,
  ]);
}

/** `lightingTransportRays.ts:6-50` d'avant, garde de tangente dégénérée comprise. */
function radicalInverse(value) {
  let inverse = 0,
    place = 0.5;
  while (value > 0) {
    inverse += (value & 1) * place;
    value >>>= 1;
    place *= 0.5;
  }
  return inverse;
}
export function referenceFillPatchRays(scene, patchIndex, count, rays) {
  const patch = scene.patches[patchIndex];
  const n = patch.normal;
  const length = Math.hypot(...patch.u);
  if (!(length > 0)) return 'INVALID_SCENE';
  const tx = patch.u[0] / length,
    ty = patch.u[1] / length,
    tz = patch.u[2] / length;
  const bx = n[1] * tz - n[2] * ty,
    by = n[2] * tx - n[0] * tz,
    bz = n[0] * ty - n[1] * tx;
  const directions = count / 4;
  const rotation = (patch.id * 0.6180339887498949) % 1;
  for (let i = 0; i < count; i++) {
    const origin = i % 4,
      direction = Math.floor(i / 4);
    const a = origin % 2 ? 0.25 : -0.25,
      b = origin >= 2 ? 0.25 : -0.25;
    const radial = Math.sqrt((direction + 0.5) / directions);
    const phi = 2 * Math.PI * ((radicalInverse(direction) + rotation) % 1);
    const x = radial * Math.cos(phi),
      y = radial * Math.sin(phi),
      z = Math.sqrt(1 - radial * radial);
    const offset = (patchIndex * count + i) * 6;
    rays[offset] = patch.center[0] + a * patch.u[0] + b * patch.v[0] + n[0] * EPSILON * 4;
    rays[offset + 1] = patch.center[1] + a * patch.u[1] + b * patch.v[1] + n[1] * EPSILON * 4;
    rays[offset + 2] = patch.center[2] + a * patch.u[2] + b * patch.v[2] + n[2] * EPSILON * 4;
    rays[offset + 3] = tx * x + bx * y + n[0] * z;
    rays[offset + 4] = ty * x + by * y + n[1] * z;
    rays[offset + 5] = tz * x + bz * y + n[2] * z;
  }
  return rays;
}
