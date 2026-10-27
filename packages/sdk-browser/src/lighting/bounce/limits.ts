/**
 * What bounce will ask of the device, compared to what the device declares it can hold.
 *
 * A binding larger than a limit does not fail where it is written: the buffer is born
 * invalid, the error bubbles uncaught, and it is the first frame that binds the group that
 * loses the device — far from the cause. Sizes are therefore all computed before a single
 * buffer is created, compared to `device.limits`, and a scene too large for this device is
 * refused bounce with the measurement that missed, never with a guess.
 */

import { textureLimits } from '../../gpu/core/textureLimits.ts'
import { BOUNCE_GRID_BYTES } from './uniform.ts'

/** A planned binding: its diagnostic name, its bytes, and the limit that bounds it. */
type BounceBinding = {
  name: string
  bytes: number
  limit: 'maxStorageBufferBindingSize' | 'maxUniformBufferBindingSize'
}

/** A planned atlas (`atlas.ts`): its diagnostic name and its width, height and layers. */
type BounceAtlas = { name: string; extent: readonly number[] }

/** The first atlas this device cannot make, written in the clear, or `null`. */
export function atlasLimitFailure(device: GPUDevice, atlases: readonly BounceAtlas[]) {
  const { side, layers } = textureLimits(device.limits)
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
 * Refuses bounce before a single buffer is created when this device cannot hold it: the frame queue,
 * the other storage buffers of the passes (`storage`: their names and bytes) and the levels' uniform,
 * and the cell table.
 * The caller surfaces the message as-is: it is the one that says which binding missed and by how much.
 */
export function ensureBounceFits(
  device: GPUDevice,
  tableExtent: readonly number[],
  queueBytes: number,
  storage: readonly { name: string; bytes: number }[] = [],
) {
  const limit = 'maxStorageBufferBindingSize'
  const failure =
    bounceLimitFailure(device, [
      { name: 'probe queue', bytes: queueBytes, limit },
      ...storage.map(({ name, bytes }) => ({ name, bytes, limit }) as const),
      { name: 'levels uniform', bytes: BOUNCE_GRID_BYTES, limit: 'maxUniformBufferBindingSize' },
    ]) ?? atlasLimitFailure(device, [{ name: 'table', extent: tableExtent }])
  if (failure) throw new Error(failure)
}
