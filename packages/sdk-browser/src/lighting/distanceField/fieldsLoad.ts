import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import {
  assertDistanceFieldSection,
  parseDistanceFields,
  type MeshDistanceField,
} from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { fetchVerified } from '../../geometry/cluster/pages.ts'
import type { ByteMeter } from '../../geometry/cluster/byteMeter.ts'

/**
 * THE MESHES' DISTANCE FIELDS OF A CACHE (`distanceFields.bin`, the manifest's `distanceFields`
 * section): the file read once beside the manifest, verified against the size and digest the
 * manifest announces for it, and parsed (`parseDistanceFields`). A cache whose meshes built no
 * field has neither the section nor the file, and none is read. The bricks of the fields returned
 * are views into the file's bytes, which stay alive with them.
 */
export async function readDistanceFields(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): Promise<MeshDistanceField[] | undefined> {
  const listed = metadata as ClusterManifest & {
    distanceFields?: unknown
    files?: Record<string, { bytes: number; sha256: string }>
  }
  const section = assertDistanceFieldSection(listed.distanceFields)
  if (!section) return undefined
  const announced = listed.files?.[section.file]
  if (!announced)
    throw new EngineError('INVALID_CACHE', `${section.file}: the manifest lists no such file`, {})
  const bytes = await fetchVerified(new URL(section.file, base).href, announced, signal, meter)
  return parseDistanceFields(new Uint8Array(bytes))
}

/** The compiled meshes that have a field, the ones whose page records carry `PageRec.distanceField`
 *  (`geometry/selection/collect.ts`); none for a cache with no field. */
export const distanceFieldMeshes = (
  fields: readonly MeshDistanceField[] | undefined,
): ReadonlySet<number> | undefined =>
  fields?.length ? new Set(fields.map((field) => field.mesh)) : undefined
