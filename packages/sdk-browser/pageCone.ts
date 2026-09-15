import { coneRejects } from '../sdk-core/index.ts';
import * as THREE from 'three';

export type NormalCone = { axis: [number, number, number]; angle: number };
/** Never rejects. */
export const OPEN_CONE: NormalCone = { axis: [0, 0, 1], angle: Math.PI };
export { triangleCone } from './pageConeBuild.ts';

const loneContext: ConeContext = {
  ready: false,
  conformal: false,
  scale: 1,
  normal: new THREE.Matrix3(),
  camX: 0,
  camY: 0,
  camZ: 0,
};

const scratch = {
  axis: new THREE.Vector3(),
  center: new THREE.Vector3(),
  cam: new THREE.Vector3(),
};

function perspectiveSpread(
  center: [number, number, number],
  radius: number,
  cameraWorld: [number, number, number],
): number {
  const d = Math.hypot(
    cameraWorld[0] - center[0],
    cameraWorld[1] - center[1],
    cameraWorld[2] - center[2],
  );
  if (!(d > radius)) return Math.PI;
  const t = radius / d;
  return Math.asin(t < 0 ? 0 : t > 1 ? 1 : t);
}

function isConformal(world: THREE.Matrix4) {
  const e = world.elements;
  const lx2 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2],
    ly2 = e[4] * e[4] + e[5] * e[5] + e[6] * e[6],
    lz2 = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
  const maxl = Math.max(lx2, ly2, lz2),
    minl = Math.min(lx2, ly2, lz2);
  if (maxl > minl * 1.0001 + 1e-12) return false;
  const eps = maxl * 1e-4 + 1e-12;
  return (
    Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) <= eps &&
    Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) <= eps &&
    Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) <= eps
  );
}

/**
 * Ce qu'un rejet de cône lit d'une racine et de la caméra, et qui ne change pas d'un cluster à
 * l'autre : la conformité de la transformation, son échelle, sa matrice normale, la position monde
 * de la caméra. Posé une fois par racine et par image, il retire de la boucle par cluster une
 * inverse-transposée 3×3, une décomposition de matrice de caméra et le test de conformité —
 * l'arithmétique par cluster ne bouge pas d'un bit.
 *
 * `ready` dit si le contexte porte déjà cette racine : une racine dont aucun cluster n'a de cône ne
 * le fait jamais poser.
 */
export type ConeContext = {
  ready: boolean;
  conformal: boolean;
  scale: number;
  normal: THREE.Matrix3;
  camX: number;
  camY: number;
  camZ: number;
};

/** Le contexte réutilisé d'une coupe : la sélection est synchrone, comme son `selectionScratch`. */
export function createConeContext(): ConeContext {
  return {
    ready: false,
    conformal: false,
    scale: 1,
    normal: new THREE.Matrix3(),
    camX: 0,
    camY: 0,
    camZ: 0,
  };
}

/** Remplit le contexte pour une transformation de racine et une caméra. */
export function coneContextFor(
  into: ConeContext,
  world: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
) {
  into.ready = true;
  into.conformal = isConformal(world);
  if (!into.conformal) return into;
  const e = world.elements;
  into.scale = Math.hypot(e[0], e[1], e[2]);
  into.normal.getNormalMatrix(world);
  camera.updateMatrixWorld();
  camera.getWorldPosition(scratch.cam);
  into.camX = scratch.cam.x;
  into.camY = scratch.cam.y;
  into.camZ = scratch.cam.z;
  return into;
}

/** Le rejet de cône d'un cluster, le contexte de sa racine étant déjà posé.
 *  Miroir CPU de `coneRejectsBox` (gpuDagShader.ts) : mêmes tolérances 1.0001, 1e-12 et 1e-4,
 *  mêmes opérandes, deux langages — le texte ne se partage pas, la règle si. */
export function coneCullsPageWith(
  ctx: ConeContext,
  cone: NormalCone,
  world: THREE.Matrix4,
  min: number[],
  max: number[],
  material?: THREE.Material | THREE.Material[],
): boolean {
  if (material) {
    const side = Array.isArray(material) ? material[0]?.side : material.side;
    if (side === THREE.DoubleSide || side === THREE.BackSide) return false;
  }
  if (!ctx.conformal) return false;
  if (cone.angle >= Math.PI / 2) return false;
  const { axis, center } = scratch;
  center
    .set((min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5)
    .applyMatrix4(world);
  const radius =
    Math.hypot((max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5) *
    ctx.scale;
  const spread = perspectiveSpread([center.x, center.y, center.z], radius, [
    ctx.camX,
    ctx.camY,
    ctx.camZ,
  ]);
  axis.fromArray(cone.axis).applyMatrix3(ctx.normal);
  const al = axis.length();
  if (!(al > 0)) return false;
  axis.multiplyScalar(1 / al);
  const vx = ctx.camX - center.x,
    vy = ctx.camY - center.y,
    vz = ctx.camZ - center.z;
  const vl = Math.hypot(vx, vy, vz);
  if (!(vl > 0)) return false;
  const dot = Math.min(1, Math.max(-1, (axis.x * vx + axis.y * vy + axis.z * vz) / vl));
  try {
    return coneRejects(dot, cone.angle, spread);
  } catch {
    return false;
  }
}

/** Le même rejet pour un appelant qui n'a pas de contexte : il en pose un pour ce seul cluster. */
export function coneCullsPage(
  cone: NormalCone,
  world: THREE.Matrix4,
  min: number[],
  max: number[],
  camera: THREE.PerspectiveCamera,
  material?: THREE.Material | THREE.Material[],
): boolean {
  return coneCullsPageWith(
    coneContextFor(loneContext, world, camera),
    cone,
    world,
    min,
    max,
    material,
  );
}
