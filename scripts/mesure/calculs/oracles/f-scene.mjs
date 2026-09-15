// Oracles du lot F, côté scène et sources de pages : `explorerScene.ts:18-36` et
// `explorerPageSources.ts:20-49` d'avant le lot F, recopiés tels quels.
import * as THREE from 'three';
import { meshes as objects } from '../../../../packages/sdk-browser/sceneMeshes.ts';

/** `exactPagesBounds` avant le lot F : un `find` par maillage, trois objets par page exacte. */
export function referenceExactPagesBounds(
  source,
  associations,
  metadata,
  onMissing,
  into = new THREE.Box3(),
) {
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

/** `createExplorerPageSources` avant le lot F : quatre `flatMap` sur toutes les pages du manifeste. */
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

/** Les paquets de streaming avant le lot F : un `flatMap` de plus. */
export function referenceIndexManifestBundles(metadata) {
  return [
    ...new Map(
      metadata.primitives
        .flatMap((p) => p.streams?.pages ?? [])
        .map((bundle) => [bundle.url, bundle]),
    ).values(),
  ];
}
