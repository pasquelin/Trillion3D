import { verifiedRun } from './verified.ts'
import { unmetered, type ByteMeter } from './byteMeter.ts'
import { checked } from './checked.ts'
/**
 * Reads the cache object at `url` (`checked`) and hands its bytes back only when they are the ones
 * its manifest `announced` (`verifiedRun`): size then fingerprint, `corruptObject` otherwise. `meter`
 * counts its bytes as they arrive.
 */
export async function fetchVerified(
  url: string,
  announced: { bytes: number; sha256: string },
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
) {
  const buffer = await meter.read(await checked(url, signal), url).arrayBuffer()
  signal?.throwIfAborted()
  const [own] = await verifiedRun([{ ...announced, url, offset: 0 }], buffer)
  if (!own.bytes) throw own.refused
  return buffer
}
