import type * as THREE from 'three';
import { meshes as objects } from './sceneMeshes.ts';
import { hostWorldTree } from './hostWorldTree.ts';
import { primitiveFinder } from './primitiveLookup.ts';
import { emptyWorldBox } from './hostWorldBounds.ts';
import { type ClusterManifest } from '../sdk-core/index.ts';
import { createBoxTransformLot, type BoxTransformLot } from './mathBatchRuntime.ts';
import { boxUnionCollector } from './mathBatchBoxes.ts';
import type { BackendContext } from './backendTypes.ts';

/**
 * Bornes monde des pages exactes d'une scène préparée : ce que le cadrage et la réplication lisent
 * d'une scène autonome, dont les bornes ne sont pas celles des géométries de l'hôte mais celles que
 * le compilateur a écrites page par page.
 *
 * Les matrices monde sont celles que LE MOTEUR calcule depuis les poses locales, en UNE passe sur le
 * sous-arbre (`hostWorldTree.ts`) comme le font les bornes de l'hôte : la scène de l'hôte n'est pas
 * remontée pour cela, et une pose écrite sans composition est reprise telle quelle. La
 * transformation et l'union sont celles du socle, donc celles de la référence, terme à terme.
 */

/** Une page du manifeste porte des bornes exactes, ou n'est qu'une approximation grossière. */
type ManifestPage = ClusterManifest['primitives'][number]['pages'][number];
const exacte = (item: ManifestPage) => (item.role ?? 'exact') === 'exact';

/** Les bornes du manifeste écrites à plat, six flottants à partir de `at`. */
function ecritPage(out: Float64Array, at: number, item: ManifestPage) {
  out[at] = item.min[0];
  out[at + 1] = item.min[1];
  out[at + 2] = item.min[2];
  out[at + 3] = item.max[0];
  out[at + 4] = item.max[1];
  out[at + 5] = item.max[2];
}

/** Pages exactes de `source` : la taille EXACTE que le lot de boîtes doit porter. */
function exactPagesCount(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
) {
  const primitiveOf = primitiveFinder(metadata.primitives);
  let n = 0;
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (primitive) for (const item of primitive.pages) if (exacte(item)) n++;
  }
  return n;
}

/** Le lot qui porte ces pages, ou `null` quand il n'y en a aucune : une réservation, pas une image. */
export async function exactPagesLot(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
) {
  const n = exactPagesCount(source, associations, metadata);
  return n ? await createBoxTransformLot(n) : null;
}

/** World bounds of the exact pages of every mesh of `source`, à plat `[minX..maxZ]` ; `onMissing`
 *  decides what a mesh without a prepared primitive does, and the mesh is skipped once it returns. */
export function exactPagesBounds(
  source: THREE.Object3D,
  associations: BackendContext['associations'],
  metadata: ClusterManifest,
  onMissing: (mesh: THREE.Mesh) => void,
  into = emptyWorldBox(),
  lot?: BoxTransformLot | null,
) {
  const primitiveOf = primitiveFinder(metadata.primitives);
  const union = boxUnionCollector(into, lot, exactPagesCount(source, associations, metadata));
  const mondes = hostWorldTree(source);
  for (const mesh of objects(source)) {
    const primitive = primitiveOf(associations.get(mesh));
    if (!primitive) {
      onMissing(mesh);
      continue;
    }
    // La matrice monde est celle que le moteur a calculée pour ce maillage, lue une fois.
    const world = mondes.world(mesh);
    for (const item of primitive.pages)
      if (exacte(item)) {
        ecritPage(union.boxes, union.at, item);
        union.pose(world);
      }
  }
  return union.ferme();
}
