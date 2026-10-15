import { computeBufferEntry, namedEntries } from '../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import type { ProxyResources } from '../gpu/dag/cutReaders.ts'
import { atlasEntry } from './atlas.ts'
import { PROBE_BINDINGS, PROBE_PROXY } from './probeBindings.ts'
import { sceneBindEntries, sceneLayoutEntries } from './sceneBindings.ts'

/** The probe pass's layout. */
export function probeLayout(device: GPUDevice) {
  const B = PROBE_BINDINGS
  return device.createBindGroupLayout({
    entries: [
      computeBufferEntry(B.grid, 'uniform'),
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeBufferEntry(B.queue, 'read-only-storage'),
      atlasEntry(B.snapshot),
      atlasEntry(B.probes, true),
      computeBufferEntry(B.lists, 'read-only-storage'),
      ...sceneLayoutEntries(PROBE_PROXY),
    ],
  })
}

/** What the probe group binds for the whole life of the cascades. */
type ProbeHeld = {
  grid: GPUBuffer
  queue: GPUBuffer
  snapshot: GPUTextureView
  probes: GPUTextureView
}

/**
 * The probe group over `held` and, at each call, the proxy, the light buffer and the world lists of
 * the moment: made again only when one of them moved (`createWebgpuBindIdentity`) — a growth of the
 * proxy's tables replaces them.
 */
export function probeBinder(device: GPUDevice, layout: GPUBindGroupLayout, held: ProbeHeld) {
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (proxy: ProxyResources, lights: GPUBuffer, lists: GPUBuffer) => {
    const { next } = bound
    next[0] = proxy.buffer
    next[1] = lights
    next[2] = lists
    next[3] = proxy.worlds
    next[4] = proxy.tree
    if (bound.moved())
      group = device.createBindGroup({
        layout,
        entries: [
          ...namedEntries(PROBE_BINDINGS, {
            grid: { buffer: held.grid },
            lights: { buffer: lights },
            queue: { buffer: held.queue },
            snapshot: held.snapshot,
            probes: held.probes,
            lists: { buffer: lists },
          }),
          ...sceneBindEntries(PROBE_PROXY, proxy),
        ],
      })
    return group!
  }
}
