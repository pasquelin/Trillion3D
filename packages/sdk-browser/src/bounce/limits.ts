/**
 * What bounce will ask of the device, compared to what the device declares it can hold.
 *
 * A binding larger than a limit does not fail where it is written: the buffer is born
 * invalid, the error bubbles uncaught, and it is the first frame that binds the group that
 * loses the device — far from the cause. Sizes are therefore all computed before a single
 * buffer is created, compared to `device.limits`, and a scene too large for this device is
 * refused bounce with the measurement that missed, never with a guess.
 */

import { PROBE_FLOATS, type SceneProxy } from '../../../sdk-core/src/index.ts'
import { PROXY_HEADER_BYTES, surfaceCacheTexels } from './sizes.ts'
import { atlasExtent } from './atlas.ts'
import { BOUNCE_GRID_BYTES } from './uniform.ts'

/** Bytes of one copy of `probes` probes on the GPU: never an empty binding. */
export const bounceProbeBytes = (probes: number) => Math.max(16, probes * PROBE_FLOATS * 4)

/** A planned binding: its diagnostic name, its bytes, and the limit that bounds it. */
type BounceBinding = {
  name: string
  bytes: number
  limit: 'maxStorageBufferBindingSize' | 'maxUniformBufferBindingSize'
}

/** A planned atlas (`atlas.ts`): its diagnostic name and its width, height and layers. */
type BounceAtlas = { name: string; extent: readonly number[] }

/** The first atlas this device cannot make, written in the clear, or `null`. */
function atlasLimitFailure(device: GPUDevice, atlases: readonly BounceAtlas[]) {
  const { maxTextureDimension2D: side, maxTextureArrayLayers: layers } = device.limits
  for (const { name, extent } of atlases) {
    const [width, height, count = 1] = extent
    if (width > side || height > side)
      return `bounce atlas "${name}" needs ${width}×${height} texels, over this device's maxTextureDimension2D of ${side}`
    if (count > layers)
      return `bounce atlas "${name}" needs ${count} layers, over this device's maxTextureArrayLayers of ${layers}`
  }
  return null
}

/**
 * The first overflow, written in the clear, or `null` when everything fits. Binding order is
 * creation order: the message names the first that does not pass, not the largest.
 */
function bounceLimitFailure(device: GPUDevice, bindings: readonly BounceBinding[]) {
  const { limits } = device
  for (const { name, bytes, limit } of bindings) {
    if (bytes > limits[limit])
      return `bounce binding "${name}" needs ${bytes} bytes, over this device's ${limit} of ${limits[limit]}`
    if (bytes > limits.maxBufferSize)
      return `bounce buffer "${name}" needs ${bytes} bytes, over this device's maxBufferSize of ${limits.maxBufferSize}`
  }
  return null
}

/**
 * Resident-proxy bytes: its header, then its three columns back to back in the single
 * buffer the traversal binds. A proxy without data keeps the four words of the empty binding.
 */
function residentProxyBytes(proxy: SceneProxy) {
  const data = proxy.data
  const columns =
    (data?.triangles.byteLength ?? 0) +
    (data?.nodeBounds.byteLength ?? 0) +
    (data?.nodeChildren.byteLength ?? 0) +
    (data?.triangleGroups.byteLength ?? 0) +
    (data?.groupOffsets.byteLength ?? 0) +
    (data?.owners.byteLength ?? 0) +
    (data?.bindWorlds.length ?? 0) * 4
  return PROXY_HEADER_BYTES + Math.max(16, columns)
}

/**
 * Bytes of each buffer binding bounce will create, in the order it creates them: the resident
 * proxy and its albedo, the frame queue and the cascade uniform. The probes, their snapshot and
 * the surface cache are atlases, checked against the texture limits (`atlasLimitFailure`).
 */
function plannedBindings(proxy: SceneProxy, queueBytes: number): BounceBinding[] {
  const data = proxy.data,
    storage = 'maxStorageBufferBindingSize'
  return [
    { name: 'resident proxy', bytes: residentProxyBytes(proxy), limit: storage },
    { name: 'proxy albedo', bytes: data?.albedo.byteLength ?? 4, limit: storage },
    { name: 'probe queue', bytes: queueBytes, limit: storage },
    { name: 'cascades uniform', bytes: BOUNCE_GRID_BYTES, limit: 'maxUniformBufferBindingSize' },
  ]
}

/**
 * Refuses bounce before a single buffer is created when this device cannot hold it.
 * The caller surfaces the message as-is: it is the one that says which binding missed and by how much.
 */
export function ensureBounceFits(
  device: GPUDevice,
  proxy: SceneProxy,
  probeExtent: readonly number[],
  queueBytes: number,
) {
  const failure =
    bounceLimitFailure(device, plannedBindings(proxy, queueBytes)) ??
    atlasLimitFailure(device, [
      { name: 'probes', extent: probeExtent },
      { name: 'surface cache', extent: atlasExtent(surfaceCacheTexels(proxy.triangles)) },
    ])
  if (failure) throw new Error(failure)
}

/** The resident proxy uses the same complete binding admission as bounce. */
export function ensureProxyFits(device: GPUDevice, proxy: SceneProxy) {
  const failure = bounceLimitFailure(device, [
    {
      name: 'resident proxy',
      bytes: residentProxyBytes(proxy),
      limit: 'maxStorageBufferBindingSize',
    },
    {
      name: 'proxy albedo',
      bytes: Math.max(4, proxy.data?.albedo.byteLength ?? 0),
      limit: 'maxStorageBufferBindingSize',
    },
  ])
  if (failure) throw new Error(failure)
}
