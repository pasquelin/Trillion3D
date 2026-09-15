import * as THREE from 'three';
import { transformHomogeneousPoint } from '../sdk-core/index.ts';

const projectScratch = new THREE.Vector3();
/** Le point en espace de découpe du dernier sommet projeté : relu aussitôt, jamais conservé. */
const clipScratch = new Float64Array(4);

export function projectVisibilityVertex(
  matrix: THREE.Matrix4,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vi: number,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
) {
  const v = projectScratch
    .set(position.getX(vi), position.getY(vi), position.getZ(vi))
    .applyMatrix4(matrix);
  const clip = transformHomogeneousPoint(clipScratch, viewProj.elements, v.x, v.y, v.z);
  const cw = clip[3];
  if (cw === 0 || !Number.isFinite(cw)) return null;
  const ndcX = clip[0] / cw,
    ndcY = clip[1] / cw,
    ndcZ = clip[2] / cw;
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

export type Projected = {
  x: number;
  y: number;
  z: number;
  invW: number;
  worldX: number;
  worldY: number;
  worldZ: number;
};

/** Un sommet dont seules les deux coordonnées écran comptent : un projeté, ou un point de raster. */
type ScreenPoint = { x: number; y: number };

/**
 * Aire signée du triangle écran `(a, b, c)` : le dénominateur des barycentriques, et le signe qui
 * dit de quel côté on voit la face. Le raster du tampon de visibilité, la profondeur reconstruite
 * et le raster de référence des pages en tiraient chacun leur copie de la même ligne.
 */
export function signedArea(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/**
 * Les trois poids barycentriques affines du point `(x, y)`, l'aire signée étant déjà connue.
 *
 * Le résultat est un objet de travail réutilisé d'un appel à l'autre : un raster le lit par pixel,
 * et allouer trois nombres par pixel coûterait plus que le calcul lui-même. L'appelant le lit avant
 * l'appel suivant, ou en recopie les champs, comme le fait `barycentric`.
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
