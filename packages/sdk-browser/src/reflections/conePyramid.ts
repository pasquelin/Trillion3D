import { createRadianceMipChain } from '../texture/radianceMips.ts'
import { createReflectionBoundsPyramid, type ReflectionBoundsPipelines } from './boundsPyramid.ts'
import { mipTailBytes, textureBytesOf } from '../gpu/core/textureBytes.ts'
import { uniformStride } from '../residency/pools.ts'
import { levelSize, mipLevelCountFor } from '../texture/tiles.ts'

/** A cone's source hierarchy: existing radiance plus explicit nearest/farthest depth.
 * The occlusion Hi-Z stores only farthest depth and cannot replace these intervals: nor can it
 * bound a first hit, so every screen ray walks these bounds too (`screenReflection`,
 * `traceShader.ts`), without the radiance levels where no cone reads them (`radiance` false). */
export function createReflectionConePyramid(
  device: GPUDevice,
  color: GPUTexture,
  depth: GPUTextureView,
  radiance = true,
) {
  const { width, height } = color
  const { descriptor } = reflectionConeAllocation(width, height, device.limits)
  const bounds = device.createTexture(descriptor)
  let mips: ReturnType<typeof createRadianceMipChain> | undefined
  let ranges: ReturnType<typeof createReflectionBoundsPyramid> | undefined
  try {
    if (radiance) mips = createRadianceMipChain(device, color)
    ranges = createReflectionBoundsPyramid(device, bounds, { view: depth, width, height })
    return {
      /** Whether the radiance levels a cone reads were made: the fit of the targets reads it. */
      radiance,
      view: bounds.createView(),
      /** The radiance levels, then the depth bounds, with the reflection program's reductions
       *  (`reflectionBoundsPipelines`). */
      encode(encoder: GPUCommandEncoder, pipelines: ReflectionBoundsPipelines) {
        mips?.encode(encoder)
        ranges!.encode(encoder, pipelines)
      },
      dispose() {
        mips?.dispose()
        ranges!.dispose()
        bounds.destroy()
      },
    }
  } catch (error) {
    mips?.dispose()
    ranges?.dispose()
    bounds.destroy()
    throw error
  }
}

/** Exact additional bytes: source level zero is already included by the frame target. */
export function reflectionConeAllocation(
  width: number,
  height: number,
  limits: GPUSupportedLimits,
  radiance = true,
) {
  const [halfWidth, halfHeight] = levelSize(width, height, 1)
  const levels = mipLevelCountFor(width, height)
  const boundsLevels = mipLevelCountFor(halfWidth, halfHeight)
  const descriptor: GPUTextureDescriptor = {
    label: 'Trillion3D reflection depth bounds',
    size: [halfWidth, halfHeight],
    format: 'rg32float',
    mipLevelCount: boundsLevels,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  }
  const radianceBytes = radiance
    ? mipTailBytes(width, height, 'rgba16float', levels) +
      Math.max(1, levels - 1) * uniformStride(limits)
    : 0
  return {
    descriptor,
    bytes: radianceBytes + textureBytesOf(descriptor)! + boundsLevels * uniformStride(limits),
  }
}
