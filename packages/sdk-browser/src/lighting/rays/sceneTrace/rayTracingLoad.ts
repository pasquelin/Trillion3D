import type { ClusterManifest } from '../../../../../sdk-core/src/contracts/geometry.ts'
import {
  assertRayTracingSection,
  parseRayTracing,
  type RayTracing,
} from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import type { ByteMeter } from '../../../geometry/cluster/byteMeter.ts'
import { readSidecar } from '../../../geometry/cluster/sidecarFile.ts'

/**
 * THE ACCELERATION STRUCTURES OF A CACHE (`rayTracing.bin`, the manifest's `rayTracing` section):
 * the primitives' and the world's HLOD actors', the file read once beside the manifest
 * (`readSidecar`), and parsed (`parseRayTracing`). A cache whose primitives and actors built none
 * has neither the section nor the file, and none is read.
 */
export async function readRayTracing(
  metadata: ClusterManifest,
  base: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): Promise<RayTracing | undefined> {
  const file = await readSidecar(
    metadata,
    'rayTracing',
    assertRayTracingSection,
    base,
    signal,
    meter,
  )
  return file && parseRayTracing(new Uint8Array(file.bytes))
}
