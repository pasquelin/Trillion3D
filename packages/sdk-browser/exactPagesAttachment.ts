import * as THREE from 'three';
import { setGeometryBounds } from './threeBounds.ts';
import type { PageRec } from './pageSelection.ts';
import { hashId } from './backendCommon.ts';

/** The whole-page mesh record of a diagnostic mode: built once per resident page, painted on
 *  every sync, handed to the draw owner — never to the host scene. */
export function createExactPagesAttachment(
  indexByUrl: Map<string, THREE.BufferAttribute>,
  materialFor: (rec: PageRec) => THREE.Material | THREE.Material[],
  paint: (
    mesh: THREE.Mesh,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    salt?: number,
  ) => void,
) {
  const attach = (rec: PageRec) => {
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
  };
  return attach;
}
