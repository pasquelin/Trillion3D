// Volume-bench references that have no ready-made Three.js method: each is written with
// Three.js objects — `Vector3`, `Vector4`, `Matrix4` — in the exact order the engine
// called them before batch M2.
import * as THREE from 'three';
import { coneRejects } from '../../../sdk-core/index.ts';

/** Plane order of the old `extractPlanes`: left, right, bottom, top, near, far. */
const ANCIEN_ORDRE = [1, 0, 2, 3, 5, 4];
/** Planes ordered as Three.js, put back in the order from before batch M2. */
export const reordonne = (planes) => {
  const sortie = new Float64Array(24);
  ANCIEN_ORDRE.forEach((k, i) => sortie.set(planes.subarray(k * 4, k * 4 + 4), i * 4));
  return sortie;
};

const plan = new THREE.Vector4(),
  transposee = new THREE.Matrix4();

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

/** `pageCone.ts` before batch M2, after its material, conformal and angle guards. */
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
