/**
 * THE LIT PROGRAM'S PER-LIGHT PASSES (`shadowOnePassProjection` false): the batched local pass without
 * the shadowed lights (`localPassWgsl` with `skipHeld`) and the per-light draw (`perLightPassWgsl`), a pipeline
 * for each class of tile, made at the first frame that takes the path: the program of a scene that never
 * does compiles neither. The draw's group layout is the program's own (`perLightLayoutEntries`).
 */
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { PER_LIGHT_RECORD_AT, recordOffset } from '../shadows/vsm/projection/perLightRecord.ts'
import type { PerLightLights } from '../shadows/vsm/projection/perLightPass.ts'
import type { ContractKey } from './contractCuts.ts'
import { chainReady, preparedPipeline, type PreparedPipeline } from './fullscreen.ts'
import { perLightLayoutEntries } from './layoutEntries.ts'
import { localPassWgsl } from './lightPassWgsl.ts'
import { PER_LIGHT_ENTRY, perLightPassWgsl } from './perLightPassWgsl.ts'
import { drawTileClasses, lightPipelineDescriptor } from './tilePass.ts'
import { TILE_CLASS_NAMES, TILE_CLASSES, type TileClass } from './tileClass.ts'

/** A pass's pipelines, one for each class of tile. */
type ClassPipelines = PreparedPipeline<GPURenderPipeline>[]

/** What the per-light passes are made for: the program's key, the classes it holds code for, whether its surfaces carry lobes,
 *  whether it reads the light profiles and holds contact shadow code, the program's label and its local pass's group layout. */
export interface PerLightSources {
  key: ContractKey
  classes: readonly TileClass[]
  lobes: boolean
  profiled: boolean
  contact: boolean
  /** Whether the draw reads the volumes' shadows (`ContractKey.volumeShadow`). */
  volume: boolean
  label: string
  localLayout: GPUBindGroupLayout
}

/** A pipeline for each class of tile of the pass `wgsl` writes, the entry `entry` over `groupLayout`; the
 *  classes the program holds no code for use the highest it holds (`moduleOfClass`). */
function classPipelines(
  device: GPUDevice,
  { classes, label }: Pick<PerLightSources, 'classes' | 'label'>,
  wgsl: (tileClass: TileClass) => WgslDecl,
  entry: string,
  groupLayout: GPUBindGroupLayout,
  name: string,
): ClassPipelines {
  const modules = classes.map((tileClass) => {
    const named = `${label}_${name}_${TILE_CLASS_NAMES[tileClass]}`
    return device.createShaderModule({ label: named, code: wgslModule(wgsl(tileClass)) })
  })
  return TILE_CLASSES.map((tileClass) =>
    preparedPipeline(
      device,
      lightPipelineDescriptor(device, modules, groupLayout, entry, `${label}_${name}`, tileClass),
    ),
  )
}

/** The pipelines of `set` that are compiled, by class, in `into`. */
function compiledOf(set: ClassPipelines, into: (GPURenderPipeline | undefined)[]) {
  into.length = 0
  for (const pipeline of set) into.push(pipeline.get())
  return into
}

/** Sets light `i`'s record at its offset in `group`, and the scissor to the pixels the light reaches. */
function scissorToLight(
  pass: GPURenderPassEncoder,
  group: GPUBindGroup,
  perLight: PerLightLights,
  i: number,
) {
  const { ints } = perLight
  const at = i * (perLight.stride / 4) + PER_LIGHT_RECORD_AT.rect
  pass.setBindGroup(0, group, recordOffset(perLight.offsets, i))
  pass.setScissorRect(ints[at], ints[at + 1], ints[at + 2] - ints[at], ints[at + 3] - ints[at + 1])
}

/** The per-light passes of a lit program (`createLitProgram`). */
export function createPerLightProgram(device: GPUDevice, sources: PerLightSources) {
  const { key, classes, label } = sources
  const layout = device.createBindGroupLayout({
    entries: perLightLayoutEntries(
      sources.lobes,
      sources.profiled,
      sources.contact,
      sources.volume,
    ),
  })
  const pipelinesOf = (
    wgsl: (tileClass: TileClass) => WgslDecl,
    entry: string,
    groupLayout: GPUBindGroupLayout,
    name: string,
  ) => classPipelines(device, { classes, label }, wgsl, entry, groupLayout, name)
  let unbatched: ClassPipelines | undefined, lights: ClassPipelines | undefined
  const compiledBatched: (GPURenderPipeline | undefined)[] = [],
    compiledLights: (GPURenderPipeline | undefined)[] = []
  const asks = () => {
    unbatched ??= pipelinesOf(
      (tileClass) => localPassWgsl(key, tileClass, { skipHeld: true }),
      'localMain',
      sources.localLayout,
      'LOCAL_UNBATCHED',
    )
    lights ??= pipelinesOf(
      (tileClass) => perLightPassWgsl(key, tileClass),
      PER_LIGHT_ENTRY,
      layout,
      'PER_LIGHT',
    )
    return { unbatched, lights }
  }
  return {
    /** The group layout of the per-light draw. */
    layout,
    /** Whether the passes' pipelines are compiled; the frames wait for them otherwise. */
    ready() {
      const { unbatched, lights } = asks()
      return chainReady(...unbatched, ...lights)
    },
    /** The compiled pipelines of the batched local pass without the per-light lights, by class. */
    unbatchedLocal: () => compiledOf(asks().unbatched, compiledBatched),
    /** Draws light `i` of `perLight` into `pass`, over the tiles `draws` lists: the light's record at its
     *  offset in `group`, the pixels the light reaches the only ones drawn. Returns the draws made. */
    drawLight(
      pass: GPURenderPassEncoder,
      group: GPUBindGroup,
      draws: GPUBuffer,
      perLight: PerLightLights,
      i: number,
    ) {
      scissorToLight(pass, group, perLight, i)
      return drawTileClasses(pass, compiledOf(asks().lights, compiledLights), draws)
    },
  }
}

/** The per-light passes of a lit program. */
export type PerLightProgram = ReturnType<typeof createPerLightProgram>
