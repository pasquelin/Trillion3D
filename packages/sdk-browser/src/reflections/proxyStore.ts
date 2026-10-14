import { STORE_LAYERS, storeBytes } from '../bounce/runtimeLayout.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { createFrontLayer, frontLayerBytes, type FrontLayer } from './frontLayer.ts'

/** Bytes of the store of a view at `width × height` (`createProxyStore`), with the transparents' front
 *  layer where the scene has `blends`. */
export const proxyStoreBytes = (width: number, height: number, blends: boolean) =>
  blends
    ? 2 * storeBytes(width, height) + frontLayerBytes(width, height)
    : storeBytes(width, height)

/**
 * THE STORE OF THE RUN-TIME PROXY'S ANSWERS (`bounce/runtimeLayout.ts`), one home: made with the view
 * when a placement wears a proxy (`wantsProxyStore`), else when the first does (`followProxyStore`) — its
 * bytes asked of the frame's allocation as the lobes target's are —, none before: the trace binds the
 * engine's stand-in (`deferred.placeholders`). Where the scene has `blends`, each pixel holds two cells,
 * its opaque surface's then its transparents' front one's (`rtLayer`), and the front layer is made with
 * them (`frontLayer.ts`): the surface the trace reads of it, and the radiance it writes.
 */
export function createProxyStore(
  device: GPUDevice,
  width: number,
  height: number,
  wanted: boolean,
  blends = false,
) {
  let made: GPUTexture | undefined
  let view: GPUTextureView | undefined
  let front: FrontLayer | undefined
  /** The store made, if it was not: the bytes it adds, none if it was. */
  const ensure = () => {
    if (made) return 0
    made = device.createTexture({
      label: 'Trillion3D run-time proxy store',
      size: [width, height, STORE_LAYERS * (blends ? 2 : 1)],
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    view = made.createView({ dimension: '2d-array' })
    if (blends) front = createFrontLayer(device, width, height)
    return proxyStoreBytes(width, height, blends)
  }
  if (wanted) ensure()
  const camera = new Float64Array(16)
  let epoch = 0,
    lights = NaN,
    proxy = NaN,
    worlds = NaN
  return {
    /**
     * The epoch of this image's answers: one more than the last image's when an input of the answers moved
     * — the lights' revision (`lightsRevision`), the proxy's writes (`ProxyResources.writes`), the cut's
     * worlds (`GpuSelection.worldRevision`) — or the camera's own
     * view-projection did — never the render matrix's jitter, which moves every image, and never the lit
     * image, which the screen's own reflections change image after image without changing an answer.
     * Idempotent within an image; nothing allocated.
     */
    follow(
      lightsRevision: number,
      proxyWrites: number,
      worldRevision: number,
      viewProjection: ArrayLike<number>,
    ) {
      if (
        lightsRevision !== lights ||
        proxyWrites !== proxy ||
        worldRevision !== worlds ||
        !sameElements(camera, viewProjection)
      )
        epoch++
      lights = lightsRevision
      proxy = proxyWrites
      worlds = worldRevision
      copyMatrix4(camera, viewProjection)
      return epoch
    },
    /** The store the trace reads and writes, if the view holds one. */
    get view() {
      return view
    },
    /** The transparents' front layer, made with the store where the scene has blends. */
    get front() {
      return front
    },
    /** Made now, if it was not: the bytes it adds, none if it was. */
    make: ensure,
    dispose() {
      made?.destroy()
      front?.dispose()
    },
  }
}

/** Whether the view holds the run-time proxy's store: a placement or a copy wears a proxy, so that
 *  the selection made a buffer of it (`gpu/dag/proxyInstances.ts`). O(1). */
export const wantsProxyStore = (rt: Pick<WebgpuPagesRuntime, 'run'>) =>
  !!rt.run.gpuSelection?.proxy()

/**
 * At every image's start, before anything names it (`encodeVis`): the store is made the first time a
 * placement wears a proxy, its bytes added to the frame's targets as the lobes target's are
 * (`followLobes`); a view that holds it from its making (`frameTargetAllocation`) keeps it. It follows
 * the size of the image, which remakes it with the reflection's targets.
 */
export function followProxyStore(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  const store = gpu.reflection?.store
  if (!store || store.view || !wantsProxyStore(rt)) return
  gpu.targetBytes += store.make()
}
