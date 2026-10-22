import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { CLASSIFY_TWO_BINDINGS, classifyShader } from './classifyWgsl.ts'
import { GATHER_TWO_BINDINGS, gatherShader } from './dilateWgsl.ts'
import { FLATTEN_TWO_BINDINGS, flattenShader } from './flattenWgsl.ts'
import { TILE_CLASSES_TWO, TILE_FORMAT } from './motionBlurLayout.ts'
import {
  blurStage,
  filterEntries,
  flattenEntries,
  type Kit,
  type MotionBlurPrograms,
} from './motionBlurPrograms.ts'
import { FILTER_TWO_BINDINGS, filterTwoShader } from './weighTwoWgsl.ts'

/** The bind group layout of each pass of the blur with two directions that differs from its pass
 *  of one: the second largest motions read and written beside the ranges. */
function twoLayouts(device: GPUDevice) {
  const compute = GPUShaderStage.COMPUTE
  const layout = (label: string, entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label: `${MOTION_BLUR_PASS} ${label}`, entries })
  const read = (binding: number) => computeTextureEntry(binding, 'unfilterable-float')
  const written = (binding: number) => computeStorageTextureEntry(binding, TILE_FORMAT)
  const gather = [
    computeUniformEntry(GATHER_TWO_BINDINGS.params),
    read(GATHER_TWO_BINDINGS.tiles),
    read(GATHER_TWO_BINDINGS.tilesSecond),
    written(GATHER_TWO_BINDINGS.outSecond),
  ]
  return {
    flatten: layout('flatten two', [
      ...flattenEntries(),
      written(FLATTEN_TWO_BINDINGS.tilesSecond),
    ]),
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
    filter: layout('filter two', [...filterEntries(), read(FILTER_TWO_BINDINGS.tilesSecond)]),
  }
}

/**
 * The programs of the blur with two directions, compiled off the thread at the first image that
 * asks for them (`webgpuMotionBlur.ts`), beside those of one (`programs`): the flattening, the
 * classifying and the gathering of the spread — read, or, where the largest motions were drawn,
 * leaving the drawn ranges as they are — each with its tiles' second largest motions, and the
 * filter of the class of two motions. The filters of the classes of one motion, and the draws of
 * the spread, are the ones `programs` made. The two kits hold what a blur runs, the spread read or
 * drawn.
 */
export async function createTwoDirectionPrograms(device: GPUDevice, programs: MotionBlurPrograms) {
  const layouts = twoLayouts(device)
  const [flatten, gather, gatherDrawn, classify, filterTwo] = await Promise.all([
    blurStage(
      device,
      layouts.flatten,
      createCheckedShaderModule(device, flattenShader(2), `${MOTION_BLUR_PASS} flatten two`),
      'flattenMotion',
    ),
    blurStage(
      device,
      layouts.gather,
      createCheckedShaderModule(device, gatherShader(2), `${MOTION_BLUR_PASS} gather two`),
      'dilateGather',
    ),
    blurStage(
      device,
      layouts.gatherDrawn,
      createCheckedShaderModule(
        device,
        gatherShader(2, true),
        `${MOTION_BLUR_PASS} gather two drawn`,
      ),
      'dilateGather',
    ),
    blurStage(
      device,
      layouts.classify,
      createCheckedShaderModule(device, classifyShader(2), `${MOTION_BLUR_PASS} classify two`),
      'classifyTiles',
      groupWidthConstants(groupWidth(device.limits)),
    ),
    blurStage(
      device,
      layouts.filter,
      createCheckedShaderModule(device, filterTwoShader(), `${MOTION_BLUR_PASS} filter two`),
      'filterTwoTiles',
    ),
  ])
  const filters = [...programs.kit.filters, filterTwo]
  const kits = {
    read: { flatten, gather, classify, filters },
    drawn: { flatten, gather: gatherDrawn, classify, filters },
  } satisfies Record<string, Kit>
  return { layouts, kits }
}

/** The programs of the blur with two directions (`createTwoDirectionPrograms`). */
export type TwoDirectionPrograms = Awaited<ReturnType<typeof createTwoDirectionPrograms>>
