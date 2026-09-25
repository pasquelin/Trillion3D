import { GraphMesh } from '../../../packages/sdk-browser/src/host/graph/mesh.ts';
import { GraphGeometry } from '../../../packages/sdk-browser/src/host/graph/geometry.ts';
import { BufferAttribute } from '../../../packages/sdk-core/src/world/buffer/attribute.ts';
import type { HostMaterials } from '../../../packages/sdk-browser/src/host/resources.ts';
import { setGeometryBounds } from '../../../packages/sdk-browser/src/host/geometryBounds.ts';
import type { PageRec } from '../../../packages/sdk-browser/src/page/selection/selection.ts';
import { hashId } from '../../../packages/sdk-browser/src/diagnostic/colors.ts';
import { disposeTriangleGeometry } from '../../../packages/sdk-browser/src/diagnostic/triangleDiagnostic.ts';

/** One resident index buffer per page source, shared by every page read from it. */
export function pageIndexBuffers(pages: readonly PageRec[]) {
  const indexByUrl = new Map<string, BufferAttribute>();
  for (const rec of pages)
    if (rec.array && !indexByUrl.has(rec.url))
      indexByUrl.set(rec.url, new BufferAttribute(rec.array, 1));
  return indexByUrl;
}

/** Gives a page's geometry back: its diagnostic triangles, its attributes, then itself. */
export function disposePageGeometry(geometry: GraphGeometry) {
  disposeTriangleGeometry(geometry);
  for (const name of Object.keys(geometry.attributes)) geometry.deleteAttribute(name);
  geometry.dispose();
}

/** The whole-page mesh record of a diagnostic mode: built once per resident page, painted on
 *  every sync, handed to the draw owner — never to the host scene. */
export function createExactPagesAttachment(
  indexByUrl: Map<string, BufferAttribute>,
  materialFor: (rec: PageRec) => HostMaterials,
  paint: (mesh: GraphMesh, geometry: GraphGeometry, material: HostMaterials, salt?: number) => void,
) {
  const attach = (rec: PageRec) => {
    if (!rec.array) return;
    if (!indexByUrl.has(rec.url)) indexByUrl.set(rec.url, new BufferAttribute(rec.array, 1));
    const fresh = !rec.mesh;
    if (fresh) {
      const geometry = new GraphGeometry();
      geometry.attributes = { ...rec.attributes };
      geometry.setIndex(indexByUrl.get(rec.url)!);
      setGeometryBounds(geometry, rec.min, rec.max);
      const copy = new GraphMesh(geometry, materialFor(rec));
      copy.matrixAutoUpdate = false;
      copy.matrix.fromArray(rec.matrix.elements);
      copy.frustumCulled = false;
      copy.renderOrder = rec.renderOrder;
      copy.userData.clusterId = rec.clusterId;
      copy.userData.lodRole = rec.role ?? 'exact';
      rec.geometry = geometry;
      rec.mesh = copy;
    }
    const placed = rec.mesh!;
    if (!fresh) placed.material = materialFor(rec);
    placed.matrix.fromArray(rec.matrix.elements);
    if (rec.geometry) paint(placed, placed.geometry, placed.material, hashId(rec.clusterId));
  };
  return attach;
}
