import * as THREE from 'three';
import type { LightingExperimentRenderState } from './lightingObservationContracts.ts';

export function createObservationTransforms(state: LightingExperimentRenderState) {
  const basis = new THREE.Matrix4(),
    normal = new THREE.Vector3(),
    u = new THREE.Vector3(),
    v = new THREE.Vector3();
  const surfaceBasis = (i: number, target: THREE.Matrix4) => {
    const surface = state.scene.surfaces[i];
    u.fromArray(surface.u);
    v.fromArray(surface.v);
    normal.crossVectors(u, v);
    const area = normal.length();
    if (
      !Number.isFinite(area) ||
      area <= 1e-12 ||
      Math.abs(u.dot(v)) > 1e-6 * u.length() * v.length()
    )
      throw new Error('Lighting experiment tracing requires finite orthogonal rectangle edges');
    normal.multiplyScalar(1 / area);
    target.makeBasis(u, v, normal);
    target.setPosition(surface.origin[0], surface.origin[1], surface.origin[2]);
    return target;
  };
  const sphereBasis = (target: THREE.Matrix4) => {
    const sphere = state.scene.sphere;
    if (!sphere) throw new Error('Lighting experiment observation requires the declared sphere');
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0)
      throw new Error('Invalid lighting experiment sphere radius');
    target.makeScale(sphere.radius, sphere.radius, sphere.radius);
    return target.setPosition(sphere.center[0], sphere.center[1], sphere.center[2]);
  };
  return { basis, surfaceBasis, sphereBasis };
}
