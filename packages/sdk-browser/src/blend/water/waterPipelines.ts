import { FEEDBACK_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import { feedbackConstants } from '../../materials/virtual/requestWgsl.ts'
import { KEEP_ALPHA, LIGHT_THROUGH } from '../../materials/surface/materialBlending.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { reflectedGroups, stageDescriptors } from '../stagePipelines.ts'
import { cullOf } from '../plan/planCull.ts'
import { emptyLayout } from '../transmission/distortionGroups.ts'
import { WATER_EXCLUSION_BINDING } from './waterExclusionTable.ts'
import { PLAIN_VARIANT, type BlendVariant } from '../variant.ts'
import { WATER_BINDINGS, WATER_NORMALS_FORMAT, WATER_SPECULAR_FORMAT } from './waterLayout.ts'
import {
  STAGE,
  VERTEX_FRAGMENT,
  WATER_SUN_FORMAT,
  waterScenePipelines,
} from './waterSceneStages.ts'

/** The layout of the water's group in the blend module (`WATER_GROUP`, `waterLayout.ts`). One a device. */
const groupLayout = (device: GPUDevice, exclusion: boolean) =>
  device.createBindGroupLayout({
    label: 'Trillion3D water',
    entries: [
      { binding: WATER_BINDINGS.params, visibility: VERTEX_FRAGMENT, buffer: { type: 'uniform' } },
      {
        binding: WATER_BINDINGS.color,
        visibility: STAGE.fragment,
        texture: { sampleType: 'float' },
      },
      {
        binding: WATER_BINDINGS.depth,
        visibility: STAGE.fragment,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: WATER_BINDINGS.mask,
        visibility: STAGE.fragment,
        texture: { sampleType: 'float' },
      },
      {
        binding: WATER_BINDINGS.point,
        visibility: STAGE.fragment,
        sampler: { type: 'non-filtering' },
      },
      {
        binding: WATER_BINDINGS.normals,
        visibility: STAGE.fragment,
        texture: { sampleType: 'float' },
      },
      {
        binding: WATER_BINDINGS.specular,
        visibility: STAGE.fragment,
        texture: { sampleType: 'float' },
      },
      {
        binding: WATER_BINDINGS.waterDepth,
        visibility: STAGE.fragment,
        texture: { sampleType: 'depth' },
      },
      {
        binding: WATER_BINDINGS.tiles,
        visibility: STAGE.vertex,
        buffer: { type: 'read-only-storage' },
      },
      { binding: WATER_BINDINGS.sun, visibility: STAGE.fragment, texture: { sampleType: 'float' } },
      ...(exclusion
        ? [
            {
              binding: WATER_EXCLUSION_BINDING,
              visibility: STAGE.fragment,
              buffer: { type: 'read-only-storage' as const },
            },
          ]
        : []),
    ],
  })

const plainLayout = oncePerDevice((device) => groupLayout(device, false))
const excludingLayout = oncePerDevice((device) => groupLayout(device, true))

/** The layout of the water's group: with `exclusion`, the variant for a world that holds an exclusion volume, which adds the volumes' table. */
export const waterGroupLayout = (device: GPUDevice, exclusion = false) =>
  (exclusion ? excludingLayout : plainLayout)(device)

/**
 * What a blend program draws its single-layer water with: its three culls each of the water's
 * depth (`depth`, `fsWaterDepth`: no colour, the depth written), of its shading (`shade`, `fsWater`: the
 * scene's colour, the virtual textures' request, the water's surface and, in a program that keeps the sun
 * apart, the separated sun; the depth written or only tested — after the depth pass has written it —) and
 * of the composite (`composite`, `fsWaterComposite`: over the whole target or, `tiled`, the tiles of the
 * list), then the compile of all. The pipelines of a rank are picked by its cull (`cullOf`).
 */
export interface WaterPipelines {
  /** Each, none until it is compiled: the draw that needs it is skipped. */
  depth(rank: number): GPURenderPipeline | undefined
  shade(rank: number, writesDepth: boolean): GPURenderPipeline | undefined
  composite(tiled: boolean): GPURenderPipeline | undefined
  /** Whether the shading writes the separated sun beside. */
  readonly separate: boolean
  /** Whether the programs are the variant for a world with an exclusion volume: the depth pass binds the water's group too, after an empty group at the reflection's place. */
  readonly exclusion: boolean
  /** The pipelines of the passes an image draws, every cull each (`chainReady`): the shading, the
   *  depth pass `prepass`, the composite (`composite`: over the tiles or not, none when not drawn). */
  chain(steps: { prepass: boolean; composite: boolean | undefined }): PreparedPipeline<unknown>[]
  prepare(): Promise<unknown>
}

/** The colour targets of the water's shading: the scene, the request, the surface and the separated sun. */
const waterShadeTargets = (feedback: boolean, separate: boolean) => [
  { format: HDR_FORMAT },
  feedback ? { format: FEEDBACK_FORMAT } : null,
  { format: WATER_NORMALS_FORMAT },
  { format: WATER_SPECULAR_FORMAT },
  ...(separate ? [{ format: WATER_SUN_FORMAT }] : []),
]

/** The composite's two pipelines, over the whole target and over the tiles of the list. */
function compositePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  groups: GPUBindGroupLayout[],
) {
  // The composite adds over the water: `src + dst · srcAlpha`, the alpha one above the water.
  const added: GPUColorTargetState = {
    format: HDR_FORMAT,
    blend: {
      color: LIGHT_THROUGH,
      alpha: KEEP_ALPHA,
    },
  }
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout, ...groups] })
  return [false, true].map((tiled) =>
    preparedPipeline(device, {
      label: 'Trillion3D water composite',
      layout: pipelineLayout,
      vertex: { module, entryPoint: tiled ? 'waterTileVertex' : 'fullscreen' },
      fragment: { module, entryPoint: 'fsWaterComposite', targets: [added] },
      primitive: { topology: 'triangle-list' },
    }),
  )
}

