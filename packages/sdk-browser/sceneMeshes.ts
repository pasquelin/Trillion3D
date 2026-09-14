import * as THREE from 'three';

export function meshes(source: THREE.Object3D) {
  const found: THREE.Mesh[] = [];
  source.updateMatrixWorld(true);
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
}
export function geometryBytes(geometry: THREE.BufferGeometry, seen: Set<ArrayBufferView>) {
  let bytes = 0;
  const index = geometry.getIndex();
  if (index && !seen.has(index.array)) {
    seen.add(index.array);
    bytes += index.array.byteLength;
  }
  for (const name in geometry.attributes) {
    const attr = geometry.attributes[name];
    if (!attr || seen.has(attr.array)) continue;
    seen.add(attr.array);
    bytes += attr.array.byteLength;
  }
  return bytes;
}
