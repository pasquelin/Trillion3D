import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { buildComputeStage } from '../../../gpu/core/computeStages.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { CLASSIFY_BINDINGS, CLASSIFY_TWO_BINDINGS, classifyShader } from './classifyWgsl.ts'
import { GATHER_BINDINGS, GATHER_TWO_BINDINGS, gatherShader } from './dilateWgsl.ts'
import { FILTER_BINDINGS, filterShader } from './filterWgsl.ts'
import { FLATTEN_BINDINGS, FLATTEN_TWO_BINDINGS, flattenShader } from './flattenWgsl.ts'
import {
  FILTER_TILE,
  FLAT_FORMS,
  OUTPUT_FORMAT,
  TILE_CLASSES,
  TILE_CLASSES_TWO,
  TILE_FORMAT,
  isHalfClass,
  type BlurVariant,
  type TileClass,
} from './motionBlurLayout.ts'
import { FILTER_TWO_BINDINGS, filterTwoShader } from './weighTwoWgsl.ts'

/** The pipeline constants of each class's filter (`filterShader`): the workgroup's side, and whether
 *  its tiles are gathered at half the resolution and weighed. */
const classConstants = (kind: TileClass) => ({
  TILE: isHalfClass(kind) ? FILTER_TILE / 2 : FILTER_TILE,
  HALF_RES: isHalfClass(kind) ? 1 : 0,
  WEIGH: kind.startsWith('weigh') ? 1 : 0,
})

/** The compute pipelines one blur's passes run: the flattening, the gathered spread, the
 *  classifying and the filter of each class of tile, in the order of its classes. */
export type Kit = {
  flatten: GPUComputePipeline
  gather: GPUComputePipeline
  classify: GPUComputePipeline
  filters: readonly GPUComputePipeline[]
}

/** The bind group layout of each pass of a variant of the blur: those of the flattening and the filter
 *  follow the form of the flattened motion, those of the gathering, the classifying and the class of
 *  two motions (`filterTwo`) the directions. */
type VariantLayouts = {
  flatten: GPUBindGroupLayout
  gather: GPUBindGroupLayout
  /** The gathering of the second largest motions beside the ranges the drawn spread made (two
   *  directions alone). */
  gatherDrawn: GPUBindGroupLayout | undefined
  classify: GPUBindGroupLayout
  filter: GPUBindGroupLayout
  filterTwo: GPUBindGroupLayout | undefined
}

/** A variant of the blur's programs: what it is for, its layouts, and the pipelines of a blur whose
 *  spread is read from the neighbours (`read`) or drawn (`drawn`). */
export type VariantPrograms = {
  variant: BlurVariant
  layouts: VariantLayouts
  kits: { read: Kit; drawn: Kit }
}

const read = (binding: number) => computeTextureEntry(binding, 'unfilterable-float')
const written = (binding: number) => computeStorageTextureEntry(binding, TILE_FORMAT)

/** The layout entries of the flattening of a variant. */
const flattenEntries = ({ directions, flat }: BlurVariant): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(FLATTEN_BINDINGS.params),
  computeUniformEntry(FLATTEN_BINDINGS.view),
  computeTextureEntry(FLATTEN_BINDINGS.vectors, 'uint'),
  computeTextureEntry(FLATTEN_BINDINGS.depth, 'depth'),
  computeStorageTextureEntry(FLATTEN_BINDINGS.flat, FLAT_FORMS[flat].format),
  written(FLATTEN_BINDINGS.tiles),
  ...(directions > 1 ? [written(FLATTEN_TWO_BINDINGS.tilesSecond)] : []),
]

/** The layout entries of the filter of the classes of one motion, over a flattened motion of `flat`'s form. */
const filterEntries = (flat: BlurVariant['flat']): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(FILTER_BINDINGS.params),
  computeTextureEntry(FILTER_BINDINGS.color, 'float'),
  computeSamplerEntry(FILTER_BINDINGS.sampler, 'filtering'),
  computeTextureEntry(FILTER_BINDINGS.flat, FLAT_FORMS[flat].sample),
  read(FILTER_BINDINGS.tiles),
  computeBufferEntry(FILTER_BINDINGS.list, 'read-only-storage', GPUShaderStage.COMPUTE),
  computeStorageTextureEntry(FILTER_BINDINGS.blurred, OUTPUT_FORMAT),
]

/** The layouts of the passes the directions decide: the gathering and the classifying of one motion,
 *  or of two — the gathering twice, over the ranges the neighbours' reading made or the drawn
 *  spread, and the class of two motions' filter. */
function directionLayouts(device: GPUDevice, { directions, flat }: BlurVariant) {
  const layout = (label: string, entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label: `${MOTION_BLUR_PASS} ${label}`, entries })
  const compute = GPUShaderStage.COMPUTE
  if (directions < 2)
    return {
      gather: layout('gather', [
        computeUniformEntry(GATHER_BINDINGS.params),
        read(GATHER_BINDINGS.tiles),
        written(GATHER_BINDINGS.out),
      ]),
      classify: layout('classify', [
        computeUniformEntry(CLASSIFY_BINDINGS.params),
        read(CLASSIFY_BINDINGS.tiles),
        ...TILE_CLASSES.map((kind) =>
          computeBufferEntry(CLASSIFY_BINDINGS[kind], 'storage', compute),
        ),
      ]),
    }
  const gather = [
    computeUniformEntry(GATHER_TWO_BINDINGS.params),
    read(GATHER_TWO_BINDINGS.tiles),
    read(GATHER_TWO_BINDINGS.tilesSecond),
    written(GATHER_TWO_BINDINGS.outSecond),
  ]
  return {
    gather: layout('gather two', [...gather, written(GATHER_TWO_BINDINGS.out)]),
    gatherDrawn: layout('gather two drawn', [...gather, read(GATHER_TWO_BINDINGS.centre)]),
    classify: layout('classify two', [
      computeUniformEntry(CLASSIFY_TWO_BINDINGS.params),
      read(CLASSIFY_TWO_BINDINGS.tiles),
      read(CLASSIFY_TWO_BINDINGS.tilesSecond),
      ...TILE_CLASSES_TWO.map((kind) =>
        computeBufferEntry(CLASSIFY_TWO_BINDINGS[kind], 'storage', compute),
      ),
    ]),
    filterTwo: layout('filter two', [
      ...filterEntries(flat),
      read(FILTER_TWO_BINDINGS.tilesSecond),
    ]),
  }
}

