import type {
  ClusterManifest,
  GeometryPageDescriptor,
  Page,
  StreamBundle,
} from '../sdk-core/index.ts';

/**
 * Les pages du manifeste dédoublonnées par adresse, en un seul parcours. Quatre `flatMap` en
 * construisaient quatre copies complètes avant d'en dédoublonner trois. Les tables gardent, comme
 * `new Map(entrées)`, la dernière valeur d'une adresse à la place de sa première apparition, et
 * `values()` rend cet ordre d'apparition : l'ordre et le contenu ne bougent pas.
 */
export function indexManifestPages(metadata: ClusterManifest) {
  const pageByUrl = new Map<string, Page>();
  const geometryByUrl = new Map<string, GeometryPageDescriptor>();
  const geometryIdByUrl = new Map<string, number>();
  for (const primitive of metadata.primitives)
    for (const page of primitive.pages) {
      pageByUrl.set(page.url, page);
      if (page.geometry) {
        geometryByUrl.set(page.geometry.url, page.geometry);
        geometryIdByUrl.set(page.geometry.url, page.id);
      }
    }
  const pages = [...pageByUrl.values()];
  const pageIdByUrl = new Map<string, number>();
  for (const page of pages) pageIdByUrl.set(page.url, page.id);
  for (const [url, id] of geometryIdByUrl) pageIdByUrl.set(url, id);
  return {
    pages,
    geometryPages: [...geometryByUrl.values()],
    geometryUrls: new Set(geometryByUrl.keys()),
    pageIdByUrl,
  };
}

/** Les paquets de streaming du manifeste, dédoublonnés par adresse, dans leur ordre d'apparition. */
export function indexManifestBundles(metadata: ClusterManifest) {
  const bundleByUrl = new Map<string, StreamBundle>();
  for (const primitive of metadata.primitives)
    for (const bundle of primitive.streams?.pages ?? []) bundleByUrl.set(bundle.url, bundle);
  return [...bundleByUrl.values()];
}
