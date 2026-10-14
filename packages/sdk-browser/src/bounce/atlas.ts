import { PROBE_FLOATS } from '../../../sdk-core/src/bounce/contracts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * THE BOUNCE ATLAS: the probe cascades are a float texture read with `textureLoad` and written by
 * their compute pass as a storage texture, not a storage buffer: the deferred lighting holds its
 * storage buffers within the eight WebGPU guarantees. `rgba32float` keeps every value bit for bit.
 * A probe sits at its column, row and layer (`probeAtlasExtent`); no entry is ever dropped: a size
 * the device cannot hold is refused before anything is made (`limits.ts`).
 */
export const BOUNCE_ATLAS_FORMAT: GPUTextureFormat = 'rgba32float'

/** Vectors of a probe: its texels in the atlas. */
export const PROBE_TEXELS = PROBE_FLOATS / 4

/**
 * The probe cascades' atlas: one layer per cascade level, each exactly `side³` probes — `side`
 * probes of `PROBE_TEXELS` texels a row, `side²` rows —, so a level is cleared alone (a render
 * pass on its layer) and the atlas weighs the bytes the buffer did.
 */
export const probeAtlasExtent = (side: number, levels: number): [number, number, number] => [
  Math.max(1, side * PROBE_TEXELS),
  Math.max(1, side * side),
  Math.max(1, levels),
]

/** Bytes of an `rgba32float` atlas of this extent. */
export const atlasBytes = ([width, height, layers = 1]: readonly number[]) =>
  width * height * layers * 16

/** Vector `k` of the probe whose first texel is `probe` — column, row, layer (`probeAddress`,
 *  `gridWgsl.ts`) —: the texel `k` columns further on its row, read with no division. */
export const PROBE_AT_WGSL = wgslBlock(
  'PROBE_AT_WGSL',
  [],
  `fn probeAt(probe:vec3u,k:u32)->vec4f{
 return textureLoad(probes,vec2u(probe.x+k,probe.y),probe.z,0);
}`,
)
