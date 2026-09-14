import * as THREE from 'three';
import type { VisPage } from '../../packages/sdk-browser/visibilityBuffer.ts';
import type { HizPage } from '../../packages/sdk-browser/hiz.ts';

export function cameraAt(z = 5, near = 0.1) {
  const cam = new THREE.PerspectiveCamera(55, 1, near, 100);
  cam.position.z = z;
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

export function quad(
  material: THREE.Material,
  min: number[],
  max: number[],
  clusterId: string,
): { page: VisPage & HizPage; geometry: THREE.BufferGeometry } {
  const z = (min[2] + max[2]) * 0.5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [min[0], min[1], z, max[0], min[1], z, max[0], max[1], z, min[0], max[1], z],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const page: VisPage & HizPage = {
    array: new Uint32Array([0, 1, 2, 0, 2, 3]),
    attributes: geometry.attributes,
    matrix: new THREE.Matrix4(),
    material,
    clusterId,
    min,
    max,
    url: clusterId,
  };
  return { page, geometry };
}
