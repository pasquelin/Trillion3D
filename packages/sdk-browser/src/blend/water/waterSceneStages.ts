import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { hasSubgroups } from '../../gpu/core/subgroups.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import {
  WATER_COPY_BINDINGS as C,
  WATER_MASK_BINDINGS as M,
  WATER_SHADOW_BINDINGS as H,
  WATER_TILE_BINDINGS as T,
} from './waterLayout.ts'
import { waterCopyShader, waterMaskShader } from './waterPassWgsl.ts'
import { waterTileKernels } from './waterTileWgsl.ts'
import { sunShadowStage } from './waterSunShadow.ts'

/** The format of the copy's linear depth, of the mask of the refraction and of the separated sun. */
export const WATER_DEPTH_FORMAT: GPUTextureFormat = 'r32float'
export const WATER_MASK_FORMAT: GPUTextureFormat = 'r8unorm'
export const WATER_SUN_FORMAT: GPUTextureFormat = 'rgba16float'

/** `GPUShaderStage`, written in the clear: the layouts are also read from Node, without that global. */
export const STAGE = { vertex: 1, fragment: 2, compute: 4 } as const
export const VERTEX_FRAGMENT = STAGE.vertex | STAGE.fragment

/** One full-screen (or tile-listed) pipeline of the water pass, with the layout of its group 0. */
interface SceneStage {
  layout: GPUBindGroupLayout
  pipeline: PreparedPipeline<GPURenderPipeline>
}

/** One entry of a bind group layout. */
const entry = (binding: number, visibility: number, rest: object): GPUBindGroupLayoutEntry => ({
  binding,
  visibility,
  ...rest,
})

/** The layout of the group 0 of the scene copies. */
const copyLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D water scene copy',
    entries: [
      entry(C.params, VERTEX_FRAGMENT, { buffer: { type: 'uniform' } }),
      entry(C.color, STAGE.fragment, { texture: { sampleType: 'float' } }),
      entry(C.depth, STAGE.fragment, { texture: { sampleType: 'depth' } }),
      entry(C.sampler, STAGE.fragment, { sampler: { type: 'filtering' } }),
      entry(C.tiles, STAGE.vertex, { buffer: { type: 'read-only-storage' } }),
    ],
  })

/** The layout of the group 0 of the refraction mask. */
const maskLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D water refraction mask',
    entries: [
      entry(M.params, STAGE.fragment, { buffer: { type: 'uniform' } }),
      entry(M.waterDepth, STAGE.fragment, { texture: { sampleType: 'depth' } }),
      entry(M.opaqueDepth, STAGE.fragment, { texture: { sampleType: 'depth' } }),
      entry(M.sceneLinear, STAGE.fragment, { texture: { sampleType: 'unfilterable-float' } }),
    ],
  })

/** The layout of the group 0 of the sun's shadow draw. */
const sunShadowLayout = (device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D water sun shadow',
    entries: [
      entry(H.params, VERTEX_FRAGMENT, { buffer: { type: 'uniform' } }),
      entry(H.mask, STAGE.fragment, {
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
      }),
      entry(H.tiles, STAGE.vertex, { buffer: { type: 'read-only-storage' } }),
    ],
  })

/** The entries every tile kernel binds, then `extra`. */
const kernelEntries = (...extra: GPUBindGroupLayoutEntry[]) => [
  entry(T.params, STAGE.compute, { buffer: { type: 'uniform' } }),
  entry(T.waterDepth, STAGE.compute, { texture: { sampleType: 'depth' } }),
  entry(T.opaqueDepth, STAGE.compute, { texture: { sampleType: 'depth' } }),
  ...extra,
]

/** A compute-visible storage buffer entry. */
const storage = (binding: number) => entry(binding, STAGE.compute, { buffer: { type: 'storage' } })

/** The layouts of the tile kernels: the marks and lists, and the identifiers. */
function kernelLayouts(device: GPUDevice) {
  const kernelLayout = device.createBindGroupLayout({
    label: 'Trillion3D water tiles',
    entries: kernelEntries(storage(T.mask), storage(T.list), storage(T.args), storage(T.dispatch)),
  })
  const idsLayout = device.createBindGroupLayout({
    label: 'Trillion3D water identifiers',
    entries: kernelEntries(
      entry(T.ids, STAGE.compute, { storageTexture: { access: 'write-only', format: 'r32uint' } }),
    ),
  })
  return { kernelLayout, idsLayout }
}

