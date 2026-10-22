import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { VOLUMETRIC_LIGHTMAP_VERSION } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import {
  parseVolumetricLightmap,
  type VolumetricLightmapData,
} from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'
import { fetchVerified } from '../../geometry/cluster/pages.ts'
import type { ByteMeter } from '../../geometry/cluster/byteMeter.ts'

/** The manifest's `volumetricLightmap` section, as far as a load needs it. */
interface VolumetricLightmapSection {
  readonly version: number
  readonly file: string
}

/** The section the manifest names, or none; another version throws `UNSUPPORTED_FORMAT`, one that
 *  names no file `INVALID_CACHE`. */
function sectionOf(section: unknown): VolumetricLightmapSection | undefined {
  if (section === undefined || section === null) return undefined
  const named = section as Partial<VolumetricLightmapSection>
  if (typeof named !== 'object' || named.version !== VOLUMETRIC_LIGHTMAP_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `volumetric lightmap: version ${String((named as { version?: unknown }).version)}, this engine reads ${VOLUMETRIC_LIGHTMAP_VERSION}`,
      {},
    )
  if (typeof named.file !== 'string')
    throw new EngineError('INVALID_CACHE', 'volumetric lightmap: the section names no file', {})
  return named as VolumetricLightmapSection
}

/**
 * THE SCENE'S VOLUMETRIC LIGHTMAP (`volumetric-lightmap.bin`, the manifest's `volumetricLightmap`
 * section): the file read once beside the manifest, verified against the size and digest the
 * manifest announces for it, and parsed (`parseVolumetricLightmap`). A cache whose job baked none has
 * neither the section nor the file, and none is read. The layers are views into the file's bytes,
 * which stay alive with them.
 */
export async function readVolumetricLightmap(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): Promise<VolumetricLightmapData | undefined> {
  const listed = metadata as ClusterManifest & {
    volumetricLightmap?: unknown
    files?: Record<string, { bytes: number; sha256: string }>
  }
  const section = sectionOf(listed.volumetricLightmap)
  if (!section) return undefined
  const announced = listed.files?.[section.file]
  if (!announced)
    throw new EngineError('INVALID_CACHE', `${section.file}: the manifest lists no such file`, {})
  const bytes = await fetchVerified(new URL(section.file, base).href, announced, signal, meter)
  return parseVolumetricLightmap(new Uint8Array(bytes))
}
