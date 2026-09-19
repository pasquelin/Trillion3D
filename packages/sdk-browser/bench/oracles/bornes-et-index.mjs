// Batch F oracles, scene and page-source side: `explorerScene.ts:18-36` and
// `explorerPageSources.ts:20-49` from before batch F, copied as-is.
import * as THREE from 'three';
import { meshes as objects } from '../../sceneMeshes.ts';

/** `exactPagesBounds` before batch F: one `find` per mesh, three objects per exact page. */
export function referenceExactPagesBounds(
  source,
  associations,
  metadata,
  onMissing,
  into = new THREE.Box3(),
) {
  // `meshes` resolved the host subtree before batch 8; the witness now resolves it
  // itself, since it reads `matrixWorld` — what it computes does not change by a bit.
  source.updateMatrixWorld(true);
  for (const mesh of objects(source)) {
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
          ).applyMatrix4(mesh.matrixWorld),
        );
  }
  return into;
}

/** `createExplorerPageSources` before batch F: four `flatMap` over every page of the manifest. */
export function referenceIndexManifestPages(metadata) {
  const pages = [
    ...new Map(metadata.primitives.flatMap((p) => p.pages).map((p) => [p.url, p])).values(),
  ];
  const geometryPages = [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.pages)
        .filter((page) => !!page.geometry)
        .map((page) => [page.geometry.url, page.geometry]),
    ).values(),
  ];
  const geometryUrls = new Set(geometryPages.map((page) => page.url));
  const pageIdByUrl = new Map([
    ...pages.map((page) => [page.url, page.id]),
    ...metadata.primitives
      .flatMap((p) => p.pages)
      .filter((page) => !!page.geometry)
      .map((page) => [page.geometry.url, page.id]),
  ]);
  return { pages, geometryPages, geometryUrls, pageIdByUrl };
}

/** Streaming bundles before batch F: one more `flatMap`. */
export function referenceIndexManifestBundles(metadata) {
  return [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.streams?.pages ?? [])
        .map((bundle) => [bundle.url, bundle]),
    ).values(),
  ];
}
