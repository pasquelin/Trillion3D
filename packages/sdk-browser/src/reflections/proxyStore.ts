import { STORE_LAYERS, storeBytes } from '../bounce/runtimeLayout.ts'

/** The epochs of the run-time proxy's answers: the scene's moves when an input of the answers did — the lights,
 *  the placements' poses, a surface, a cut —, the view's when the camera did. Never the lit image, which the
 *  screen's own reflections change image after image without changing an answer, and never the render
 *  matrix's jitter, which moves every image. */
export type Epochs = { scene: number; view: number }

/**
 * The store of the run-time proxy's answers (`bounce/runtimeLayout.ts`): made with the view when a placement wears
 * a proxy, else when the first does (`make`, `webgpu/pages/prepare/proxyStore.ts`) — its bytes asked of the
 * frame's allocation as the lobes target's are —, none before: the trace binds the engine's stand-in
 * (`deferred.placeholders`).
 */
export function createProxyStore(
  device: GPUDevice,
  width: number,
  height: number,
  wanted: boolean,
) {
  let made: GPUTexture | undefined
  let view: GPUTextureView | undefined
  const make = () => {
    if (!made) {
      made = device.createTexture({
        label: 'Trillion3D run-time proxy store',
        size: [width, height, STORE_LAYERS],
        format: 'r32uint',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      })
      view = made.createView({ dimension: '2d-array' })
    }
    return made
  }
  if (wanted) make()
  const camera = new Float64Array(16)
  const epochs: Epochs = { scene: 0, view: 0 }
  let key = ''
  return {
    /**
     * The epochs of this image's answers: the scene's one more than the last image's when an input of the
     * answers moved (`inputs`, each a revision), the view's when the camera's own view-projection did.
     * Idempotent within an image.
     */
    follow(inputs: readonly number[], viewProjection: ArrayLike<number>): Epochs {
      const next = inputs.join(',')
      let moved = false
      for (let k = 0; k < 16; k++) if (camera[k] !== viewProjection[k]) moved = true
      if (moved) epochs.view++
      if (next !== key) epochs.scene++
      key = next
      camera.set(viewProjection)
      return epochs
    },
    /** The store the trace reads and writes, if the view holds one. */
    get view() {
      return view
    },
    /** Made now, if it was not: the bytes it adds, none if it was. */
    make() {
      const before = made ? storeBytes(width, height) : 0
      make()
      return storeBytes(width, height) - before
    },
    dispose() {
      made?.destroy()
    },
  }
}