/** The water pipelines of the blend program `module`, whose bind group is `layout`; `feedback`
 *  whether its pipelines write the virtual textures' request, `separate` whether the program keeps the sun apart. */
export function createWaterPipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback: boolean,
  separate: boolean,
  world: BlendVariant = PLAIN_VARIANT,
): WaterPipelines {
  const { exclusion } = world
  const prepared = (
    entryPoint: string,
    targets: (GPUColorTargetState | null)[],
    depthWrite: boolean,
    groups: GPUBindGroupLayout[],
  ) =>
    stageDescriptors(
      device,
      module,
      layout,
      { module, entryPoint, constants: feedbackConstants(feedback), targets },
      depthWrite,
      groups,
    ).map((descriptor) => preparedPipeline(device, descriptor))
  const groups = [...reflectedGroups(device), waterGroupLayout(device, exclusion)]
  // The depth pass runs before the lights: it binds no reflection group, an empty one holds its place before the water's.
  const depth = prepared(
    'fsWaterDepth',
    [],
    true,
    exclusion ? [emptyLayout(device), waterGroupLayout(device, true)] : [],
  )
  const colour = waterShadeTargets(feedback, separate)
  const shade = [
    prepared('fsWater', colour, false, groups),
    prepared('fsWater', colour, true, groups),
  ]
  const composite = compositePipelines(device, module, layout, groups)
  return {
    separate,
    exclusion,
    depth: (rank) => depth[cullOf(rank)].get(),
    shade: (rank, writesDepth) => shade[+writesDepth][cullOf(rank)].get(),
    composite: (tiled) => composite[+tiled].get(),
    chain: ({ prepass, composite: tiled }) => [
      ...(prepass ? depth : []),
      ...shade[+!prepass],
      ...(tiled === undefined ? [] : [composite[+tiled]]),
    ],
    prepare: () =>
      Promise.all([
        waterScenePipelines(device).prepare(),
        ...[...depth, ...shade.flat(), ...composite].map((pipeline) => pipeline.prepare()),
      ]),
  }
}
