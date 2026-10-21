// Volume-bench references that have no ready-made Three.js method: each is written with
// Three.js objects — `Vector3`, `Vector4`, `Matrix4` — in the exact order the engine
// called them.
import * as THREE from 'three'

/** Plane order of the host library's `extractPlanes`: left, right, bottom, top, near, far. */
const ANCIEN_ORDRE = [1, 0, 2, 3, 5, 4]
/** Planes ordered as the host library, put back in the engine's order. */
export const reordonne = (planes: Float64Array | Float32Array) => {
  const sortie = new Float64Array(24)
  ANCIEN_ORDRE.forEach((k, i) => sortie.set(planes.subarray(k * 4, k * 4 + 4), i * 4))
  return sortie
}

const plan = new THREE.Vector4(),
  transposee = new THREE.Matrix4()

export function referencePlanesToLocal(planes: Float32Array, elements: number[]) {
  transposee.fromArray(elements).transpose()
  const sortie = []
  for (let i = 0; i < 24; i += 4) {
    plan.set(planes[i], planes[i + 1], planes[i + 2], planes[i + 3]).applyMatrix4(transposee)
    sortie.push(plan.x, plan.y, plan.z, plan.w)
  }
  return sortie
}