/** The layouts of a variant: its own where its form or its directions decide them, the base's
 *  (`base`) where the pass is the same. */
function variantLayouts(
  device: GPUDevice,
  variant: BlurVariant,
  base: VariantLayouts | undefined,
): VariantLayouts {
  const layout = (label: string, entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label: `${MOTION_BLUR_PASS} ${label}`, entries })
  const own = base && variant.directions < 2 ? base : undefined
  const directions = own ?? directionLayouts(device, variant)
  return {
    flatten: layout('flatten', flattenEntries(variant)),
    gather: directions.gather,
    gatherDrawn: 'gatherDrawn' in directions ? directions.gatherDrawn : undefined,
    classify: directions.classify,
    filter: layout('filter', filterEntries(variant.flat)),
    filterTwo: 'filterTwo' in directions ? directions.filterTwo : undefined,
  }
}

/** The compute stage `entryPoint` of `made` on `layout`, its overrides `constants`. */
const stageOf =
  (device: GPUDevice) =>
  async (
    layout: GPUBindGroupLayout,
    made: Promise<GPUShaderModule>,
    entryPoint: string,
    constants?: Record<string, number>,
  ) =>
    buildComputeStage(device, [layout], await made, entryPoint, constants, MOTION_BLUR_PASS)

/** The name a module of the blur is labelled by. */
const label = (name: string) => `${MOTION_BLUR_PASS} ${name}`

/** What a variant compiles that is its own: the flattening, the filter of each class, and, where
 *  `reusing` is not, the gathering and the classifying of its directions. */
async function compileStages(
  device: GPUDevice,
  layouts: VariantLayouts,
  { directions, flat }: BlurVariant,
  subgroups: boolean,
  reusing: boolean,
) {
  const stage = stageOf(device)
  const filters = createCheckedShaderModule(
    device,
    filterShader({ flat, subgroups }),
    label('filter'),
  )
  const [flatten, gather, classify, ...classes] = await Promise.all([
    stage(
      layouts.flatten,
      createCheckedShaderModule(device, flattenShader(directions, flat), label('flatten')),
      'flattenMotion',
    ),
    reusing
      ? undefined
      : stage(
          layouts.gather,
          createCheckedShaderModule(device, gatherShader(directions), label('gather')),
          'dilateGather',
        ),
    reusing
      ? undefined
      : stage(
          layouts.classify,
          createCheckedShaderModule(device, classifyShader(directions), label('classify')),
          'classifyTiles',
          groupWidthConstants(groupWidth(device.limits)),
        ),
    ...TILE_CLASSES.map((kind) =>
      stage(layouts.filter, filters, 'filterTiles', classConstants(kind)),
    ),
  ])
  return { flatten, gather, classify, filters: classes }
}

/** What the variants of two directions add: the gathering of the second largest motions over the
 *  spread drawn, and the filter of the class of two motions. */
async function compileTwoStages(
  device: GPUDevice,
  { gatherDrawn, filterTwo }: VariantLayouts,
  { flat }: BlurVariant,
  subgroups: boolean,
) {
  const stage = stageOf(device)
  const [gather, filter] = await Promise.all([
    stage(
      gatherDrawn!,
      createCheckedShaderModule(device, gatherShader(2, true), label('gather drawn')),
      'dilateGather',
    ),
    stage(
      filterTwo!,
      createCheckedShaderModule(device, filterTwoShader({ flat, subgroups }), label('filter two')),
      'filterTwoTiles',
    ),
  ])
  return { gatherDrawn: gather, filterTwo: filter }
}

/**
 * The programs of one variant of the blur (`BlurVariant`), compiled together off the thread: the
 * flattening, the gathering — of the second largest motions too, over the drawn spread or not, with
 * two directions —, the classifying, and the filter of each class of tile, one more for the class of
 * two motions; `subgroups` the filters' density and vote the subgroup's. Where the variant is of one
 * direction its gathering and classifying are `base`'s, which they do not differ from.
 */
export async function createVariantPrograms(
  device: GPUDevice,
  variant: BlurVariant,
  subgroups: boolean,
  base?: VariantPrograms,
): Promise<VariantPrograms> {
  const layouts = variantLayouts(device, variant, base?.layouts)
  const reused = base && variant.directions < 2 ? base.kits.read : undefined
  const [made, two] = await Promise.all([
    compileStages(device, layouts, variant, subgroups, !!reused),
    variant.directions > 1 ? compileTwoStages(device, layouts, variant, subgroups) : undefined,
  ])
  const kit = (spread: GPUComputePipeline | undefined): Kit => ({
    flatten: made.flatten,
    gather: spread ?? reused!.gather,
    classify: made.classify ?? reused!.classify,
    filters: two ? [...made.filters, two.filterTwo] : made.filters,
  })
  return {
    variant,
    layouts,
    kits: { read: kit(made.gather), drawn: kit(two?.gatherDrawn ?? made.gather) },
  }
}
