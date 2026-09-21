import * as THREE from 'three';
import { asHostLibrary, type HostMaterials } from './hostResources.ts';
import { setGeometryBounds } from './threeBounds.ts';
import type { PageRec } from './pageSelection.ts';
import { hashId } from './backendCommon.ts';

/** The whole-page mesh record of a diagnostic mode: built once per resident page, painted on
 *  every sync, handed to the draw owner — never to the host scene. */
export function createExactPagesAttachment(
  indexByUrl: Map<string, THREE.BufferAttribute>,
  materialFor: (rec: PageRec) => HostMaterials,
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
    const fresh = !rec.mesh;
    if (fresh) {
      const geometry = new THREE.BufferGeometry();
      geometry.attributes = asHostLibrary<THREE.NormalBufferAttributes>({ ...rec.attributes });
      geometry.setIndex(indexByUrl.get(rec.url)!);
      setGeometryBounds(geometry, rec.min, rec.max);
      const copy = new THREE.Mesh(geometry, asHostLibrary<THREE.Material>(materialFor(rec)));
      copy.matrixAutoUpdate = false;
      copy.matrix.fromArray(rec.matrix.elements);
      copy.frustumCulled = false;
      copy.renderOrder = rec.renderOrder;
      copy.userData.clusterId = rec.clusterId;
      copy.userData.lodRole = rec.role ?? 'exact';
      rec.geometry = geometry;
      rec.mesh = copy;
    }
    const placed = asHostLibrary<THREE.Mesh>(rec.mesh);
    if (!fresh) placed.material = asHostLibrary<THREE.Material>(materialFor(rec));
    placed.matrix.fromArray(rec.matrix.elements);
    if (rec.geometry) paint(placed, placed.geometry, placed.material, hashId(rec.clusterId));
  };
  return attach;
}
