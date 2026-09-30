import { createDepthBoundsMipChain, createRadianceMipChain } from '../texture/mipBatch.ts';
import { mipTailBytes, textureBytesOf } from '../gpu/core/textureBytes.ts';
import { uniformStride } from '../residency/pools.ts';
import { levelSize, mipLevelCountFor } from '../texture/tiles.ts';

/** A cone's source hierarchy: existing radiance plus explicit nearest/farthest depth.
 * The occlusion Hi-Z stores only farthest depth and cannot replace these intervals. */
export function createReflectionConePyramid(
  device: GPUDevice,
  color: GPUTexture,
  depth: GPUTextureView,
) {
  const { width, height } = color;
  const { descriptor } = reflectionConeAllocation(width, height, device.limits);
  const bounds = device.createTexture(descriptor);
  let radiance: ReturnType<typeof createRadianceMipChain> | undefined;
  let ranges: ReturnType<typeof createDepthBoundsMipChain> | undefined;
  try {
    radiance = createRadianceMipChain(device, color);
    ranges = createDepthBoundsMipChain(device, bounds, { view: depth, width, height });
    return {
      view: bounds.createView(),
      encode(encoder: GPUCommandEncoder) {
        radiance!.encode(encoder);
        ranges!.encode(encoder);
      },
      dispose() {
        radiance!.dispose();
        ranges!.dispose();
        bounds.destroy();
      },
    };
  } catch (error) {
    radiance?.dispose();
    ranges?.dispose();
    bounds.destroy();
    throw error;
  }
}

/** Exact additional bytes: source level zero is already included by the frame target. */
export function reflectionConeAllocation(
  width: number,
  height: number,
  limits: GPUSupportedLimits,
) {
  const [halfWidth, halfHeight] = levelSize(width, height, 1);
  const levels = mipLevelCountFor(width, height);
  const boundsLevels = mipLevelCountFor(halfWidth, halfHeight);
  const descriptor: GPUTextureDescriptor = {
    label: 'Trillion3D reflection depth bounds',
    size: [halfWidth, halfHeight],
    format: 'rg32float',
    mipLevelCount: boundsLevels,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  };
  const uniforms = (Math.max(1, levels - 1) + boundsLevels) * uniformStride(limits);
  return {
    descriptor,
    bytes:
      mipTailBytes(width, height, 'rgba16float', levels) + textureBytesOf(descriptor)! + uniforms,
  };
}
