import { standInBuffer, standInTexture } from '../../../gpu/core/standIns.ts'
import { VECTOR_FORMAT } from '../../../post/taa/velocityWgsl.ts'

/** The stand-ins of the radiance cache's maps (`createStandIns`). */
export interface NoCache {
  final: GPUTextureView
  raw: GPUTextureView
  sky: GPUTextureView
  tags: GPUBuffer
  pdf: GPUBuffer
}

/** What the screen probes' kernels bind where what they read does not exist: the surfaces' vectors of an image that drew none — a texel
 *  of zero — and the radiance cache where there is none — texels and tags of zero, importance functions nothing reads. Made for the
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
        const buffer = (name: string) =>
          standInBuffer(
            device,
            `Trillion3D empty radiance cache ${name}`,
            16,
            GPUBufferUsage.STORAGE,
          )
        const [final, raw, sky] = [
          texture('final', 'r32uint'),
          texture('raw', 'rg32uint'),
          texture('sky', 'r32float'),
        ]
        const [tags, pdf] = [buffer('tags'), buffer('importance')]
        cache = {
          device,
          made: [final, raw, sky, tags, pdf],
          views: {
            final: final.createView(),
            raw: raw.createView(),
            sky: sky.createView(),
            tags,
            pdf,
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
