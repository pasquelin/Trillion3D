// The buffers and textures a device holds, counted from outside the engine: the leak proofs wrap the
// device's creators and `destroy` before the engine's own ledger does, so that what it counts is
// what the device made and nothing destroyed since.
import { setTimeout as sleep } from 'node:timers/promises'
import { untag } from '../../kit/gpu/fakeWebgpuDevice.ts'

/** The live buffers and textures of `device`, counted at its two creators and its two destroys. */
export function countLive(device: GPUDevice) {
  const live = new Map<object, string>()
  const wrap = <K extends 'createBuffer' | 'createTexture'>(name: K) => {
    const create = device[name].bind(device) as (d: unknown) => { destroy(): void }
    ;(device as unknown as Record<string, unknown>)[name] = (descriptor: unknown) => {
      const resource = create(descriptor)
      live.set(resource, (descriptor as { label?: string }).label ?? 'unlabelled')
      const destroy = resource.destroy.bind(resource)
      resource.destroy = () => (live.delete(resource), destroy())
      return resource
    }
  }
  wrap('createBuffer')
  wrap('createTexture')
  return {
    count: () => live.size,
    /** Resolves once the count stops moving: a dispose finishes after its call returns. */
    async settled() {
      for (let still = 0, last = -1; still < 3; last = live.size) {
        await sleep(100)
        still = live.size === last ? still + 1 : 0
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
