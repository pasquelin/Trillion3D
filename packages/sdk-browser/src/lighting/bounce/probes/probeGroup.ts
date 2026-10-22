import { COMPUTE, computeBufferEntry, namedEntries } from '../../../gpu/core/computeBindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { ProxyResources } from '../../../geometry/dag/cut/cutReaders.ts'
import { atlasEntry } from '../atlas.ts'
import {
  PROBE_BINDINGS,
  PROBE_CLOUD_SHADOW,
  PROBE_PROXY,
  PROBE_SKY_LIGHT,
} from './probeBindings.ts'
import {
  cloudShadowBindEntries,
  cloudShadowLayoutEntries,
  type CloudShadowSet,
} from '../../atmosphere/cloudShadowRead.ts'
import {
  skyLightReadBindEntries,
  skyLightReadLayoutEntries,
  type SkyLightReadSet,
} from '../../../modules/sky/skyLight/read.ts'
import { sceneBindEntries, sceneLayoutEntries } from '../sceneBindings.ts'
import { lightFunctionLayoutEntry } from '../../lightFunction/bindings.ts'

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
      computeBufferEntry(B.census, 'storage'),
      lightFunctionLayoutEntry(B.lightFunction),
      ...skyLightReadLayoutEntries(PROBE_SKY_LIGHT, COMPUTE),
      ...cloudShadowLayoutEntries(PROBE_CLOUD_SHADOW, COMPUTE),
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
  census: GPUBuffer
}

/**
 * The probe group over `held` and, at each call, the proxy, the light buffer, the world lists and the
 * light functions' atlas of the moment (a stand-in where the bounce's lights read none): made again only when one
 * of them moved (`createWebgpuBindIdentity`) — a growth of the proxy's tables replaces them.
 */
export function probeBinder(device: GPUDevice, layout: GPUBindGroupLayout, held: ProbeHeld) {
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (
    proxy: ProxyResources,
    lights: GPUBuffer,
    lists: GPUBuffer,
    lightFunction: GPUTextureView,
    sky: SkyLightReadSet,
    cloudShadow: CloudShadowSet,
  ) => {
    const { next } = bound
    next[0] = proxy.buffer
    next[1] = lights
    next[2] = lists
    next[3] = proxy.worlds
    next[4] = proxy.tree
    next[5] = lightFunction
    next[6] = sky.cube
    next[7] = sky.params
    next[8] = cloudShadow.block
    next[9] = cloudShadow.maps[0]
    next[10] = cloudShadow.maps[1]
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
            census: { buffer: held.census },
            lightFunction,
          }),
          ...sceneBindEntries(PROBE_PROXY, proxy),
          ...skyLightReadBindEntries(PROBE_SKY_LIGHT, sky),
          ...cloudShadowBindEntries(PROBE_CLOUD_SHADOW, cloudShadow),
        ],
      })
    return group!
  }
}
