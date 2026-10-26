import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { preparedPipeline } from '../../deferred/fullscreen.ts'
import { DFSH_STAND_IN_FORMAT } from './layout.ts'
import { DFSH_LAYOUTS, type DfshProgram } from './layouts.ts'
import { DFSH_SHADERS } from './shaders.ts'

const LABEL = 'Trillion3D sun distance-field shadow'

/** The compute programs, by name, with the shader and the entry point of each. */
const COMPUTE = {
  cull: ['cull', 'dfshCull'],
  offsets: ['offsets', 'dfshOffsets'],
  trace: ['trace', 'dfshTrace'],
  final: ['final', 'dfshFinalPass'],
} as const satisfies Partial<Record<DfshProgram, readonly [keyof typeof DFSH_SHADERS, string]>>

/**
 * THE SUN'S SHADOW PIPELINES, once a device, each prepared off the thread (`PreparedPipeline`): a
 * bind-group layout for every program (`DFSH_LAYOUTS`); the compute stages (`COMPUTE`); and the
 * scatter's two draws (the count pass and the write pass) of the meshes' cubes, front faces kept,
 * into a stand-in target that no colour is written to.
 */
export const dfshPrograms = oncePerDevice((device: GPUDevice) => {
  const layouts = Object.fromEntries(
    Object.entries(DFSH_LAYOUTS).map(([name, entries]) => [
      name,
      device.createBindGroupLayout({ label: `${LABEL} ${name}`, entries: [...entries] }),
    ]),
  ) as Record<DfshProgram, GPUBindGroupLayout>
  const pipelineLayout = (program: DfshProgram) =>
    device.createPipelineLayout({ bindGroupLayouts: [layouts[program]] })
  const compute = Object.fromEntries(
    Object.entries(COMPUTE).map(([program, [shader, entry]]) => {
      const label = `${LABEL} ${shader}`
      return [
        program,
        preparedComputeStage(
          device,
          pipelineLayout(program as DfshProgram),
          device.createShaderModule({ label, code: DFSH_SHADERS[shader] }),
          entry,
          undefined,
          label,
        ),
      ]
    }),
  ) as { [K in keyof typeof COMPUTE]: ReturnType<typeof preparedComputeStage> }
  const scatterLabel = `${LABEL} scatter`
  const scatterModule = device.createShaderModule({
    label: scatterLabel,
    code: DFSH_SHADERS.scatter,
  })
  const scatter = (fragment: string) =>
    preparedPipeline(device, {
      label: `${LABEL} ${fragment}`,
      layout: pipelineLayout('scatter'),
      vertex: { module: scatterModule, entryPoint: 'dfshScatterVs' },
      fragment: {
        module: scatterModule,
        entryPoint: fragment,
        targets: [{ format: DFSH_STAND_IN_FORMAT, writeMask: 0 }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    })
  return {
    layouts,
    compute,
    countTiles: scatter('dfshScatterCount'),
    writeTiles: scatter('dfshScatterWrite'),
  }
})

/** The sun's shadow pipelines of a device (`dfshPrograms`). */
export type DfshPrograms = ReturnType<typeof dfshPrograms>

/** Asks every pipeline off the frame, and whether all are compiled: the frames wait for them
 *  (`PreparedPipeline.ask`), so that none is compiled on the frame that binds it. */
export function dfshProgramsReady(programs: DfshPrograms) {
  const wanted: { ask(): { readonly ready: boolean } }[] = [
    ...Object.values(programs.compute),
    programs.countTiles,
    programs.writeTiles,
  ]
  return wanted.map((pipeline) => pipeline.ask()).every((pipeline) => pipeline.ready)
}
