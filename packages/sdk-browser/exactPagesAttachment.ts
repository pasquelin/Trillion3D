import * as THREE from 'three';
import { setGeometryBounds } from './threeBounds.ts';
import type { PageRec } from './pageSelection.ts';
import { hashId } from './backendCommon.ts';

export function createExactPagesAttachment(
  scene: THREE.Scene,
  indexByUrl: Map<string, THREE.BufferAttribute>,
  materialFor: (rec: PageRec) => THREE.Material | THREE.Material[],
  paint: (
    mesh: THREE.Mesh,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    salt?: number,
  ) => void,
) {
  const release = (rec: PageRec) => {
    if (rec.attached && rec.mesh) {
      scene.remove(rec.mesh);
      rec.attached = false;
    }
  };
  const attach = (rec: PageRec, addToScene = true) => {
    if (!rec.array) return;
    if (!indexByUrl.has(rec.url)) indexByUrl.set(rec.url, new THREE.BufferAttribute(rec.array, 1));
    if (!rec.mesh) {
      const geometry = new THREE.BufferGeometry();
      geometry.attributes = { ...rec.attributes };
      geometry.setIndex(indexByUrl.get(rec.url)!);
      setGeometryBounds(geometry, rec.min, rec.max);
      const copy = new THREE.Mesh(geometry, materialFor(rec));
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(rec.matrix);
      copy.frustumCulled = false;
      copy.renderOrder = rec.renderOrder;
      copy.userData.clusterId = rec.clusterId;
      copy.userData.lodRole = rec.role ?? 'exact';
      rec.geometry = geometry;
      rec.mesh = copy;
    } else rec.mesh.material = materialFor(rec);
    rec.mesh!.matrix.copy(rec.matrix);
    if (rec.mesh && rec.geometry)
      paint(rec.mesh, rec.geometry, rec.mesh.material, hashId(rec.clusterId));
    if (addToScene && !rec.attached) {
      scene.add(rec.mesh!);
      rec.attached = true;
    }
  };
  return { release, attach };
}
