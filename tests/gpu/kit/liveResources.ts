// The buffers and textures a device holds, counted from outside the engine: the leak proofs hook the
// device's creators (`hookAfter`, the bench's one way to wrap a WebGPU call) before the engine's own
// ledger does, so that what it counts is what the device made and nothing destroyed since.
import { hookAfter, type Proto } from '../../../bench/dawn/hook.ts'
import { untag } from '../../kit/gpu/fakeWebgpuDevice.ts'

/** The live buffers and textures of `device`, counted at its two creators and their destroys. */
export function countLive(device: GPUDevice) {
  const live = new Map<object, string>()
  for (const name of ['createBuffer', 'createTexture'])
    hookAfter(device as unknown as Proto, name, (_device, [descriptor], made) => {
      const resource = made as { destroy(): void }
      live.set(resource, (descriptor as GPUObjectDescriptorBase).label ?? 'unlabelled')
      const destroy = resource.destroy.bind(resource)
      resource.destroy = () => (live.delete(resource), destroy())
    })
  return {
    /** Resolves once a whole round of the device's queue changed nothing: a dispose finishes after
     *  its call returns, and what it destroys once the work submitted is done lands by then. */
    async settled() {
      for (let last = -1; last !== live.size;) {
        last = live.size
        await device.queue.onSubmittedWorkDone()
      }
    },
    /** The live resources by label, the session's tag taken off: the same label of two sessions
     *  is one. */
    labels() {
      const byLabel: Record<string, number> = {}
      for (const label of live.values()) {
        const name = untag(label) ?? 'unnamed'
        byLabel[name] = (byLabel[name] ?? 0) + 1
      }
      return byLabel
    },
  }
}
