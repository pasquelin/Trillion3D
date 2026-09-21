// The scene of the observation proof: three rectangles facing the camera — a diffuse receiver,
// a small emitter, a mirror — and the glossy sphere, as the transport experiment declares them
// and as a host loads them: one named mesh per surface.
import * as THREE from 'three';
import { sceneFromSurfaces } from '../fixtures/lightingTransportScene.ts';

/** Three rectangles facing the camera and the glossy sphere, in front of the origin. */
export function experimentScene() {
  const scene = sceneFromSurfaces([
    {
      id: 'receiver',
      origin: [-2, -2, -4],
      u: [4, 0, 0],
      v: [0, 4, 0],
      albedo: [0.6, 0.25, 0.2],
      emission: [0, 0, 0],
      kind: 'diffuse',
      moving: false,
      columns: 2,
      rows: 2,
    },
    {
      id: 'emitter',
      origin: [-1.4, -1.4, -3.9],
      u: [0.6, 0, 0],
      v: [0, 0.6, 0],
      albedo: [0.2, 0.2, 0.2],
      emission: [4, 1, 0.5],
      kind: 'diffuse',
      moving: false,
      columns: 1,
      rows: 1,
    },
    {
      id: 'mirror',
      origin: [0.6, -1.6, -3.9],
      u: [1, 0, 0],
      v: [0, 1, 0],
      albedo: [0, 0, 0],
      emission: [0, 0, 0],
      kind: 'mirror',
      moving: false,
      columns: 1,
      rows: 1,
    },
  ]);
  return {
    ...scene,
    sphere: { center: [0.8, 0.4, -3] as [number, number, number], radius: 0.5, roughness: 0.3 },
  };
}
export type ExperimentScene = ReturnType<typeof experimentScene>;

/** The host source graph: one quad per rectangle, named after it, and the sphere. */
export function hostSource(scene: ExperimentScene) {
  const source = new THREE.Group();
  for (const surface of scene.surfaces) {
    const [ox, oy, oz] = surface.origin,
      [ux, uy, uz] = surface.u,
      [vx, vy, vz] = surface.v;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          ox,
          oy,
          oz,
          ox + ux,
          oy + uy,
          oz + uz,
          ox + ux + vx,
          oy + uy + vy,
          oz + uz + vz,
          ox + vx,
          oy + vy,
          oz + vz,
        ],
        3,
      ),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = surface.id;
    source.add(mesh);
  }
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial());
  sphere.name = 'glossy_sphere';
  sphere.position.fromArray(scene.sphere.center);
  sphere.scale.setScalar(scene.sphere.radius);
  source.add(sphere);
  source.updateMatrixWorld(true);
  return source;
}

export function renderState(scene: ExperimentScene) {
  const patches = scene.patches.length,
    indirectIrradiance = new Float64Array(patches * 3),
    radiance = new Float64Array(patches * 3);
  for (let i = 0; i < patches; i++) {
    indirectIrradiance.set([0.8 + 0.4 * i, 0.5, 0.2 * i], i * 3);
    radiance.set([0.1, 0.1, 0.1], i * 3);
  }
  return { scene, indirectIrradiance, radiance, exposure: 1.2, reflectionSamples: 4 };
}
