import { standInTexture } from '../../../gpu/core/standIns.ts'
import { VECTOR_FORMAT } from '../../../post/taa/velocityWgsl.ts'
import { RADIANCE_CACHE_FORMATS } from '../cache/cacheLayout.ts'

/** The stand-ins of the radiance cache's maps (`createStandIns`). */
export interface NoCache {
  final: GPUTextureView
  raw: GPUTextureView
  sky: GPUTextureView
}

/** What the screen probes' kernels bind where what they read does not exist: the surfaces' vectors of an image that drew none — a texel
 *  of zero — and the radiance cache where there is none — texels of zero. Made for the
 *  device when first asked, given back by `dispose`. */
export function createStandIns() {
  let vectors: { device: GPUDevice; texture: GPUTexture; view: GPUTextureView } | undefined
  let cache: { device: GPUDevice; made: { destroy(): void }[]; views: NoCache } | undefined
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
    cache(device: GPUDevice) {
      if (!cache || cache.device !== device) {
        releaseCache()
        const texture = (name: string, format: GPUTextureFormat) =>
          standInTexture(device, `Trillion3D empty radiance cache ${name}`, format)
        const [final, raw, sky] = [
          texture('final', RADIANCE_CACHE_FORMATS.final),
          texture('raw', RADIANCE_CACHE_FORMATS.raw),
          texture('sky', RADIANCE_CACHE_FORMATS.sky),
        ]
        cache = {
          device,
          made: [final, raw, sky],
          views: {
            final: final.createView(),
            raw: raw.createView(),
            sky: sky.createView(),
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
