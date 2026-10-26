import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { ByteMeter } from './byteMeter.ts'
import { checked } from './checked.ts'
import { fetchVerified } from './pages.ts'
import { verifiedRun } from './verified.ts'

/**
 * A SIDECAR FILE OF A CACHE (`meshCards.bin`, `distanceFields.bin`, `volumetric-lightmap.bin`, the voxel
 * levels): the file the manifest's section `key` announces, read once beside the manifest at `base` and
 * verified against the size and digest the manifest's `files` lists for it (`fetchVerified`), with the
 * section `assertSection` accepts (the format's own check, which throws on a section it cannot read).
 * None for a cache whose manifest has no such section: a scene that builds none writes neither.
 */
export async function readSidecar<S extends { readonly file: string }>(
  metadata: ClusterManifest,
  key: string,
  assertSection: (section: unknown) => S | undefined,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): Promise<{ section: S; bytes: ArrayBuffer } | undefined> {
  const listed = metadata as ClusterManifest &
    Readonly<Record<string, unknown>> & {
      files?: Record<string, { bytes: number; sha256: string }>
    }
  const section = assertSection(listed[key])
  if (!section) return undefined
  const announced = listed.files?.[section.file]
  if (!announced)
    throw new EngineError('INVALID_CACHE', `${section.file}: the manifest lists no such file`, {})
  const bytes = await fetchVerified(new URL(section.file, base).href, announced, signal, meter)
  return { section, bytes }
}

/** The first `bytes` of the file at `url`, by a Range: a server that answers the whole file gives
 *  its first bytes, which the check then is made on. */
export async function readBase(
  url: string,
  bytes: number,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
) {
  const response = await checked(url, signal, undefined, { Range: `bytes=0-${bytes - 1}` })
  const buffer = await meter.read(response, url).arrayBuffer()
  signal?.throwIfAborted()
  return buffer.byteLength === bytes ? buffer : buffer.slice(0, bytes)
}

/** The `bytes` of a part of the file at `url` that `buffer` holds, checked against the `sha256` its
 *  manifest section announces for it; `what` names it when it is corrupt. */
export async function verifiedPart(
  url: string,
  buffer: ArrayBuffer,
  bytes: number,
  sha256: string,
  what: string,
) {
  const [run] = await verifiedRun([{ url, bytes, sha256, offset: 0 }], buffer)
  if (!run.bytes) throw run.refused ?? new EngineError('INVALID_CACHE', what, { url })
  return run.bytes
}
