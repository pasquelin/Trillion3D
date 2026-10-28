import { grownLength } from '../../../../math/src/sequence/resized.ts'
import type { ResolvedVolumetricFog } from '../../../../sdk-core/src/scene/core/fogVolumetric.ts'
import type { VolumetricFogValues } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { ResolvedFogVolume } from '../../../../sdk-core/src/scene/volume/contracts.ts'
import type { SceneFogVolumeStore } from '../../../../sdk-core/src/scene/volume/store.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { newGraphClocks, type GraphClocks } from '../../materials/graph/clocks.ts'
import type { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import {
  createGraphValues,
  voxelGraphSet,
  type FogAtlas,
  type VoxelGraphSet,
} from './voxelGraph.ts'
import {
  FOG_VOXEL_FRAME,
  FOG_VOXEL_OBJECT,
  FOG_VOXEL_SPAN,
  writeVoxelFrame,
  writeVoxelObjects,
  type VoxelImage,
} from './voxelLayout.ts'

/** What the voxelisation reads of the colour atlas for the textures its graphs read: a texture's slot,
 *  and the texture taken into the atlas and asked at its full detail (`frame/render/fogGraphMaps.ts`). */
export interface VoxelGraphMaps {
  slotOf(texture: Texture): number | undefined
  warm(textures: readonly Texture[]): void
  /** The atlas's resources, none while it is not there. */
  atlas(): FogAtlas | undefined
}

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
      const grown = grownLength(capacity, Math.max(need, FIRST_CAPACITY))
      const next = new Float32Array(grown * FOG_VOXEL_OBJECT.words)
      // Made first, the buffers they replace retired after; the capacity follows what was granted.
      objects = sizedBuffer(
        device,
        objects,
        next.byteLength,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'Trillion3D fog voxel objects',
      )
      spans = sizedBuffer(
        device,
        spans,
        grown * FOG_VOXEL_SPAN.words * 4,
        GPUBufferUsage.STORAGE,
        'Trillion3D fog voxel spans',
      )
      staging = next
      capacity = grown
    },
    dispose() {
      objects?.destroy()
      spans?.destroy()
    },
  }
}

/**
 * THE VALUES OF THE OBJECTS' GRAPHS (`voxelGraph.ts`) in a buffer grown to hold them, and the
 * programs the objects written this image wear.
 */
function createGraphBuffers(device: GPUDevice) {
  const values = createGraphValues()
  let buffer: GPUBuffer | undefined
  let planned: VoxelGraphSet | undefined
  let sent: VoxelGraphSet | undefined
  return {
    /** The programs the objects written this image wear, none where they wear none that compile. */
    get set() {
      return sent
    },
    get buffer() {
      return buffer!
    },
    /**
     * Starts an image's values: the function that gives each object's graph word and writes its
     * values (the textures its graph reads warmed in the atlas), none where no object of `objects`
     * wears a graph that compiles.
     */
    plan(objects: Iterable<ResolvedFogVolume>, maps?: VoxelGraphMaps) {
      sent = undefined
      planned = voxelGraphSet(objects)
      values.reset()
      const set = planned
      return (
        set &&
        ((object: ResolvedFogVolume) => {
          if (object.graph) maps?.warm(object.graph.readTextures())
          return values.add(object, set, (texture) => maps?.slotOf(texture))
        })
      )
    },
    /** The values written, sent up, the buffer made or grown to hold them. */
    send() {
      const { words } = values
      if (!planned || !words.length) return
      buffer = sizedBuffer(
        device,
        buffer,
        Math.max(words.byteLength, 16),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        'Trillion3D fog voxel graph values',
      )
      device.queue.writeBuffer(buffer, 0, words)
      sent = planned
    },
    dispose() {
      buffer?.destroy()
    },
  }
}

/** What the voxelisation's frame is written from, refilled each image. */
const newVoxelImage = (): { -readonly [K in keyof VoxelImage]: VoxelImage[K] } => ({
  depthViewProj: [],
  world: [],
  eye: [],
  farEnd: 0,
  slicesPerPass: 8,
  showOnlyPass: -1,
  count: 0,
  time: 0,
  realTime: 0,
})

