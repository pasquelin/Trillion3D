import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { ByteMeter } from '../../geometry/cluster/byteMeter.ts'
import { readSidecar } from '../../geometry/cluster/sidecarFile.ts'
import {
  assertSparseVolumesSection,
  parseSparseVolumeFrame,
  type SparseVolumeEntry,
  type SparseVolumeFrame,
} from './sparseVolumeFile.ts'

/** The volumes of a cache: each entry of the manifest's section with its frames, read when asked. */
export interface SparseVolumes {
  readonly volumes: readonly SparseVolumeEntry[]
  /** The volume the node `node` of the scene cites. */
  volumeOfNode(node: number): SparseVolumeEntry | undefined
  /** Frame `frame` of `volume`, parsed once and kept. */
  frame(volume: SparseVolumeEntry, frame: number): SparseVolumeFrame
}

/** The volumes of a cache, read the first time it is called and kept, a rejection too. */
export type SparseVolumesReader = () => Promise<SparseVolumes>

/**
 * THE VOLUMES OF A CACHE (`sparseVolumes.bin`, the manifest's `sparseVolumes` section): the file read
 * once beside the manifest (`readSidecar`) at the first call of the reader, which the frame makes
 * only while a heterogeneous volume is declared. A cache whose scene cites no volume has neither the
 * section nor the file: no reader, and nothing is read.
 */
export function sparseVolumesReader(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): SparseVolumesReader | undefined {
  if ((metadata as unknown as { sparseVolumes?: unknown }).sparseVolumes === undefined)
    return undefined
  let reading: Promise<SparseVolumes> | undefined
  return () =>
    (reading ??= readSidecar(
      metadata,
      'sparseVolumes',
      assertSparseVolumesSection,
      base,
      signal,
      meter,
    ).then((file) => {
      const bytes = new Uint8Array(file!.bytes)
      const parsed = new Map<string, SparseVolumeFrame>()
      return {
        volumes: file!.section.volumes,
        volumeOfNode: (node) => file!.section.volumes.find((volume) => volume.node === node),
        frame(volume, frame) {
          const where = volume.frames[frame]
          const key = `${volume.node}:${frame}`
          let found = parsed.get(key)
          if (!found) {
            found = parseSparseVolumeFrame(bytes.subarray(where.offset, where.offset + where.bytes))
            parsed.set(key, found)
          }
          return found
        },
      }
    }))
}
