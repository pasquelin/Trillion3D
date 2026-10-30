/**
 * THE LIT PROGRAM'S PER-LIGHT PASSES (`shadowOnePassProjection` or `clusteredDeferredShading` false): the batched local pass without
 * the shadowed lights (`localPassWgsl`, the loop `unbatched`) and the per-light draw, a pipeline
 * for each class of tile, made at the first frame that takes the path: the program of a scene that never
 * does compiles neither. The draw is `perLightPassWgsl` (its shadow its layer of the light's mask, its group layout the program's own,
 * `perLightLayoutEntries`), or, where the lights are projected in the one pass (`PerLightLights.mask` absent), the local lights' pass
 * for one light (the loop `one`, its shadow its lane of the packed mask, over the local pass's layout and the light's record,
 * `oneLightLayoutEntries`).
 */
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { PER_LIGHT_RECORD_AT, recordOffset } from '../shadows/vsm/projection/perLightRecord.ts'
import type { PerLightLights } from '../shadows/vsm/projection/perLightPass.ts'
import type { ContractKey } from './contractCuts.ts'
import { chainReady, preparedPipeline, type PreparedPipeline } from './fullscreen.ts'
import { oneLightLayoutEntries, perLightLayoutEntries } from './layoutEntries.ts'
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
  { classes, label, toon }: Pick<PerLightSources, 'classes' | 'label'> & { toon: boolean },
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
      lightPipelineDescriptor(
        device,
        modules,
        groupLayout,
        entry,
        `${label}_${name}`,
        tileClass,
        toon ? { writes: true } : undefined,
      ),
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
  // The group layouts are made with the pipelines that use them, at the first frame that takes the path.
  let layout: GPUBindGroupLayout | undefined, oneLayout: GPUBindGroupLayout | undefined
  const layoutOf = () =>
    (layout ??= device.createBindGroupLayout({
      entries: perLightLayoutEntries(
        sources.lobes,
        sources.profiled,
        sources.contact,
        sources.volume,
      ),
    }))
  const oneLayoutOf = () =>
    (oneLayout ??= device.createBindGroupLayout({
      entries: oneLightLayoutEntries(
        sources.lobes,
        sources.profiled,
        sources.contact,
        !!key.sampled,
        sources.volume,
      ),
    }))
  const pipelinesOf = (
    wgsl: (tileClass: TileClass) => WgslDecl,
    entry: string,
    groupLayout: GPUBindGroupLayout,
    name: string,
  ) =>
    classPipelines(device, { classes, label, toon: !!key.toonData }, wgsl, entry, groupLayout, name)
  let unbatched: ClassPipelines | undefined,
    lights: ClassPipelines | undefined,
    one: ClassPipelines | undefined
  const compiledBatched: (GPURenderPipeline | undefined)[] = [],
    compiledLights: (GPURenderPipeline | undefined)[] = [],
    compiledOne: (GPURenderPipeline | undefined)[] = []
  /** The pipelines the path asks, by class: the batched local pass's and the draws' (the one-light local pass's where `packed`). */
  const unbatchedAsk = () =>
    (unbatched ??= pipelinesOf(
      (tileClass) => localPassWgsl(key, tileClass, { loop: 'unbatched' }),
      'localMain',
      sources.localLayout,
      'LOCAL_UNBATCHED',
    ))
  const asks = (packed: boolean) => {
    if (packed)
      one ??= pipelinesOf(
        (tileClass) => localPassWgsl(key, tileClass, { loop: 'one' }),
        'localMain',
        oneLayoutOf(),
        'LOCAL_ONE',
      )
    else
      lights ??= pipelinesOf(
        (tileClass) => perLightPassWgsl(key, tileClass),
        PER_LIGHT_ENTRY,
        layoutOf(),
        'PER_LIGHT',
      )
    return { unbatched: unbatchedAsk(), draws: packed ? one! : lights! }
  }
  return {
    /** The group layout of the per-light draw. */
    get layout() {
      return layoutOf()
    },
    /** The group layout of the one-light local pass (the lights read the packed mask). */
    get oneLayout() {
      return oneLayoutOf()
    },
    /** Whether the passes' pipelines are compiled, those of the draws that read the packed mask where `packed`; the frames wait for them otherwise. */
    ready(packed: boolean) {
      const { unbatched, draws } = asks(packed)
      return chainReady(...unbatched, ...draws)
    },
    /** The compiled pipelines of the batched local pass without the per-light lights, by class. */
    unbatchedLocal: () => compiledOf(unbatchedAsk(), compiledBatched),
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
      const packed = !perLight.mask
      return drawTileClasses(
        pass,
        compiledOf(asks(packed).draws, packed ? compiledOne : compiledLights),
        draws,
      )
    },
  }
}

/** The per-light passes of a lit program. */
export type PerLightProgram = ReturnType<typeof createPerLightProgram>
