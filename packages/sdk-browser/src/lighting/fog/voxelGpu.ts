import { grownLength } from '../../../../math/src/sequence/resized.ts'
import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { SceneFogVolumeStore } from '../../../../sdk-core/src/scene/volume/store.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import {
  FOG_VOXEL_FRAME,
  FOG_VOXEL_OBJECT,
  FOG_VOXEL_SPAN,
  writeVoxelFrame,
  writeVoxelObjects,
  type VoxelImage,
} from './voxelLayout.ts'

/** The objects the buffers hold room for at first. */
const FIRST_CAPACITY = 16

/**
 * THE OBJECT RECORDS AND THEIR SPANS, in buffers that grow together: doubled when full and never
 * shrunk, the buffers they replace retired, for this image's commands may still name them.
 */
function createRecordBuffers(device: GPUDevice) {
  let capacity = 0
  let staging = new Float32Array(0)
  let objects: GPUBuffer | undefined
  let spans: GPUBuffer | undefined
  return {
    get capacity() {
      return capacity
    },
    get staging() {
      return staging
    },
    get objects() {
      return objects!
    },
    get spans() {
      return spans!
    },
    /** Room for `need` objects. */
    room(need: number) {
      if (need <= capacity) return
      capacity = grownLength(capacity, Math.max(need, FIRST_CAPACITY))
      if (objects) retire(device, objects)
      if (spans) retire(device, spans)
      staging = new Float32Array(capacity * FOG_VOXEL_OBJECT.words)
      objects = device.createBuffer({
        label: 'Trillion3D fog voxel objects',
        size: staging.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      spans = device.createBuffer({
        label: 'Trillion3D fog voxel spans',
        size: capacity * FOG_VOXEL_SPAN.words * 4,
        usage: GPUBufferUsage.STORAGE,
      })
    },
    dispose() {
      objects?.destroy()
      spans?.destroy()
    },
  }
}

/**
 * THE VOXELISATION'S BUFFERS, made once (`createFogVolumeGpu`) and kept: its frame, the records of
 * the objects that reach the volume this image, and what the first pass derives of them.
 */
export function createVoxelBuffers(device: GPUDevice) {
  const frame = device.createBuffer({
    label: 'Trillion3D fog voxel frame',
    size: FOG_VOXEL_FRAME.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const frameWords = new Float32Array(FOG_VOXEL_FRAME.words)
  const records = createRecordBuffers(device)
  /** What the frame is written from, refilled each image. */
  const image: { -readonly [K in keyof VoxelImage]: VoxelImage[K] } = {
    depthViewProj: [],
    world: [],
    eye: [],
    farEnd: 0,
    slicesPerPass: 8,
    showOnlyPass: -1,
    count: 0,
  }
  return {
    frame,
    get objects() {
      return records.objects
    },
    get spans() {
      return records.spans
    },
    /**
     * The objects of `store` that reach the volume of an image — its `camera`, the run's `settings`,
     * the `medium` whose distance bounds it — written, and the voxelisation's frame: how many.
     * Zero writes nothing.
     */
    write(
      store: SceneFogVolumeStore | undefined,
      camera: Pick<VoxelImage, 'depthViewProj' | 'world' | 'eye'>,
      settings: VolumetricFogValues,
      medium: ResolvedVolumetricFog,
    ) {
      if (!store?.count) return 0
      records.room(store.count)
      image.depthViewProj = camera.depthViewProj
      image.world = camera.world
      image.eye = camera.eye
      image.farEnd = medium.farEnd
      image.slicesPerPass = settings.volumetricFogVoxelizationSlicesPerPass
      image.showOnlyPass = settings.volumetricFogVoxelizationShowOnlyPass
      const { staging, capacity } = records
      const count = writeVoxelObjects(staging, capacity, store.values, image.eye, image.farEnd)
      if (!count) return 0
      device.queue.writeBuffer(records.objects, 0, staging, 0, count * FOG_VOXEL_OBJECT.words)
      image.count = count
      writeVoxelFrame(frameWords, image)
      device.queue.writeBuffer(frame, 0, frameWords)
      return count
    },
    dispose() {
      frame.destroy()
      records.dispose()
    },
  }
}

/** The voxelisation's buffers (`createVoxelBuffers`). */
export type VoxelBuffers = ReturnType<typeof createVoxelBuffers>
