import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import {
  assertDistanceFieldSection,
  parseDistanceFields,
  type MeshDistanceField,
} from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { ByteMeter } from '../../geometry/cluster/byteMeter.ts'
import { ONE_REQUEST } from '../../geometry/cluster/checked.ts'
import type { ReadRange } from '../../geometry/cluster/ranged.ts'
import { readBase, readSidecar, verifiedPart } from '../../geometry/cluster/sidecarFile.ts'

/** The section's parts (`baseBytes`, `baseSha256`, `mipSha256`), none for a file of a compiler that
 *  wrote none. */
type Parts = {
  file: string
  bytes: number
  baseBytes?: number
  baseSha256?: string
  mipSha256?: readonly string[]
}

/**
 * THE MESHES' DISTANCE FIELDS OF A CACHE (`distanceFields.bin`, the manifest's `distanceFields`
 * section). A file that is megabytes of bricks the view mostly never asks for is read by parts: its
 * head and records (`baseBytes`) once, checked against `baseSha256`, and each mip's table and
 * bricks only when the atlas takes the mip in (`DistanceFieldMip.read`), by a Range through the page
 * cache's `readRange`, checked against that mip's `mipSha256`. A section without parts has its file
 * read once beside the manifest (`readSidecar`). A cache whose meshes built no field has neither
 * the section nor the file, and none is read.
 */
export async function readDistanceFields(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
  readRange: ReadRange,
): Promise<MeshDistanceField[] | undefined> {
  const section = assertDistanceFieldSection(
    (metadata as unknown as { distanceFields?: unknown }).distanceFields,
  ) as Parts | undefined
  if (!section) return undefined
  const { baseBytes, baseSha256, mipSha256 } = section
  if (baseBytes === undefined || baseSha256 === undefined || !mipSha256) {
    const file = await readSidecar(
      metadata,
      'distanceFields',
      assertDistanceFieldSection,
      base,
      signal,
      meter,
    )
    return file && parseDistanceFields(new Uint8Array(file.bytes))
  }
  const url = new URL(section.file, base).href
  const verify = (buffer: ArrayBuffer, bytes: number, sha256: string, what: string) =>
    verifiedPart(url, buffer, bytes, sha256, `distance fields: ${what}`)
  const head = await readBase(url, baseBytes, signal, meter)
  await verify(head, baseBytes, baseSha256, 'a corrupt head')
  const read = async (rank: number, offset: number, length: number) => {
    const sha256 = mipSha256[rank]
    if (!sha256)
      throw new EngineError('INVALID_CACHE', 'distance fields: a mip with no digest', { url })
    const buffer = await readRange(url, offset, length, { attempts: ONE_REQUEST, signal })
    await verify(buffer, length, sha256, 'a corrupt mip')
    return buffer
  }
  return parseDistanceFields(new Uint8Array(head), { fileBytes: section.bytes, read })
}

/** The compiled meshes that have a field, the ones whose page records carry `PageRec.distanceField`
 *  (`geometry/selection/collect.ts`); none for a cache with no field. An HLOD cell's field
 *  (`MeshDistanceField.hlodCell`) names a cell, not a mesh: it marks no page. */
export const distanceFieldMeshes = (
  fields: readonly MeshDistanceField[] | undefined,
): ReadonlySet<number> | undefined => {
  const meshes = fields?.filter((field) => !field.hlodCell)
  return meshes?.length ? new Set(meshes.map((field) => field.mesh)) : undefined
}
