import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  assertMeshCardsSection,
  parseMeshCards,
  type MeshCards,
} from '../../../../sdk-core/src/lighting/meshCardsFile.ts'
import type { ByteMeter } from '../../geometry/cluster/byteMeter.ts'
import { readSidecar } from '../../geometry/cluster/sidecarFile.ts'

/**
 * THE MESHES' CARDS OF A CACHE (`meshCards.bin`, the manifest's `meshCards` section): the file read
 * once beside the manifest (`readSidecar`), and parsed (`parseMeshCards`). A cache whose meshes keep no
 * card has neither the section nor the file, and none is read.
 */
export async function readMeshCards(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): Promise<MeshCards[] | undefined> {
  const file = await readSidecar(metadata, 'meshCards', assertMeshCardsSection, base, signal, meter)
  return file && parseMeshCards(new Uint8Array(file.bytes))
}
