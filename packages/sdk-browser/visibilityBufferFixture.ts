import * as THREE from 'three';
import type { VisPage } from './visibilityBuffer.ts';

export function camera() {
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  cam.position.z = 5;
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

export function quadPages(
  material: THREE.Material,
  uv?: number[],
): { pages: VisPage[]; geometry: THREE.BufferGeometry } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3),
  );
  if (uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const pages: VisPage[] = [
    {
      array: new Uint32Array([0, 1, 2]),
      attributes: geometry.attributes,
      matrix: new THREE.Matrix4(),
      material,
      clusterId: '0/0/0',
    },
    {
      array: new Uint32Array([0, 2, 3]),
      attributes: geometry.attributes,
      matrix: new THREE.Matrix4(),
      material,
      clusterId: '0/0/1',
    },
  ];
  return { pages, geometry };
}

export function centerId(ids: Uint32Array, width: number, height: number) {
  return ids[((height / 2) | 0) * width + ((width / 2) | 0)];
}
