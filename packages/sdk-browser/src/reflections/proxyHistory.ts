/**
 * THE RUN-TIME PROXY'S ANSWERS, KEPT FROM IMAGE TO IMAGE: what a pixel last got from its ray
 * (`runtimeTraceWgsl.ts`), so that a frame that spends its budget (`FRAME_WORK`) leaves the pixels
 * after it their last answer, and the next frames — the trace starts where the last one's budget ended,
 * `offset` — answer them. One buffer: a header of counters the frame's trace reads and writes, then two
 * words a pixel. What an answer is stamped with, the epoch, is the CPU's (`follow`): it moves when an input
 * of the answers did — the view, the lights, the placements' poses, a surface, a cut —, never when the lit
 * image did, which the screen's own reflections change image after image without changing an answer.
 *
 * Header words: the pixels whose answer is older than the epoch (`left`: what the settle waits for,
 * `settle.ts`), the work the frame has spent, the tile the next frame starts at (`offset`) and the
 * tiles the last one served from it (`cursor`). A pixel's words: its colour as three
 * half floats (the third in the high half of the second word's low half), its confidence on eight bits
 * and the epoch's low eight bits above them.
 *
 * It is made when a placement first wears a proxy (`ScreenReflection.history`) and kept at the size of
 * the image; the stand-in, its header, is bound before.
 */
export const HISTORY_HEADER_WORDS = 8
/** Words of a pixel's answer. */
export const HISTORY_PIXEL_WORDS = 2
export const HISTORY = { left: 0, spent: 1, offset: 2, cursor: 3 } as const

/** Bytes of the history of an image of `width × height`, which a view that wants it holds. */
export const historyBytes = (width: number, height: number) =>
  (HISTORY_HEADER_WORDS + width * height * HISTORY_PIXEL_WORDS) * 4

/**
 * The history of a view: made with it when a placement wears a proxy, else when the first does
 * (`make`, `webgpu/pages/prepare/proxyHistory.ts`) — its bytes asked of the frame's allocation as the
 * lobes target's are —, none before: the trace binds the engine's stand-in (`deferred.placeholders`).
 */
export function createProxyHistory(
  device: GPUDevice,
  width: number,
  height: number,
  wanted: boolean,
) {
  let made: GPUBuffer | undefined
  const make = () =>
    (made ??= device.createBuffer({
      label: 'Trillion3D run-time proxy history',
      size: historyBytes(width, height),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }))
  if (wanted) make()
  const view = new Float64Array(16)
  let epoch = 0,
    key = ''
  return {
    /**
     * The epoch of this image's answers: one more than the last image's when an input of the answers moved
     * (`inputs`, each a revision) or the view did. Idempotent within an image.
     */
    follow(inputs: readonly number[], viewProjection: ArrayLike<number>) {
      const next = inputs.join(',')
      let moved = false
      for (let k = 0; k < 16; k++) if (view[k] !== viewProjection[k]) moved = true
      if (moved || next !== key) epoch++
      key = next
      view.set(viewProjection)
      return epoch
    },
    /** The history the trace reads and writes, if the view holds one. */
    get buffer() {
      return made
    },
    /** Made now, if it was not: the bytes it adds, none if it was. */
    make() {
      const before = made?.size ?? 0
      return make().size - before
    },
    dispose() {
      made?.destroy()
    },
  }
}
