import type { ClusterManifest } from '../../../sdk-core/src/contracts/geometry.ts'
import {
  assertHairStrandsSection,
  parseHairStrands,
  type HairStrands,
} from '../../../sdk-core/src/hair/hairStrandsFile.ts'
import type { ByteMeter } from '../geometry/cluster/byteMeter.ts'
import { readSidecar } from '../geometry/cluster/sidecarFile.ts'

/** The strands of a cache, read the first time it is called and kept, a rejection too: the read
 *  outlives the strands being switched off and on. */
export type HairStrandsReader = () => Promise<HairStrands>

/**
 * THE STRANDS OF A CACHE (`hairStrands.bin`, the manifest's `hairStrands` section): the file read once
 * beside the manifest (`readSidecar`) and parsed (`parseHairStrands`), at the first call of the
 * reader, which the frame makes only while the strands are on (`hairStrands`). A cache whose scene
 * carries no curves has neither the section nor the file: no reader, and nothing is read.
 */
export function hairStrandsReader(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): HairStrandsReader | undefined {
  if ((metadata as unknown as { hairStrands?: unknown }).hairStrands === undefined) return undefined
  let reading: Promise<HairStrands> | undefined
  return () =>
    (reading ??= readSidecar(
      metadata,
      'hairStrands',
      assertHairStrandsSection,
      base,
      signal,
      meter,
    ).then((file) => parseHairStrands(new Uint8Array(file!.bytes))))
}
