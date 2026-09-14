import * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { triangleSalt } from './triangleDiagnostic.ts';

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
  const minPoint = new THREE.Vector3(),
    maxPoint = new THREE.Vector3();
  const release = (rec: PageRec) => {
    if (rec.attached && rec.mesh) {
      scene.remove(rec.mesh);
      rec.attached = false;
    }
  };
  const attach = (rec: PageRec) => {
    if (!rec.array) return;
    if (!indexByUrl.has(rec.url)) indexByUrl.set(rec.url, new THREE.BufferAttribute(rec.array, 1));
    if (!rec.mesh) {
      const geometry = new THREE.BufferGeometry();
      geometry.attributes = { ...rec.attributes };
      geometry.setIndex(indexByUrl.get(rec.url)!);
      minPoint.fromArray(rec.min);
      maxPoint.fromArray(rec.max);
      geometry.boundingBox = new THREE.Box3().set(minPoint, maxPoint);
      geometry.boundingSphere = new THREE.Sphere();
      geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
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
      paint(rec.mesh, rec.geometry, rec.mesh.material, triangleSalt(rec.clusterId));
    if (!rec.attached) {
      scene.add(rec.mesh!);
      rec.attached = true;
    }
  };
  return { release, attach };
}
