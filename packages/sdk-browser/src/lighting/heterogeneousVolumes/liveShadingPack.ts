/** The light rank of a pass that takes every light. */
export const HV_ALL_LIGHTS = 0xffff_ffff

/** The bytes of the buffer of a volume: two matrices, then eight vectors, the last two of words. */
export const HV_VOLUME_BYTES = (16 * 2 + 4 * 8) * 4

/** What the buffer of a volume is made of. */
export interface HvVolumeData {
  /** Column-major, the volume's own space to the world's, and the inverse. */
  readonly localToWorld: readonly number[]
  readonly worldToLocal: readonly number[]
  /** The local bounds: the centre and the half size. */
  readonly boundsOrigin: readonly [number, number, number]
  readonly boundsExtent: readonly [number, number, number]
  /** The voxels of the volume. */
  readonly resolution: readonly [number, number, number]
  /** The kinds of light that light the volume: bit 0 the directional light, 1 the point lights, 2 the spot lights, 3 the rectangle lights. */
  readonly lightKinds: number
  /** Whether the height fog and the volumetric fog are applied to the volume. */
  readonly heightFog: boolean
  readonly volumetricFog: boolean
  /** The voxels of the lighting cache, and the shadow bias factor of the volume. */
  readonly cacheResolution: readonly [number, number, number]
  readonly shadowBiasFactor: number
  /** The step size and factor, the shadow step size and factor. */
  readonly step: readonly [number, number, number, number]
  /** The farthest view ray, the farthest shadow ray, the most steps, the jitter (0 or 1). */
  readonly limits: readonly [number, number, number, number]
  /** Emission and transmittance applied, direct lighting applied, shadow transmittance applied, the
   *  mode of the fog's in-scattering. */
  readonly flags: readonly [number, number, number, number]
  /** The one light a pass of the transmittance cache is for (its rank), or `HV_ALL_LIGHTS`. */
  readonly lightRank: number
  /** The indirect light: the mode (0 none, 1 in the lighting cache, 2 at each step) and its factor. */
  readonly indirectMode: number
  readonly indirectFactor: number
  /** Whether the volume has an occlusion texture to read (`HV_AMBIENT_OCCLUSION_WGSL`). */
  readonly ambientOcclusion?: boolean
  /** Whether the volume holds out (it leaves its opacity in the holdout, no light), and whether the pass reads the existence mask. */
  readonly holdout?: boolean
  readonly existence?: boolean
  /** Whether the march writes the beer map of the camera (the volumes are composited with the translucency). */
  readonly cameraMap?: boolean
}
/** Writes `data` as the bytes `HvVolume` reads. */
export function packVolume(data: HvVolumeData, out = new ArrayBuffer(HV_VOLUME_BYTES)) {
  const floats = new Float32Array(out)
  const words = new Uint32Array(out)
  floats.set(data.localToWorld, 0)
  floats.set(data.worldToLocal, 16)
  const vectors: (readonly number[])[] = [
    [...data.boundsOrigin, data.heightFog ? 1 : 0],
    [...data.boundsExtent, data.volumetricFog ? 1 : 0],
    [...data.resolution, data.lightKinds],
    [...data.cacheResolution, data.shadowBiasFactor],
    data.step,
    data.limits,
  ]
  vectors.forEach((vector, i) => floats.set(vector, 32 + i * 4))
  words.set(data.flags, 32 + vectors.length * 4)
  words[32 + vectors.length * 4 + 4] = data.lightRank
  words[32 + vectors.length * 4 + 5] = data.indirectMode
  floats[32 + vectors.length * 4 + 6] = data.indirectFactor
  words[32 + vectors.length * 4 + 7] =
    (data.ambientOcclusion ? 1 : 0) |
    (data.holdout ? 2 : 0) |
    (data.existence ? 4 : 0) |
    (data.cameraMap ? 8 : 0)
  return out
}
