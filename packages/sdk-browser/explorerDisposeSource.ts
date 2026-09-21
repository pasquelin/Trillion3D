import * as THREE from 'three';
import { materialTextures, meshes as objects } from './sceneMeshes.ts';

export function disposeSource(source: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  for (const mesh of objects(source)) {
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const texture of materialTextures(material)) textures.add(texture);
    }
  }
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    const image = t.source.data as { close?: () => void };
    image?.close?.();
  });
}
