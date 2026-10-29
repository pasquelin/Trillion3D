import { standInTexture } from '../../../gpu/core/standIns.ts'
import { VECTOR_FORMAT } from '../../../post/taa/velocityWgsl.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { CACHE_PDF_WORDS, radianceCacheFormats } from '../cache/cacheLayout.ts'

/** The stand-ins of the radiance cache's maps (`createStandIns`). */
export interface NoCache {
  final: GPUTextureView
  raw: GPUTextureView
  sky: GPUTextureView
  /** The lobes the screen probes add to: a few words nothing reads. */
  pdf: GPUBuffer
  /** The format the final map is stored in. */
  light: LightAtlasFormat
}

/** What the screen probes' kernels bind where what they read does not exist: the surfaces' vectors of an image that drew none — a texel
 *  of zero — and the radiance cache where there is none — texels of zero. Made for the
 *  device when first asked, given back by `dispose`. */
export function createStandIns() {
  let vectors: { device: GPUDevice; texture: GPUTexture; view: GPUTextureView } | undefined
  let cache:
    | { device: GPUDevice; light: LightAtlasFormat; made: { destroy(): void }[]; views: NoCache }
    | undefined
  const releaseCache = () => {
    for (const resource of cache?.made ?? []) resource.destroy()
    cache = undefined
  }
  return {
    vectors(device: GPUDevice) {
      if (!vectors || vectors.device !== device) {
        vectors?.texture.destroy()
        const texture = standInTexture(device, 'Trillion3D empty surface vectors', VECTOR_FORMAT)
        vectors = { device, texture, view: texture.createView() }
      }
      return vectors.view
    },
    cache(device: GPUDevice, light: LightAtlasFormat) {
      if (!cache || cache.device !== device || cache.light !== light) {
        releaseCache()
        const texture = (name: string, format: GPUTextureFormat) =>
          standInTexture(device, `Trillion3D empty radiance cache ${name}`, format)
        const formats = radianceCacheFormats(light)
        const pdf = device.createBuffer({
          label: 'Trillion3D empty radiance cache lobes',
          size: CACHE_PDF_WORDS * 4,
          usage: GPUBufferUsage.STORAGE,
        })
        const [final, raw, sky] = [
          texture('final', formats.final),
          texture('raw', formats.raw),
          texture('sky', formats.sky),
        ]
        cache = {
          device,
          light,
          made: [final, raw, sky, pdf],
          views: {
            final: final.createView(),
            raw: raw.createView(),
            sky: sky.createView(),
            pdf,
            light,
          },
        }
      }
      return cache.views
    },
    dispose() {
      vectors?.texture.destroy()
      vectors = undefined
      releaseCache()
    },
  }
}
