import { unmetered, type ByteMeter } from '../../geometry/cluster/byteMeter.ts'
import { optionalFile } from '../../geometry/cluster/checked.ts'
import { decodeLightProfile, isCompiledProfile, lightProfileUrl } from './profileCodec.ts'
import type { LightProfileData } from './profileCodec.ts'

/**
 * Reads the profile file `id` of the cache at `base`; none for an id the compiler does not name or a
 * file the cache lacks (the light then keeps its plain shape and intensity), a file that does not
 * read refused as every cache file is.
 */
async function loadLightProfile(
  base: string,
  id: string,
  signal?: AbortSignal,
  meter: ByteMeter = unmetered,
): Promise<LightProfileData | undefined> {
  if (!isCompiledProfile(id)) return undefined
  const url = lightProfileUrl(base, id)
  const response = await optionalFile(url, signal)
  if (!response) return undefined
  return decodeLightProfile(await meter.read(response, url).arrayBuffer())
}

/** The reader of a cache's light profiles: a profile id to its data, none for a file the cache lacks. */
export type LightProfileReader = (id: string) => Promise<LightProfileData | undefined>

/** The reader of the profiles of the cache at `base` (`loadLightProfile`), cut when `signal` aborts. */
export const lightProfileReader =
  (base: string, signal?: AbortSignal, meter?: ByteMeter): LightProfileReader =>
  (id) =>
    loadLightProfile(base, id, signal, meter)
