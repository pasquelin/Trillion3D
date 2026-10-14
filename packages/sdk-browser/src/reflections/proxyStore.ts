import { STORE_LAYERS, STORE_MODE, storeBytes } from '../bounce/runtimeLayout.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { retire } from '../gpu/core/frameRetire.ts'

/** The cells a pixel holds: its opaque surface's, and its transparents' front one's (`rtLayer`) once a
 *  transparent reflects. */
const cells = (front: boolean) => (front ? 2 : 1)

/**
 * THE STORE OF THE RUN-TIME PROXY'S ANSWERS (`bounce/runtimeLayout.ts`), one home: made with the view
 * when a placement wears a proxy (`wantsProxyStore`), else when the first does (`followProxyStore`) — its
 * bytes asked of the frame's allocation as the lobes target's are —, none before: the trace binds the
 * engine's stand-in (`deferred.placeholders`). Each pixel holds its opaque surface's cell, and, from the
 * first image a transparent reflects (`holdFront`), its transparents' front surface's past it
 * (`rtLayer`, `frontLayer.ts`): the store is then made again with both, once, its answers cast again.
 */
export function createProxyStore(
  device: GPUDevice,
  width: number,
  height: number,
  wanted: boolean,
) {
  let made: GPUTexture | undefined
  let view: GPUTextureView | undefined
  let front = false
  /** The store made, if it was not: the bytes it adds, none if it was. */
  const ensure = () => {
    if (made) return 0
    made = device.createTexture({
      label: 'Trillion3D run-time proxy store',
      size: [width, height, STORE_LAYERS * cells(front)],
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
    })
    view = made.createView({ dimension: '2d-array' })
    return cells(front) * storeBytes(width, height)
  }
  if (wanted) ensure()
  const camera = new Float64Array(16)
  const drawn = [0, 0]
  const runtime = new Uint32Array(4)
  let epoch = 0,
    lights = NaN,
    proxy = NaN,
    worlds = NaN
  // The camera's moves, the count of them the set the trace reads was written at, and that set.
  let moves = 0,
    placed = 0,
    read = 0
  // Whether an image traced since the radiance pyramid's last build, and whether the image the
  // pyramid holds is the one that wrote the set the trace reads: its view is the set's.
  let tracing = false,
    held = false
  return {
    /**
     * The run-time words of this image's view (`ReflectionView.runtime`): the epoch of its answers —
     * one more than the last image's when an input of the answers moved: the lights' revision
     * (`lightsRevision`), the proxy's writes (`ProxyResources.writes`), the cut's worlds
     * (`GpuSelection.worldRevision`) —, or the camera did: its own view-projection, never the render
     * matrix's jitter, which moves every image, or its drawn `size` —, never the lit image, which the
     * screen's own reflections change image after image without changing an answer; `y` left to the
     * writer (the front surface's flag); then the ranks of the set the trace reads (`z`'s low bit) and
     * of the set it writes (the bit above), and how it reads (`STORE_MODE`): in
     * place while the camera has not moved since the set was written, else reprojected when the
     * radiance pyramid holds the image that wrote it, else without a history. Idempotent within an
     * image; nothing allocated.
     */
    follow(
      lightsRevision: number,
      proxyWrites: number,
      worldRevision: number,
      viewProjection: ArrayLike<number>,
      size: readonly [number, number],
    ) {
      const moved =
        !sameElements(camera, viewProjection) || size[0] !== drawn[0] || size[1] !== drawn[1]
      if (moved || lightsRevision !== lights || proxyWrites !== proxy || worldRevision !== worlds)
        epoch++
      if (moved) moves++
      lights = lightsRevision
      proxy = proxyWrites
      worlds = worldRevision
      copyMatrix4(camera, viewProjection)
      drawn[0] = size[0]
      drawn[1] = size[1]
      const still = moves === placed
      runtime[0] = epoch
      runtime[2] = read | ((still ? read : 1 - read) << 1)
      runtime[3] = still
        ? STORE_MODE.inPlace
        : held && !tracing
          ? STORE_MODE.reproject
          : STORE_MODE.unknown
      return runtime
    },
    /** The trace was encoded over the words `follow` gave: a moved camera's set written is the one
     *  the next image reads. */
    traced() {
      if (moves !== placed) read = 1 - read
      placed = moves
      tracing = true
    },
    /** The radiance pyramid was built from this image: the view it holds is the last trace's set's
     *  if this image traced. */
    built() {
      held = tracing
      tracing = false
    },
    /** The store the trace reads and writes, if the view holds one. */
    get view() {
      return view
    },
    /** The front surface's cells held from now on: the store made again with them where it was made
     *  without, the one it replaces retired after the frame. The bytes it adds. */
    holdFront() {
      if (front) return 0
      front = true
      if (!made) return 0
      retire(device, made)
      made = undefined
      return ensure() - storeBytes(width, height)
    },
    /** Made now, if it was not: the bytes it adds, none if it was. */
    make: ensure,
    dispose() {
      made?.destroy()
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
