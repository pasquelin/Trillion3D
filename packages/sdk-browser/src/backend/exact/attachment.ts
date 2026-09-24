import * as THREE from 'three';
import { asHostLibrary, type HostMaterials } from '../../host/resources.ts';
import { setGeometryBounds } from '../../host/geometryBounds.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { hashId } from '../../diagnostic/colors.ts';
import { threeAttributes, threeMaterials } from '../../host/three/fromGraph.ts';

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
      geometry.attributes = threeAttributes(rec.attributes);
      geometry.setIndex(indexByUrl.get(rec.url)!);
      setGeometryBounds(geometry, rec.min, rec.max);
      const copy = new THREE.Mesh(geometry, threeMaterials(materialFor(rec)));
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
    if (!fresh) placed.material = threeMaterials(materialFor(rec));
    placed.matrix.fromArray(rec.matrix.elements);
    if (rec.geometry) paint(placed, placed.geometry, placed.material, hashId(rec.clusterId));
  };
  return attach;
}