/** One render pipeline of the water pass, drawing `vertex` and `fragment` of `module` into `format`. */
const sceneStage = (
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  vertex: string,
  fragment: string,
  format: GPUTextureFormat,
  label: string,
): SceneStage => ({
  layout,
  pipeline: preparedPipeline(device, {
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: vertex },
    fragment: { module, entryPoint: fragment, targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  }),
})

/** The copies of the scene without the water: its linear depth, and its colour over the target or the tiles. */
function copyStages(device: GPUDevice) {
  const layout = copyLayout(device)
  const module = device.createShaderModule({
    label: 'Trillion3D water scene copy',
    code: waterCopyShader(),
  })
  return {
    depthCopy: sceneStage(
      device,
      module,
      layout,
      'fullscreen',
      'fsWaterDepthCopy',
      WATER_DEPTH_FORMAT,
      'Trillion3D water scene depth',
    ),
    color: sceneStage(
      device,
      module,
      layout,
      'fullscreen',
      'fsWaterColorCopy',
      HDR_FORMAT,
      'Trillion3D water scene color',
    ),
    colorTiled: sceneStage(
      device,
      module,
      layout,
      'waterTileVertex',
      'fsWaterColorCopy',
      HDR_FORMAT,
      'Trillion3D water scene color tiles',
    ),
  }
}

/** The mask of the refraction. */
const maskStage = (device: GPUDevice) =>
  sceneStage(
    device,
    device.createShaderModule({
      label: 'Trillion3D water refraction mask',
      code: waterMaskShader(),
    }),
    maskLayout(device),
    'fullscreen',
    'fsWaterMask',
    WATER_MASK_FORMAT,
    'Trillion3D water refraction mask',
  )

/** The tiles' kernels module, with subgroup operations or without. */
const kernelModule = (device: GPUDevice, waves: boolean) =>
  device.createShaderModule({ label: 'Trillion3D water tiles', code: waterTileKernels(waves) })

/** The compute pipeline of the kernel `name` of `module`, on `layout`. */
const kernelStage = (
  device: GPUDevice,
  module: GPUShaderModule,
  name: string,
  layout: GPUBindGroupLayout,
) =>
  preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    name,
    undefined,
    'Trillion3D water tiles',
  )

/**
 * The water pass's own programs, one set a device (`waterScenePipelines`): the copies of the scene without
 * the water — its linear depth, and its colour over the whole target (`color`) or the tiles of the list
 * (`colorTiled`) — and the mask of the refraction (`mask`), each on a group 0 of its own
 * (`waterPassWgsl.ts`); the draw of the sun's shadow over the listed tiles (`sunShadow`, `waterSunShadow.ts`); and the tiles' kernels (`marks`, `lists`, the identifiers' `ids`) on theirs
 * (`waterTileWgsl.ts`), one module for the three, and the list's subgroup variant, compiled when it is first
 * asked (`waved`). The groups are made once.
 */
export const waterScenePipelines = oncePerDevice((device) => {
  const { kernelLayout, idsLayout } = kernelLayouts(device)
  const plain = kernelModule(device, false)
  const stages = {
    ...copyStages(device),
    mask: maskStage(device),
    sunShadow: sunShadowStage(device, sunShadowLayout(device), WATER_SUN_FORMAT),
    kernelLayout,
    idsLayout,
    ids: kernelStage(device, plain, 'csWaterIds', idsLayout),
    marks: kernelStage(device, plain, 'csWaterMark', kernelLayout),
    lists: kernelStage(device, plain, 'csWaterList', kernelLayout),
    dispatch: kernelStage(device, plain, 'csWaterDispatch', kernelLayout),
  }
  // The subgroup variant of the list, made at its first ask where the device grants subgroups.
  let waved: PreparedPipeline<GPUComputePipeline> | undefined
  const compiled = [
    stages.depthCopy.pipeline,
    stages.color.pipeline,
    stages.colorTiled.pipeline,
    stages.mask.pipeline,
    stages.ids,
    stages.marks,
    stages.lists,
    stages.dispatch,
    stages.sunShadow.pipeline,
  ]
  return {
    ...stages,
    waved: () =>
      hasSubgroups(device)
        ? (waved ??= kernelStage(device, kernelModule(device, true), 'csWaterList', kernelLayout))
        : undefined,
    prepare: () => Promise.all(compiled.map((pipeline) => pipeline.prepare())),
  }
})
