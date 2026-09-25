// Batch F oracles, scene and page-source side: `packages/sdk-browser/src/world/scene/scene.ts:18-36` and
// `packages/sdk-browser/src/world/session/pageSources.ts:20-49` from before batch F, copied as-is.
import * as THREE from 'three';
import type { GraphMesh } from '../../../packages/sdk-browser/src/host/graph/mesh.ts';
import type {
  ClusterManifest,
  GeometryPageDescriptor,
  Page,
} from '../../../packages/sdk-core/src/index.ts';
import type { BackendContext } from '../../../packages/sdk-browser/src/backend/types.ts';
import { meshes as objects } from '../../../packages/sdk-browser/src/scene/meshes.ts';
import type { Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts';

/** A manifest page whose optional `geometry` descriptor is present. */
type PageWithGeometry = Page & { geometry: GeometryPageDescriptor };
const hasGeometry = (page: Page): page is PageWithGeometry => !!page.geometry;

/** `pagesBounds` before batch F: one `find` per mesh, three objects per exact page. */
export function referenceExactPagesBounds(
  source: Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  onMissing: (mesh: GraphMesh) => void,
  into = new THREE.Box3(),
) {
  // `meshes` resolved the host subtree before batch 8; the witness now resolves it
  // itself, since it reads `matrixWorld` — what it computes does not change by a bit.
  source.updateMatrixWorld(true);
  for (const sourceMesh of objects(source)) {
    const mesh = sourceMesh;
    const association = associations.get(mesh);
    const primitive = metadata.primitives.find(
      (item) =>
        item.mesh === association?.meshes && item.primitive === (association?.primitives ?? 0),
    );
    if (!primitive) {
      onMissing(mesh);
      continue;
    }
    for (const page of primitive.pages)
      if ((page.role ?? 'exact') === 'exact')
        into.union(
          new THREE.Box3(
            new THREE.Vector3().fromArray(page.min),
            new THREE.Vector3().fromArray(page.max),
          ).applyMatrix4(new THREE.Matrix4().fromArray(mesh.matrixWorld.elements)),
        );
  }
  return into;
}

/** `createExplorerPageSources` before batch F: four `flatMap` over every page of the manifest. */
export function referenceIndexManifestPages(metadata: ClusterManifest) {
  const pages = [
    ...new Map(metadata.primitives.flatMap((p) => p.pages).map((p) => [p.url, p])).values(),
  ];
  const geometryPages = [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.pages)
        .filter(hasGeometry)
        .map((page) => [page.geometry.url, page.geometry]),
    ).values(),
  ];
  const geometryUrls = new Set(geometryPages.map((page) => page.url));
  const pageIdByUrl = new Map<string, number>([
    ...pages.map((page): [string, number] => [page.url, page.id]),
    ...metadata.primitives
      .flatMap((p) => p.pages)
      .filter(hasGeometry)
      .map((page): [string, number] => [page.geometry.url, page.id]),
  ]);
  return { pages, geometryPages, geometryUrls, pageIdByUrl };
}

/** Streaming bundles before batch F: one more `flatMap`. */
export function referenceIndexManifestBundles(metadata: ClusterManifest) {
  return [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.streams?.pages ?? [])
        .map((bundle) => [bundle.url, bundle]),
    ).values(),
  ];
}
