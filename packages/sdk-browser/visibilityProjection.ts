import * as THREE from 'three';

const projectScratch = new THREE.Vector3();

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
