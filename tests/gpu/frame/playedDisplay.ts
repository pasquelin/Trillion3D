// The 120 Hz display the moving-vehicle cadence proof plays (`vehicleCadencePage.ts`): its refresh,
// the animation frames the page asks for, run when a refresh comes at its timestamp, and the device
// the world asks for, caught so the page hears when an image's work is done.

/** The display's refresh, ms. */
export const REFRESH = 1000 / 120

/** The device the world asks for, caught as the page's GPU hands it out. */
export function catchDevice() {
  const caught: { device?: GPUDevice } = {}
  const gpu = navigator.gpu,
    ask = gpu.requestAdapter.bind(gpu)
  gpu.requestAdapter = async (options) => {
    const adapter = await ask(options)
    if (adapter) {
      const make = adapter.requestDevice.bind(adapter)
      adapter.requestDevice = async (descriptor) => (caught.device = await make(descriptor))
    }
    return adapter
  }
  return { caught, restore: () => void (gpu.requestAdapter = ask) }
}

/** The page's display (`REFRESH`): the frames asked, run when a refresh comes. */
export function playDisplay() {
  let asked = new Map<number, FrameRequestCallback>(),
    next = 1
  const scope = globalThis as unknown as {
    requestAnimationFrame: typeof requestAnimationFrame
    cancelAnimationFrame: typeof cancelAnimationFrame
  }
  const [request, cancel] = [scope.requestAnimationFrame, scope.cancelAnimationFrame]
  scope.requestAnimationFrame = (callback) => (asked.set(next, callback), next++)
  scope.cancelAnimationFrame = (id) => void asked.delete(id)
  return {
    get waiting() {
      return asked.size
    },
    /** Runs the frames asked before refresh `k`, at its timestamp. */
    refresh(k: number) {
      const time = k * REFRESH
      ;(document as unknown as { timeline: { currentTime: number } }).timeline.currentTime = time
      const due = asked
      asked = new Map()
      for (const callback of due.values()) callback(time)
    },
    restore() {
      scope.requestAnimationFrame = request
      scope.cancelAnimationFrame = cancel
    },
  }
}
