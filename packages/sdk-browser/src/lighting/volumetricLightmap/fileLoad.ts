import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { assertSidecarSection } from '../../../../sdk-core/src/contracts/sidecarSection.ts'
import {
  VOLUMETRIC_LIGHTMAP_FIRST_VERSION,
  VOLUMETRIC_LIGHTMAP_VERSION,
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import {
  parseVolumetricLightmap,
  parseVolumetricLightmapCell,
  type VolumetricLightmapCell,
  type VolumetricLightmapCellData,
  type VolumetricLightmapData,
} from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'
import type { ByteMeter } from '../../geometry/cluster/byteMeter.ts'
import { ONE_REQUEST } from '../../geometry/cluster/checked.ts'
import type { ReadRange } from '../../geometry/cluster/ranged.ts'
import { readBase, readSidecar, verifiedPart } from '../../geometry/cluster/sidecarFile.ts'

/** The manifest's `volumetricLightmap` section: a section of a version no engine reads throws
 *  `UNSUPPORTED_FORMAT`, one that names no file `INVALID_CACHE`. A file of the first version has all
 *  its bricks in its layers; one of the second names the bytes always read (`baseBytes`,
 *  `baseSha256`) and keeps the finest bricks apart, by cell. */
const assertLightmapSection = (section: unknown) => {
  const first =
    (section as { version?: unknown } | null | undefined)?.version ===
    VOLUMETRIC_LIGHTMAP_FIRST_VERSION
  const read = first ? VOLUMETRIC_LIGHTMAP_FIRST_VERSION : VOLUMETRIC_LIGHTMAP_VERSION
  return assertSidecarSection(section, read, 'volumetric lightmap', false) as
    | (ReturnType<typeof assertSidecarSection> & { baseBytes?: number; baseSha256?: string })
    | undefined
}

/** A lightmap read and the reader of its cells (none where all its bricks are in its layers). */
export interface ReadLightmap {
  readonly data: VolumetricLightmapData
  /** The bricks of `cell`, read by a Range of the file and checked against its SHA-256. */
  readonly readCell?: (
    cell: VolumetricLightmapCell,
    signal?: AbortSignal,
  ) => Promise<VolumetricLightmapCellData>
}

/**
 * THE SCENE'S VOLUMETRIC LIGHTMAP (`volumetric-lightmap.bin`, the manifest's `volumetricLightmap`
 * section). A file with no cells is read once beside the manifest, verified against the size and
 * digest the manifest announces for it, and parsed (`parseVolumetricLightmap`). One with cells is
 * read as its always-loaded part alone, verified against `baseSha256`; its cells are read later,
 * each by a Range through the page cache's `readRange`, and checked against their own digest. A cache
 * whose job baked none has neither the section nor the file, and none is read. The layers are views
 * into the file's bytes, which stay alive with them.
 */
export async function readVolumetricLightmap(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
  readRange: ReadRange,
): Promise<ReadLightmap | undefined> {
  const section = assertLightmapSection(
    (metadata as unknown as { volumetricLightmap?: unknown }).volumetricLightmap,
  )
  if (!section) return undefined
  const url = new URL(section.file, base).href
  if (section.baseBytes === undefined || section.baseSha256 === undefined) {
    const file = await readSidecar(
      metadata,
      'volumetricLightmap',
      assertLightmapSection,
      base,
      signal,
      meter,
    )
    return file && { data: parseVolumetricLightmap(new Uint8Array(file.bytes)) }
  }
  const verify = (buffer: ArrayBuffer, bytes: number, sha256: string, what: string) =>
    verifiedPart(url, buffer, bytes, sha256, `volumetric lightmap: ${what}`)
  const buffer = await readBase(url, section.baseBytes, signal, meter)
  await verify(buffer, section.baseBytes, section.baseSha256, 'a corrupt base')
  const data = parseVolumetricLightmap(new Uint8Array(buffer))
  const sky = !!data.skyBentNormal
  const readCell = async (cell: VolumetricLightmapCell, own?: AbortSignal) => {
    const bytes = await readRange(url, cell.offset, cell.bytes, {
      attempts: ONE_REQUEST,
      signal: own ?? signal,
    })
    return parseVolumetricLightmapCell(
      await verify(bytes, cell.bytes, cell.sha256, 'a corrupt cell'),
      cell,
      sky,
    )
  }
  return { data, readCell: data.cells ? readCell : undefined }
}
