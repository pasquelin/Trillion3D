import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { layoutsOf } from '../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { standInTexture } from '../../../gpu/core/standIns.ts'
import { preparedPipelines } from '../../../gpu/core/preparedPipelines.ts'
import type { ConeObjectsShape } from './coneObjectsWgsl.ts'
import { DFAO_STAND_IN_FORMAT } from './layout.ts'
import { dfaoLayoutsOf, type DfaoProgram } from './layouts.ts'
import { hasFloat32Filterable } from '../../../gpu/core/float32Filterable.ts'
import { coneObjectsKey, DFAO_SHADERS, dfaoShadersOf } from './shaders.ts'
import { tileScatterPipeline } from '../tileScatter.ts'
import { sphereBuffers } from './sphere.ts'

const LABEL = 'Trillion3D distance-field occlusion'

/** The shaders of the passes that are single stages, by program, and the entry point of each. */
const SINGLE = {
  normals: ['normals', 'dfaoNormals'],
  clear: ['clear', 'dfaoClear'],
  combine: ['combine', 'dfaoCombine'],
  upsampleOnly: ['upsampleOnly', 'dfaoUpsampleOnly'],
  updateHistory: ['updateHistory', 'dfaoUpdateHistory'],
  filterHistory: ['filterHistory', 'dfaoFilterHistory'],
  pack: ['pack', 'dfaoPack'],
  cullObjects: ['cullObjects', 'dfaoCullObjects'],
  tileCones: ['tileCones', 'dfaoTileCones'],
  startOffsets: ['startOffsets', 'dfaoStartOffsets'],
} as const satisfies Partial<Record<DfaoProgram, readonly [keyof typeof DFAO_SHADERS, string]>>

/** The scatter's pipeline over `layout` that draws the bounding sphere's faces and runs the fragment entry `fragment`. */
function scatterPipeline(device: GPUDevice, layout: GPUPipelineLayout) {
  const module = device.createShaderModule({
    label: LABEL + ' scatter',
    code: DFAO_SHADERS.scatter,
  })
  return (fragment: string) =>
    tileScatterPipeline(device, {
      label: `${LABEL} ${fragment}`,
      layout,
      module,
      vertex: 'dfaoObjectCullVs',
      fragment,
      format: DFAO_STAND_IN_FORMAT,
      sphere: true,
    })
}

/**
 * THE OCCLUSION'S PIPELINES, once a device, each prepared off the thread (`PreparedPipeline`): a bind-group layout for
 * every program (`DFAO_LAYOUTS`); the single stages (`SINGLE`); the cones against the global field with and without the
 * meshes' fields beside it, and against the meshes' fields in each shape (`ConeObjectsShape`), made when asked; the
 * scatter's two draws (the count pass and the write pass) of the bounding sphere's faces into a stand-in target
 * that no colour is written to, back faces kept; and the sphere's buffers.
 */
export const dfaoPrograms = oncePerDevice((device: GPUDevice) => {
  const filterableMip = hasFloat32Filterable(device.features)
  const layouts = layoutsOf(device, LABEL, dfaoLayoutsOf(filterableMip))
  const pipelineLayout = (program: DfaoProgram) =>
    device.createPipelineLayout({ bindGroupLayouts: [layouts[program]] })
  const stage = (program: DfaoProgram, shader: keyof typeof DFAO_SHADERS, entry: string) => {
    const label = `${LABEL} ${shader}`
    return preparedComputeStage(
      device,
      pipelineLayout(program),
      device.createShaderModule({ label, code: dfaoShadersOf(filterableMip)[shader] }),
      entry,
      undefined,
      label,
    )
  }
  const single = Object.fromEntries(
    Object.entries(SINGLE).map(([program, [shader, entry]]) => [
      program,
      stage(program as DfaoProgram, shader, entry),
    ]),
  ) as { [K in keyof typeof SINGLE]: ReturnType<typeof stage> }
  const coneGlobal = preparedPipelines((objects: boolean) =>
    stage('coneGlobal', objects ? 'coneGlobalObjects' : 'coneGlobal', 'dfaoConeGlobal'),
  )
  const coneObjects = preparedPipelines(
    (shape: ConeObjectsShape) => stage('coneObjects', coneObjectsKey(shape), 'dfaoConeObjects'),
    coneObjectsKey,
  )
  const scatter = scatterPipeline(device, pipelineLayout('scatter'))
  const sphere = sphereBuffers(device, LABEL)
  return {
    layouts,
    noVectors: standInTexture(device, `${LABEL} no vectors`, 'r32uint').createView(),
    single,
    coneGlobal: (objects: boolean) => coneGlobal.of(objects),
    coneObjects: (shape: ConeObjectsShape) => coneObjects.of(shape),
    countTiles: scatter('dfaoObjectCullCount'),
    writeTiles: scatter('dfaoObjectCullWrite'),
    sphere,
    sampler: postSamplers(device).clamped,
  }
})

/** The occlusion's pipelines of a device (`dfaoPrograms`). */
export type DfaoPrograms = ReturnType<typeof dfaoPrograms>

/** What an image draws, which decides the pipelines it needs. */
export interface DfaoUse {
  /** The cones are traced against the global field. */
  global: boolean
  /** They are traced against the meshes' fields, in `shape`. */
  objects: ConeObjectsShape | undefined
}

/** The single stages that only the meshes' fields need: their culling, tile lists and offsets. */
const OBJECT_STAGES: readonly (keyof DfaoPrograms['single'])[] = [
  'cullObjects',
  'tileCones',
  'startOffsets',
]

/** Asks the pipelines an image of `use` draws with, off the frame, and whether all are compiled: the frames wait for them
 *  (`PreparedPipeline.ask`), so that none is compiled on the frame that binds it. */
export function dfaoProgramsReady(programs: DfaoPrograms, use: DfaoUse) {
  const single = Object.entries(programs.single).filter(
    ([name]) => use.objects || !OBJECT_STAGES.includes(name as keyof DfaoPrograms['single']),
  )
  const wanted: { ask(): { readonly ready: boolean } }[] = single.map(([, stage]) => stage)
  if (use.global) wanted.push(programs.coneGlobal(!!use.objects))
  if (use.objects)
    wanted.push(programs.coneObjects(use.objects), programs.countTiles, programs.writeTiles)
  return wanted.map((pipeline) => pipeline.ask()).every((pipeline) => pipeline.ready)
}
