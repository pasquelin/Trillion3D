// Références du banc des volumes qui n'ont pas de méthode Three.js toute faite : chacune est écrite
// avec les objets de Three.js — `Vector3`, `Vector4`, `Matrix4` — dans l'ordre exact où le moteur
// les appelait avant le lot M2.
import * as THREE from 'three';
import { coneRejects } from '../../../sdk-core/index.ts';

const systeme = (webgpu) => (webgpu ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem);
/** Le tronc de Three.js d'une vue-projection à plat, dans la convention de profondeur donnée. */
export const troncThree = (vp, webgpu) =>
  new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().fromArray(vp), systeme(webgpu));
/** Les plans d'un tronc de Three.js recopiés à plat dans un tableau du type demandé. */
export const plansThree = (frustum, Type) => {
  const sortie = new Type(24);
  frustum.planes.forEach((p, i) =>
    sortie.set([p.normal.x, p.normal.y, p.normal.z, p.constant], i * 4),
  );
  return sortie;
};
/** L'ordre de plans de l'ancien `extractPlanes` : gauche, droite, bas, haut, proche, loin. */
const ANCIEN_ORDRE = [1, 0, 2, 3, 5, 4];
/** Des plans rangés dans l'ordre de Three.js, remis dans l'ordre d'avant le lot M2. */
export const reordonne = (planes) => {
  const sortie = new Float64Array(24);
  ANCIEN_ORDRE.forEach((k, i) => sortie.set(planes.subarray(k * 4, k * 4 + 4), i * 4));
  return sortie;
};

const w = new THREE.Vector4(),
  ligne = new THREE.Vector4(),
  plan = new THREE.Vector4(),
  transposee = new THREE.Matrix4();

/** Plans bruts d'une matrice de découpe, dans l'ordre du tronc de Three.js, profondeur WebGL. */
export function referenceClipPlanes(elements) {
  const e = elements,
    sortie = [];
  w.set(e[3], e[7], e[11], e[15]);
  const lignes = [
    [0, 4, 8, 12],
    [1, 5, 9, 13],
    [2, 6, 10, 14],
  ];
  for (const [k, signe] of [
    [0, -1],
    [0, 1],
    [1, 1],
    [1, -1],
    [2, -1],
    [2, 1],
  ]) {
    const [a, b, c, d] = lignes[k];
    ligne.set(e[a], e[b], e[c], e[d]);
    plan.copy(w);
    if (signe > 0) plan.add(ligne);
    else plan.sub(ligne);
    sortie.push(plan.x, plan.y, plan.z, plan.w);
  }
  return sortie;
}

/** Plans ramenés dans le repère local : chaque plan multiplié par la transposée du placement. */
export function referencePlanesToLocal(planes, elements) {
  transposee.fromArray(elements).transpose();
  const sortie = [];
  for (let i = 0; i < 24; i += 4) {
    plan.set(planes[i], planes[i + 1], planes[i + 2], planes[i + 3]).applyMatrix4(transposee);
    sortie.push(plan.x, plan.y, plan.z, plan.w);
  }
  return sortie;
}

const axis = new THREE.Vector3(),
  center = new THREE.Vector3();

/** `pageCone.ts` avant le lot M2, après ses gardes de matériau, de conformité et d'angle. */
export function referenceConeRejects(cone, world, min, max, normal, scale, cam) {
  center
    .set((min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5)
    .applyMatrix4(world);
  const radius =
    Math.hypot((max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5) * scale;
  const d = Math.hypot(cam[0] - center.x, cam[1] - center.y, cam[2] - center.z);
  let spread = Math.PI;
  if (d > radius) {
    const t = radius / d;
    spread = Math.asin(t < 0 ? 0 : t > 1 ? 1 : t);
  }
  axis.fromArray(cone.axis).applyMatrix3(normal);
  const al = axis.length();
  if (!(al > 0)) return false;
  axis.multiplyScalar(1 / al);
  const vx = cam[0] - center.x,
    vy = cam[1] - center.y,
    vz = cam[2] - center.z;
  const vl = Math.hypot(vx, vy, vz);
  if (!(vl > 0)) return false;
  const dot = Math.min(1, Math.max(-1, (axis.x * vx + axis.y * vy + axis.z * vz) / vl));
  try {
    return coneRejects(dot, cone.angle, spread);
  } catch {
    return false;
  }
}
