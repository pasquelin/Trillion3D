/**
 * THE RANK EACH LIGHT HAD IN A VIEW'S IMAGE BEFORE, by which the sampled lighting reads the history of the same light across the changes of order and of count of the lights. A view keeps its own: what it
 * drew last image is not what another view drew. A scene light is followed by its name, a simple light by its identity (`SimpleLightEntry.lightId`, none: no history); a light the view did not show last image,
 * or an image that does not follow the one before, has none. The words (the rank before plus one, 0 for none, a word a rank) are written to the GPU only when they differ from those it holds.
 */
import { retire } from '../../gpu/core/frameRetire.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'

const MIN_SLOTS = 16

export function createPreviousRanks(device: GPUDevice) {
  // The ranks the lights of the last image had, by name (the scene's) and by identity (the simple lights'), and the same for the image being drawn.
  let sceneShown = new Map<string, number>()
  let sceneNext = new Map<string, number>()
  let simpleShown = new Map<string, number>()
  let simpleNext = new Map<string, number>()
  let words = new Uint32Array(0)
  let sent = new Uint32Array(0)
  let buffer: GPUBuffer | undefined
  let slots = 0
  let lastImage = -2
  // The lights' epochs and count the words were last written for, and whether they are the identity (each light at the rank it had: the image before had this very list), so that an unchanged list needs no rewrite.
  let signature = { scene: -1, simple: -1, total: -1 }
  let settled = false
  function ensure(total: number) {
    if (buffer && total <= slots) return
    if (buffer) retire(device, buffer)
    slots = Math.max(total, slots * 2, MIN_SLOTS)
    words = new Uint32Array(slots)
    sent = new Uint32Array(slots).fill(0xffffffff)
    buffer = device.createBuffer({
      label: 'Trillion3D previous light ranks',
      size: slots * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
  /** Writes the words to the GPU when they differ from those it holds. */
  function send() {
    if (!words.some((word, rank) => word !== sent[rank])) return
    device.queue.writeBuffer(buffer!, 0, words)
    sent.set(words)
  }
  return {
    /**
     * The buffer of the words of image `image`, the lights' ranks being the store's slots then the simple lights'. Idempotent for an image. Where nothing reads the ranks (`wanted` false: no guide by history)
     * nothing is computed and the view forgets the image before, so the first image that wants them has no history, as after a cut.
     */
    encode(store: SceneLightStore, image: number, wanted = true): GPUBuffer {
      if (buffer && lastImage === image) return buffer
      const scene = store.count
      const total = scene + store.simple.count
      ensure(total)
      if (!wanted) {
        sceneShown.clear()
        simpleShown.clear()
        lastImage = -2
        settled = false
        // The power frame's lookup is not gated off: the words it would read are zeroed, once (nothing is written again while they are).
        words.fill(0)
        send()
        return buffer!
      }
      const follows = lastImage === image - 1
      const same =
        follows &&
        signature.scene === store.epoch &&
        signature.simple === store.simple.epoch &&
        signature.total === total
      if (same && settled) {
        lastImage = image
        return buffer!
      }
      sceneNext.clear()
      simpleNext.clear()
      for (let rank = 0; rank < total; rank++) {
        const simple = rank >= scene
        const key = simple ? store.simple.identityOf(rank - scene) : store.ids[rank]
        const before =
          key === undefined || !follows ? undefined : (simple ? simpleShown : sceneShown).get(key)
        words[rank] = before === undefined ? 0 : before + 1
        if (key !== undefined) (simple ? simpleNext : sceneNext).set(key, rank)
      }
      ;[sceneShown, sceneNext] = [sceneNext, sceneShown]
      ;[simpleShown, simpleNext] = [simpleNext, simpleShown]
      lastImage = image
      // The words are the identity only where the list is the one the image before computed for.
      settled = same
      signature = { scene: store.epoch, simple: store.simple.epoch, total }
      send()
      return buffer!
    },
    dispose() {
      if (buffer) retire(device, buffer)
      buffer = undefined
      settled = false
    },
  }
}
