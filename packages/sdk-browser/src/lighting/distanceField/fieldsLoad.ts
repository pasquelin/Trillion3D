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
import { fetchVerified } from '../../geometry/cluster/pages.ts'
import { readBase, readSidecar, verifiedPart } from '../../geometry/cluster/sidecarFile.ts'
import {
  DISTANCE_FIELD_MIPS,
  DISTANCE_FIELD_VERSION,
} from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'

/** An object of the cache: its URL from the manifest, its size and its SHA-256. */
type CacheObject = { url: string; bytes: number; sha256: string }

/** The section's objects holding the mips' data (`mips`, version 3), or its parts (`baseBytes`,
 *  `baseSha256`, `mipSha256`, version 2), none for a file of a compiler that wrote neither. */
type Parts = {
  version: number
  file: string
  bytes: number
  mips?: unknown
  baseBytes?: number
  baseSha256?: string
  mipSha256?: readonly string[]
}

/**
 * THE MESHES' DISTANCE FIELDS OF A CACHE (`distanceFields.bin`, the manifest's `distanceFields`
 * section): megabytes of bricks the view mostly never asks for, read by parts.
 *
 * - Each mip an object of its own (`mips`, version 3): the file, its head and records, is read once
 *   beside the manifest (`readSidecar`), each mip's object whole when the atlas takes the mip in
 *   (`DistanceFieldMip.read`), checked against its size and digest; mips that share an object
 *   share one read.
 * - The mips in the file (version 2): its head and records (`baseBytes`) are read once, checked
 *   against `baseSha256`, each mip by a Range through the page cache's `readRange`, checked against
 *   its `mipSha256`; a section without them has its file read whole.
 *
 * A cache whose meshes built no field has neither the section nor the file, and none is read.
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
  const mips = section.version === DISTANCE_FIELD_VERSION ? objectsOf(section.mips) : undefined
  const { baseBytes, baseSha256, mipSha256 } = section
  if (mips || baseBytes === undefined || baseSha256 === undefined || !mipSha256) {
    const file = await readSidecar(
      metadata,
      'distanceFields',
      assertDistanceFieldSection,
      base,
      signal,
      meter,
    )
    if (!file) return undefined
    const bytes = new Uint8Array(file.bytes)
    return mips ? fromObjects(bytes, mips, base, signal, meter) : parseDistanceFields(bytes)
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

/** The objects of a section of version 3, each `{url, bytes, sha256}`, or `INVALID_CACHE`. */
function objectsOf(mips: unknown): readonly CacheObject[] {
  const named = (o: unknown): o is CacheObject => {
    const { url, bytes, sha256 } = (o ?? {}) as Partial<CacheObject>
    return typeof url === 'string' && typeof sha256 === 'string' && Number.isInteger(bytes)
  }
  if (!Array.isArray(mips) || !mips.every(named))
    throw new EngineError(
      'INVALID_CACHE',
      'distance fields: the section names no object for its mips',
      {},
    )
  return mips
}

/** The fields of the file `bytes`, each mip read from its object of `mips` (record order) when
 *  asked: mips that share an object asked together share one read, and none is kept once it
 *  settles, so the atlas frees the bytes it is done with. A section naming more or fewer objects
 *  than the file has mips throws `INVALID_CACHE` at once. */
function fromObjects(
  bytes: Uint8Array,
  mips: readonly CacheObject[],
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
) {
  const reads = new Map<string, Promise<ArrayBuffer>>()
  const read = (rank: number) => {
    const object = mips[rank]
    const url = new URL(object.url, base).href
    let once = reads.get(url)
    if (!once) {
      const settled = () => reads.delete(url)
      once = fetchVerified(url, object, signal, meter)
      once.then(settled, settled)
      reads.set(url, once)
    }
    return once
  }
  const fields = parseDistanceFields(bytes, { read })
  if (fields.length * DISTANCE_FIELD_MIPS !== mips.length)
    throw new EngineError('INVALID_CACHE', 'distance fields: not an object for each mip', {
      mips: mips.length,
    })
  return fields
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
