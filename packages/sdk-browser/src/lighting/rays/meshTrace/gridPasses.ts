import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import type { MeshDistanceFieldTraceSettings } from '../../../../../sdk-core/src/contracts/meshDistanceFieldTraceOptions.ts'
import {
  computeUniformEntry,
  namedEntries,
  storageEntries,
  wholeBuffer,
} from '../../../gpu/core/computeBindings.ts'
import { dispatchOn, preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { shapeView } from '../../../gpu/core/shapeView.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { textureBytesOf } from '../../../gpu/core/textureBytes.ts'
import { hizDepthBindEntries, hizDepthEntries } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../../visibility/hiz/gpu/types.ts'
import { sphereBuffers } from '../../distanceField/ao/sphere.ts'
import { encodeTileScatter, tileScatterPipeline } from '../../distanceField/tileScatter.ts'
import type { MeshFieldScene } from '../../distanceField/meshFieldScene.ts'
import { sceneObjectEntries } from '../../distanceField/sceneBindings.ts'
import { viewResources, type ViewTexture } from '../../distanceField/viewResources.ts'
import {
  MESH_GRID_COMPACT_WGSL,
  MESH_GRID_CULL_WGSL,
  MESH_GRID_SCATTER_WGSL,
  MESH_GRID_START_OFFSETS_WGSL,
} from './cullWgsl.ts'
import {
  gridCellCount,
  gridEntryCapacity,
  meshGridShape,
  writeMeshGridParams,
  type MeshGridImage,
  type MeshGridShape,
} from './gridParams.ts'
import {
  CELL_WORDS,
  MESH_GRID_BINDING as B,
  MESH_GRID_GROUP,
  MESH_GRID_PARAMS,
  MESH_GRID_PARAMS_BYTES,
  MESH_GRID_STAND_IN_FORMAT,
  SCATTER_ENTRY_WORDS,
} from './layout.ts'

const LABEL = 'Trillion3D mesh field trace'
const COMPUTE = 4
const VERTEX = 1
const FRAGMENT = 2

const params = (stage = COMPUTE) =>
  computeUniformEntry(B.params, { minBindingSize: MESH_GRID_PARAMS_BYTES }, stage)
const { read, write } = storageEntries<keyof typeof B>(B)

/** The layouts of the programs' group 0, each the bindings the program names. The scatter's draw sees its bindings from the stage that
 *  reads them: the vertex stage the list of meshes and their bounds, the fragment stage the rest. */
const LAYOUTS = {
  cull: [
    params(),
    ...sceneObjectEntries(B.objects, false),
    write('culledObjects'),
    write('objectArgs'),
  ],
  scatter: [
    params(VERTEX | FRAGMENT),
    read('culledObjects', VERTEX),
    ...sceneObjectEntries(B.objects, false, VERTEX).slice(0, 1),
    write('scatterCount', FRAGMENT),
    write('scatterEntries', FRAGMENT),
    write('cells', FRAGMENT),
    ...sceneObjectEntries(B.objects, true, FRAGMENT).filter(
      (entry) => entry.binding !== B.objects + 1,
    ),
    ...hizDepthEntries(B.depth, FRAGMENT),
  ],
  startOffsets: [
    params(),
    read('scatterCount'),
    write('cells'),
    write('allocator'),
    write('compactArgs'),
  ],
  compact: [
    params(),
    read('scatterCount'),
    read('scatterEntries'),
    write('cells'),
    write('indices'),
  ],
} as const satisfies Record<string, readonly GPUBindGroupLayoutEntry[]>

type Program = keyof typeof LAYOUTS

/**
 * THE TRACE'S PIPELINES, once a device, each prepared off the thread (`PreparedPipeline`): a layout for every program, the
 * culling, the start offsets and the compaction as compute stages, the scatter's draw of the bounding sphere's faces
 * into a stand-in target no colour is written to, back faces kept, and the sphere's buffers.
 */
const meshGridPrograms = oncePerDevice((device: GPUDevice) => {
  const layouts = Object.fromEntries(
    Object.entries(LAYOUTS).map(([name, entries]) => [
      name,
      device.createBindGroupLayout({ label: `${LABEL} ${name}`, entries: [...entries] }),
    ]),
  ) as Record<Program, GPUBindGroupLayout>
  const pipelineLayout = (program: Program) =>
    device.createPipelineLayout({ bindGroupLayouts: [layouts[program]] })
  const label = (program: Program) => `${LABEL} ${program}`
  const stage = (program: Program, module: GPUShaderModule, entry: string) =>
    preparedComputeStage(device, pipelineLayout(program), module, entry, undefined, label(program))
  const scatterModule = device.createShaderModule({
    code: MESH_GRID_SCATTER_WGSL,
    label: label('scatter'),
  })
  const sphere = sphereBuffers(device, LABEL)
  return {
    layouts,
    cull: stage(
      'cull',
      device.createShaderModule({ code: MESH_GRID_CULL_WGSL, label: label('cull') }),
      'msdfCullObjects',
    ),
    startOffsets: stage(
      'startOffsets',
      device.createShaderModule({
        code: MESH_GRID_START_OFFSETS_WGSL,
        label: label('startOffsets'),
      }),
      'msdfStartOffsets',
    ),
    compact: stage(
      'compact',
      device.createShaderModule({ code: MESH_GRID_COMPACT_WGSL, label: label('compact') }),
      'msdfCompact',
    ),
    scatter: tileScatterPipeline(device, {
      label: label('scatter'),
      layout: pipelineLayout('scatter'),
      module: scatterModule,
      vertex: 'msdfScatterVs',
      fragment: 'msdfScatterFs',
      format: MESH_GRID_STAND_IN_FORMAT,
      sphere: true,
    }),
    sphere,
  }
})
type MeshGridPrograms = ReturnType<typeof meshGridPrograms>

/** Asks the pipelines the trace draws with, off the frame, and says whether all are compiled: the frames wait for them. */
function meshGridProgramsReady(programs: MeshGridPrograms) {
  return [programs.cull, programs.startOffsets, programs.compact, programs.scatter]
    .map((pipeline) => pipeline.ask())
    .every((pipeline) => pipeline.ready)
}

/** What decides the size of a view's resources: the cells and entries of the largest grid its buffers are made at, and the
 *  meshes the lists have room for (rounded up to 256). */
interface MeshGridShapeKey {
  cells: number
  entries: number
  objects: number
  size: readonly [number, number]
}

export const objectCapacity = (count: number) => Math.max(1, ceilDiv(count, 256)) * 256

/**
 * A VIEW'S TRACE RESOURCES: the uniform, the meshes culled to the view and the draw's arguments, the entries the scatter
 * lists, the grid's cells (`CELL_WORDS` a cell: the count, then the start of the run), the compacted lists the rays read
 * with the cells, the compaction's dispatch and the allocator of the runs, and the scatter's stand-in target. Held on the
 * view's GPU state and counted in its bytes.
 */
export interface MeshGridView {
  readonly key: MeshGridShapeKey
  readonly params: GPUBuffer
  readonly culledObjects: GPUBuffer
  readonly objectArgs: GPUBuffer
  readonly scatterCount: GPUBuffer
  readonly scatterEntries: GPUBuffer
  readonly cells: GPUBuffer
  readonly indices: GPUBuffer
  readonly compactArgs: GPUBuffer
  readonly allocator: GPUBuffer
  readonly standIn: ViewTexture
  /** The bind groups the passes were made over, kept while what they name is the same. */
  groups: { over: unknown[]; made: Record<Program, GPUBindGroup> } | undefined
  readonly bytes: number
  dispose(): void
}

const keyText = (k: MeshGridShapeKey) => `${k.cells}|${k.entries}|${k.objects}|${k.size}`

function sizesOf(key: MeshGridShapeKey) {
  return {
    params: MESH_GRID_PARAMS_BYTES,
    culledObjects: key.objects * 4,
    objectArgs: 20,
    scatterCount: 4,
    scatterEntries: key.entries * SCATTER_ENTRY_WORDS * 4,
    cells: key.cells * CELL_WORDS * 4,
    indices: key.entries * 4,
    compactArgs: 12,
    allocator: 4,
  }
}

function makeView(device: GPUDevice, key: MeshGridShapeKey, bytes: number): MeshGridView {
  const sizes = sizesOf(key)
  const { sized: buffer, texture, dispose } = viewResources(device, LABEL, sizes)
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  return {
    key,
    params: buffer('params', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    culledObjects: buffer('culledObjects', STORAGE),
    objectArgs: buffer('objectArgs', STORAGE | GPUBufferUsage.INDIRECT),
    scatterCount: buffer('scatterCount', STORAGE),
    scatterEntries: buffer('scatterEntries', STORAGE),
    cells: buffer('cells', STORAGE),
    indices: buffer('indices', STORAGE),
    compactArgs: buffer('compactArgs', STORAGE | GPUBufferUsage.INDIRECT),
    allocator: buffer('allocator', STORAGE),
    standIn: texture(
      'stand-in',
      key.size,
      MESH_GRID_STAND_IN_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
    ),
    groups: undefined,
    bytes,
    dispose,
  }
}

/** The view of `key`: the one `held` while it is that, else made where the device's budget leaves room (`ledgerAdmitted`), none
 *  where it does not, and the reason: the rays then use the global field alone. */
function ensureMeshGridView(
  held: MeshGridView | undefined,
  device: GPUDevice,
  key: MeshGridShapeKey,
): { view?: MeshGridView; why?: string } {
  return shapeView(held, device, {
    same: held !== undefined && keyText(held.key) === keyText(key),
    what: 'the meshes field trace',
    bytes: () =>
      Object.values(sizesOf(key)).reduce((sum, bytes) => sum + Math.max(bytes, 16), 0) +
      (textureBytesOf({ size: [key.size[0], key.size[1]], format: MESH_GRID_STAND_IN_FORMAT }) ??
        0),
    make: (asked) => makeView(device, key, asked),
  })
}

/** The meshes' fields as the passes bind them (`meshFieldWgsl`, from `B.objects`). */
type MeshGridObjects = Pick<MeshFieldScene, 'bindEntries' | 'generation' | 'count'>

/** What an image gives the trace. */
export interface MeshGridInputs {
  depth: HizDepth
  objects: MeshGridObjects
  image: MeshGridImage
  settings: MeshDistanceFieldTraceSettings
  /** The farthest from the camera a mesh is traced at and how far a ray traces the meshes, in centimetres (the settings', or the
   *  orthographic view's own), and the view's scene detail. */
  endDistance: number
  traceDistance: number
  sceneDetail: number
}

/** What the rays read once the lists are made: the uniform, the cells and the lists, to bind beside the meshes' fields at
 *  `MESH_TRACE_BINDING` (`traceWgsl.ts`), and the grid. */
export interface MeshGridLists {
  params: GPUBuffer
  cells: GPUBuffer
  indices: GPUBuffer
  shape: MeshGridShape
}

const floats = new Float32Array(MESH_GRID_PARAMS.words)
const words = new Uint32Array(floats.buffer)

function groupsOf(
  device: GPUDevice,
  programs: MeshGridPrograms,
  view: MeshGridView,
  inputs: MeshGridInputs,
) {
  const over = [inputs.depth, inputs.objects.generation, view]
  if (view.groups && sameValues(view.groups.over, over)) return view.groups.made
  const group = (name: Program, ...entries: GPUBindGroupEntry[][]) =>
    device.createBindGroup({
      label: `${LABEL} ${name}`,
      layout: programs.layouts[name],
      entries: [{ binding: B.params, resource: wholeBuffer(view.params) }, ...entries.flat()],
    })
  const named = (resources: Partial<Record<keyof typeof B, GPUBindingResource>>) =>
    namedEntries(B, resources)
  const made = {
    cull: group(
      'cull',
      inputs.objects.bindEntries(B.objects).slice(1, 3),
      named({
        culledObjects: wholeBuffer(view.culledObjects),
        objectArgs: wholeBuffer(view.objectArgs),
      }),
    ),
    scatter: group(
      'scatter',
      named({
        culledObjects: wholeBuffer(view.culledObjects),
        scatterCount: wholeBuffer(view.scatterCount),
        scatterEntries: wholeBuffer(view.scatterEntries),
        cells: wholeBuffer(view.cells),
      }),
      inputs.objects.bindEntries(B.objects),
      hizDepthBindEntries(B.depth, inputs.depth),
    ),
    startOffsets: group(
      'startOffsets',
      named({
        scatterCount: wholeBuffer(view.scatterCount),
        cells: wholeBuffer(view.cells),
        allocator: wholeBuffer(view.allocator),
        compactArgs: wholeBuffer(view.compactArgs),
      }),
    ),
    compact: group(
      'compact',
      named({
        scatterCount: wholeBuffer(view.scatterCount),
        scatterEntries: wholeBuffer(view.scatterEntries),
        cells: wholeBuffer(view.cells),
        indices: wholeBuffer(view.indices),
      }),
    ),
  }
  view.groups = { over, made }
  return made
}

/** The culling, the scatter and the compaction, in order; false while the scatter's pipeline is not compiled. */
function encodeGridPasses(
  encoder: GPUCommandEncoder,
  programs: MeshGridPrograms,
  groups: ReturnType<typeof groupsOf>,
  view: MeshGridView,
  shape: MeshGridShape,
  objectCount: number,
) {
  const cull = encoder.beginComputePass({ label: `${LABEL} cull` })
  dispatchOn(cull, programs.cull, groups.cull, ceilDiv(objectCount, MESH_GRID_GROUP))
  cull.end()
  const scattered = encodeTileScatter(
    encoder,
    {
      label: `${LABEL} scatter`,
      colorAttachments: [
        { view: view.standIn.view, loadOp: 'clear', storeOp: 'discard', clearValue: [0, 0, 0, 0] },
      ],
    },
    programs.scatter,
    groups.scatter,
    shape.cells[0],
    shape.cells[1],
    view.objectArgs,
    programs.sphere,
  )
  if (!scattered) return false
  const compaction = encoder.beginComputePass({ label: `${LABEL} compact` })
  dispatchOn(
    compaction,
    programs.startOffsets,
    groups.startOffsets,
    ceilDiv(gridCellCount(shape.cells), MESH_GRID_GROUP),
  )
  const compact = programs.compact.get()
  if (compact) {
    compaction.setPipeline(compact)
    compaction.setBindGroup(0, groups.compact)
    compaction.dispatchWorkgroupsIndirect(view.compactArgs, 0)
  }
  compaction.end()
  return true
}

/**
 * THE MESHES CULLED TO THE VIEW'S GRID, encoded: the buffers cleared, the meshes culled to the view, scattered by the draw of
 * their bounding spheres to the cells they reach, the runs of the cells allocated, the meshes compacted into them. Returns
 * the lists the rays read, or none where no mesh is in the scene or the pipelines are not compiled (the rays then use the global
 * field alone). The grid's buffers are made for the scene buffers' extent, so a smaller view reuses them.
 */
export function encodeMeshGrid(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  held: { view: MeshGridView | undefined; why: string | undefined },
  inputs: MeshGridInputs,
): MeshGridLists | undefined {
  const { objects, image, settings } = inputs
  if (objects.count === 0) return undefined
  const programs = meshGridPrograms(device)
  if (!meshGridProgramsReady(programs)) return undefined
  const shape = meshGridShape(
    image.view,
    image.near * CENTIMETRES_PER_METRE,
    inputs.endDistance,
    settings,
  )
  const widest = meshGridShape(
    image.extent,
    image.near * CENTIMETRES_PER_METRE,
    inputs.endDistance,
    settings,
  )
  const cells = gridCellCount(widest.cells)
  const { view, why } = ensureMeshGridView(held.view, device, {
    cells,
    entries: Math.max(
      1,
      gridEntryCapacity(cells, settings, device.limits.maxStorageBufferBindingSize),
    ),
    objects: objectCapacity(objects.count),
    size: [widest.cells[0], widest.cells[1]],
  })
  held.view = view
  held.why = why
  if (!view) return undefined
  writeMeshGridParams(floats, words, {
    image,
    shape,
    settings,
    scene: {
      objects: objects.count,
      sphereIndices: programs.sphere.indexCount,
      endDistance: inputs.endDistance,
      traceDistance: inputs.traceDistance,
      sceneDetail: inputs.sceneDetail,
      entries: view.key.entries,
    },
  })
  device.queue.writeBuffer(view.params, 0, floats)
  for (const buffer of [view.objectArgs, view.scatterCount, view.allocator, view.cells])
    encoder.clearBuffer(buffer)
  const groups = groupsOf(device, programs, view, inputs)
  if (!encodeGridPasses(encoder, programs, groups, view, shape, objects.count)) return undefined
  return { params: view.params, cells: view.cells, indices: view.indices, shape }
}
