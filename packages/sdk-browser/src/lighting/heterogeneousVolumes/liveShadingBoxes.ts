import { type FrameContext } from './liveShadingContext.ts'
import { bufferOf } from './liveShadingState.ts'
import { VG_PARAMS_STRIDE } from './voxelGrid/gridPasses.ts'
import { boxLayout, fitSparseVoxelBias } from './sparseVoxels/boxHierarchyPlan.ts'
import { encodeBoxHierarchy, minLevelParameterSlots } from './sparseVoxels/boxHierarchyEncode.ts'
import { sparseVoxelPassesOf } from './sparseVoxels/sparseVoxelPasses.ts'
import { sparseVoxelParameterSlots } from './sparseVoxels/sparseVoxelEncode.ts'
import {
  SV_ARGS_BYTES,
  SV_COUNTER_BYTES,
  mipCountOf,
  mipVolumeResolution,
  sparseVoxelMipBias,
  voxelCountOf,
  voxelListBytes,
} from './sparseVoxels/sparseVoxelPlan.ts'

type Vec3 = readonly [number, number, number]

/**
 * THE HIERARCHY OF BOXES OVER A PRESHADED VOLUME'S SPARSE VOXELS (`heterogeneousVolumesHardwareRayTracing`; the reference builds the voxels, their boxes
 * and a ray tracing acceleration structure over them, `HeterogeneousVolumesHardwareRayTracing.cpp:112-186`, and traces the rays through it): the
 * voxels are cut out of the min levels of the baked extinction (`encodeBoxHierarchy`), from the mip the setting names, raised until the buffers fit the
 * device. Gives the buffer the march walks, none while a pipeline is still being compiled or when the volume has no extinction texture yet.
 */
export function boxHierarchyOf(
  c: FrameContext,
  id: string,
  extinction: GPUTexture,
  bounds: { centre: Vec3; extent: Vec3 },
) {
  const { device, held, settings } = c
  const passes = sparseVoxelPassesOf(device)
  if (!Object.values(passes).every((stage) => stage.pipeline.get())) return undefined
  const resolution: Vec3 = [extinction.width, extinction.height, extinction.depthOrArrayLayers]
  const levels = mipCountOf(resolution)
  const bias = fitSparseVoxelBias(
    resolution,
    sparseVoxelMipBias(settings('heterogeneousVolumesSparseVoxelGenerationMipBias')),
    device.limits.maxStorageBufferBindingSize,
  )
  const refine = !!settings('heterogeneousVolumesSparseVoxelRefinement')
  const minResolution = mipVolumeResolution(resolution, bias)
  const capacity = voxelCountOf(minResolution)
  const layout = boxLayout(resolution, bias, capacity)
  const key = (role: string) => `${id} sparse ${role}`
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const listBytes = refine ? voxelListBytes(minResolution) : 8
  const minKey = `min:${id}:${resolution.join('x')}`
  let minTexture = held.caches.get(minKey)
  if (!minTexture) {
    for (const [other, old] of held.caches)
      if (other.startsWith(`min:${id}:`)) (old.destroy(), held.caches.delete(other))
    minTexture = device.createTexture({
      label: `${id} min levels`,
      dimension: '3d',
      size: [...resolution],
      mipLevelCount: levels,
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    held.caches.set(minKey, minTexture)
  }
  encodeBoxHierarchy({
    device,
    encoder: c.encoder,
    passes,
    extinction,
    minTexture,
    resolution,
    bias,
    refine,
    boundsOrigin: bounds.centre,
    boundsExtent: bounds.extent,
    layout,
    numVoxels: bufferOf(held, device, key('count'), SV_COUNTER_BYTES, storage),
    voxels: bufferOf(held, device, key('voxels'), voxelListBytes(minResolution), storage),
    boxes: bufferOf(held, device, key('boxes'), layout.words * 4, storage),
    scratch: {
      counters: [
        bufferOf(held, device, key('counter 0'), SV_COUNTER_BYTES, storage),
        bufferOf(held, device, key('counter 1'), SV_COUNTER_BYTES, storage),
      ],
      lists: [
        bufferOf(held, device, key('list 0'), listBytes, storage),
        bufferOf(held, device, key('list 1'), listBytes, storage),
      ],
      args: bufferOf(
        held,
        device,
        key('arguments'),
        SV_ARGS_BYTES,
        storage | GPUBufferUsage.INDIRECT,
      ),
      parameters: bufferOf(
        held,
        device,
        key('parameters'),
        sparseVoxelParameterSlots(levels - bias) * VG_PARAMS_STRIDE,
        uniform,
      ),
    },
    boxParameters: bufferOf(held, device, key('box parameters'), VG_PARAMS_STRIDE, uniform),
    minParameters: bufferOf(
      held,
      device,
      key('min parameters'),
      minLevelParameterSlots(resolution) * VG_PARAMS_STRIDE,
      uniform,
    ),
  })
  return held.buffers.get(key('boxes'))
}
