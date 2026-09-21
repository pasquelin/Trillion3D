import type * as THREE from 'three';

/** Meshes of a subtree, in preorder. Nothing is lifted here: the world matrices the
 *  engine needs are its own (`hostWorldPlacements.ts`), and the host scene stays as it left it. */
export function meshes(source: THREE.Object3D) {
  const found: THREE.Mesh[] = [];
  source.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
}
/** The textures a host material carries, whatever their slot: what its renderer would sample. */
export function* materialTextures(material: THREE.Material): Generator<THREE.Texture> {
  for (const value of Object.values(material))
    if ((value as THREE.Texture | null)?.isTexture) yield value as THREE.Texture;
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
