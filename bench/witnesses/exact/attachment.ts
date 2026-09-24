import * as THREE from 'three';
import {
  asHostLibrary,
  type HostMaterials,
} from '../../../packages/sdk-browser/src/host/resources.ts';
import { setGeometryBounds } from '../../../packages/sdk-browser/src/host/geometryBounds.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { hashId } from '../../../packages/sdk-browser/src/diagnostic/colors.ts';
import { disposeTriangleGeometry } from '../../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';
import { threeAttributes, threeMaterials } from '../three/fromGraph.ts';

/** One resident index buffer per page source, shared by every page read from it. */
export function pageIndexBuffers(pages: readonly PageRec[]) {
  const indexByUrl = new Map<string, THREE.BufferAttribute>();
  for (const rec of pages)
    if (rec.array && !indexByUrl.has(rec.url))
      indexByUrl.set(rec.url, new THREE.BufferAttribute(rec.array, 1));
  return indexByUrl;
}

/** Gives a page's geometry back: its diagnostic triangles, its attributes, then itself. */
export function disposePageGeometry(geometry: THREE.BufferGeometry) {
  disposeTriangleGeometry(geometry);
  for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
  geometry.dispose();
}

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