/** The image's camera, distance and settings, and the clocks a graph reads. */
function fillVoxelImage(
  image: ReturnType<typeof newVoxelImage>,
  camera: Pick<VoxelImage, 'depthViewProj' | 'world' | 'eye'>,
  settings: VolumetricFogValues,
  medium: ResolvedVolumetricFog,
  clocks: GraphClocks,
) {
  image.depthViewProj = camera.depthViewProj
  image.world = camera.world
  image.eye = camera.eye
  image.farEnd = medium.farEnd
  image.slicesPerPass = settings.volumetricFogVoxelizationSlicesPerPass
  image.showOnlyPass = settings.volumetricFogVoxelizationShowOnlyPass
  image.time = clocks.time
  image.realTime = clocks.realTime
}

/** The clocks of a voxelisation asked with none: both at 0. */
const NO_CLOCKS = newGraphClocks()

/** What the voxelisation's image is written into: the frame, the records of its objects, the values of
 *  their graphs, and what the frame is written from. */
interface VoxelParts {
  frame: GPUBuffer
  frameWords: Float32Array<ArrayBuffer>
  records: ReturnType<typeof createRecordBuffers>
  graphs: ReturnType<typeof createGraphBuffers>
  image: ReturnType<typeof newVoxelImage>
}

/**
 * The objects of `store` that reach the volume of an image — its `camera`, the run's `settings`, the
 * `medium` whose distance bounds it, the `clocks` its graphs read — written into `parts`, and the
 * voxelisation's frame: how many. Zero writes nothing.
 */
function writeVoxelImage(
  device: GPUDevice,
  { frame, frameWords, records, graphs, image }: VoxelParts,
  store: SceneFogVolumeStore | undefined,
  camera: Pick<VoxelImage, 'depthViewProj' | 'world' | 'eye'>,
  settings: VolumetricFogValues,
  medium: ResolvedVolumetricFog,
  maps: VoxelGraphMaps | undefined,
  clocks: GraphClocks,
) {
  const graphOf = graphs.plan(store?.values ?? [], maps) // none for a store with no object
  if (!store?.count) return 0
  records.room(store.count)
  fillVoxelImage(image, camera, settings, medium, clocks)
  const { staging, capacity } = records
  const count = writeVoxelObjects(staging, capacity, store.values, image.eye, image.farEnd, graphOf)
  if (!count) return 0
  graphs.send()
  device.queue.writeBuffer(records.objects, 0, staging, 0, count * FOG_VOXEL_OBJECT.words)
  image.count = count
  writeVoxelFrame(frameWords, image)
  device.queue.writeBuffer(frame, 0, frameWords)
  return count
}

/**
 * THE VOXELISATION'S BUFFERS, made once (`createFogVolumeGpu`) and kept: its frame, the records of
 * the objects that reach the volume this image, the values of their graphs and what the first pass
 * derives of them.
 */
export function createVoxelBuffers(device: GPUDevice) {
  const frame = device.createBuffer({
    label: 'Trillion3D fog voxel frame',
    size: FOG_VOXEL_FRAME.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const records = createRecordBuffers(device)
  const graphs = createGraphBuffers(device)
  const parts: VoxelParts = {
    frame,
    frameWords: new Float32Array(FOG_VOXEL_FRAME.words),
    records,
    graphs,
    image: newVoxelImage(),
  }
  return {
    frame,
    get objects() {
      return records.objects
    },
    get spans() {
      return records.spans
    },
    /** The graphs the objects written this image wear, none where they wear none that compile. */
    get graphs() {
      return graphs.set
    },
    /** The buffer of their values. */
    get graphValues() {
      return graphs.buffer
    },
    /** The objects of `store` written for an image (`writeVoxelImage`): how many reach the volume. */
    write(
      store: SceneFogVolumeStore | undefined,
      camera: Pick<VoxelImage, 'depthViewProj' | 'world' | 'eye'>,
      settings: VolumetricFogValues,
      medium: ResolvedVolumetricFog,
      maps?: VoxelGraphMaps,
      clocks: GraphClocks = NO_CLOCKS,
    ) {
      return writeVoxelImage(device, parts, store, camera, settings, medium, maps, clocks)
    },
    dispose() {
      frame.destroy()
      records.dispose()
      graphs.dispose()
    },
  }
}

/** The voxelisation's buffers (`createVoxelBuffers`). */
export type VoxelBuffers = ReturnType<typeof createVoxelBuffers>
