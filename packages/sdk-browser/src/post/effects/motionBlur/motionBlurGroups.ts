import { namedEntries, wholeBuffer as whole } from '../../../gpu/core/computeBindings.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { CLASSIFY_BINDINGS, CLASSIFY_TWO_BINDINGS } from './classifyWgsl.ts'
import { GATHER_BINDINGS, GATHER_TWO_BINDINGS, SCATTER_BINDINGS } from './dilateWgsl.ts'
import { FILTER_BINDINGS } from './filterWgsl.ts'
import { FLATTEN_BINDINGS, FLATTEN_TWO_BINDINGS } from './flattenWgsl.ts'
import type { MotionBlurGroups } from './motionBlurEncode.ts'
import { MOTION_BLUR_PARAMS_BYTES, TILE_CLASSES, tileClasses } from './motionBlurLayout.ts'
import type { MotionBlurPrograms } from './motionBlurPrograms.ts'
import type { MotionBlurTargets } from './motionBlurTargets.ts'
import type { TwoDirectionPrograms } from './motionBlurTwoPrograms.ts'
import { FILTER_TWO_BINDINGS } from './weighTwoWgsl.ts'
import type { ResolveFrame } from '../webgpuKinds.ts'

/** A uniform and the words it is written from. */
export type Uniform = { buffer: GPUBuffer; words: ReturnType<typeof wordViews> }

/** A uniform of the blur's parameters. */
export const uniformOf = (device: GPUDevice): Uniform => ({
  buffer: device.createBuffer({
    label: `${MOTION_BLUR_PASS} uniform`,
    size: MOTION_BLUR_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }),
  words: wordViews(new ArrayBuffer(MOTION_BLUR_PARAMS_BYTES)),
})

/** The groups of a pass: its `layout` over `entries`. */
const groupOf = (device: GPUDevice, layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
  device.createBindGroup({ label: MOTION_BLUR_PASS, layout, entries })

/** What the passes before the filter read of the frame: the blur's uniform, the stage's uniform,
 *  vectors and the depth. */
const frameInputs = (params: GPUBufferBinding, frame: ResolveFrame) => ({
  params,
  view: whole(frame.view),
  vectors: frame.vectors,
  depth: frame.depth,
})

/** The groups of the passes before the filter, with one direction: the flattening, the spread by
 *  reading or by drawing, and the classifying, which fills the `nth` blur's lists of the filter
 *  tiles. */
function oneDirectionGroups(
  device: GPUDevice,
  { layouts }: MotionBlurPrograms,
  targets: MotionBlurTargets,
  nth: number,
  params: GPUBufferBinding,
  frame: ResolveFrame,
) {
  const { flat, tilesA, tilesB } = targets.held
  const [gatherHalf, gatherFull, weighHalf, weighFull] = targets.lists(nth).map(whole)
  return {
    flatten: groupOf(
      device,
      layouts.flatten,
      namedEntries(FLATTEN_BINDINGS, {
        ...frameInputs(params, frame),
        flat: flat.view,
        tiles: tilesA.view,
      }),
    ),
    gather: groupOf(
      device,
      layouts.gather,
      namedEntries(GATHER_BINDINGS, { params, tiles: tilesA.view, out: tilesB.view }),
    ),
    gatherDrawn: undefined,
    scatter: groupOf(
      device,
      layouts.scatter,
      namedEntries(SCATTER_BINDINGS, { params, tiles: tilesA.view }),
    ),
    classify: groupOf(
      device,
      layouts.classify,
      namedEntries(CLASSIFY_BINDINGS, {
        params,
        tiles: tilesB.view,
        gatherHalf,
        gatherFull,
        weighHalf,
        weighFull,
      }),
    ),
  }
}

/** The same with two directions, which also name the images of the tiles' second largest motions:
 *  the spread by reading the neighbours reads and writes the ranges and the seconds, the spread by
 *  drawing (`gatherDrawn`) leaves the drawn ranges as they are and spreads the seconds alone. */
function twoDirectionGroups(
  device: GPUDevice,
  { layouts }: MotionBlurPrograms,
  two: TwoDirectionPrograms,
  targets: MotionBlurTargets,
  nth: number,
  params: GPUBufferBinding,
  frame: ResolveFrame,
) {
  const { flat, tilesA, tilesB, secondsA, secondsB } = targets.held
  const [gatherHalf, gatherFull, weighHalf, weighFull, weighTwo] = targets.lists(nth).map(whole)
  const spread = { params, tiles: tilesA.view, tilesSecond: secondsA!.view }
  const group = (layout: GPUBindGroupLayout, entries: GPUBindGroupEntry[]) =>
    groupOf(device, layout, entries)
  return {
    flatten: group(
      two.layouts.flatten,
      namedEntries(FLATTEN_TWO_BINDINGS, {
        ...frameInputs(params, frame),
        flat: flat.view,
        tiles: tilesA.view,
        tilesSecond: secondsA!.view,
      }),
    ),
    gather: group(
      two.layouts.gather,
      namedEntries(GATHER_TWO_BINDINGS, { ...spread, out: tilesB.view, outSecond: secondsB!.view }),
    ),
    gatherDrawn: group(
      two.layouts.gatherDrawn,
      namedEntries(GATHER_TWO_BINDINGS, {
        ...spread,
        centre: tilesB.view,
        outSecond: secondsB!.view,
      }),
    ),
    scatter: group(layouts.scatter, namedEntries(SCATTER_BINDINGS, { params, tiles: tilesA.view })),
    classify: group(
      two.layouts.classify,
      namedEntries(CLASSIFY_TWO_BINDINGS, {
        params,
        tiles: tilesB.view,
        tilesSecond: secondsB!.view,
        gatherHalf,
        gatherFull,
        weighHalf,
        weighFull,
        weighTwo,
      }),
    ),
  }
}

/** The groups of one filter pass, from the image `color` into `blurred`: one a class, each naming
 *  the `nth` blur's list of the tiles of its class; with `two`, the class of two motions too, which
 *  also names the image of the tiles' second largest motions. */
function filterGroups(
  device: GPUDevice,
  { layouts, sampler }: MotionBlurPrograms,
  two: TwoDirectionPrograms | undefined,
  targets: MotionBlurTargets,
  nth: number,
  params: GPUBufferBinding,
  color: GPUTextureView,
  blurred: GPUTextureView,
) {
  const { flat, tilesB, secondsB } = targets.held
  const lists = targets.lists(nth)
  return tileClasses(two ? 2 : 1).map((_, at) => {
    const own = {
      params,
      color,
      sampler,
      flat: flat.view,
      tiles: tilesB.view,
      list: whole(lists[at]),
    }
    return device.createBindGroup({
      label: MOTION_BLUR_PASS,
      layout: two && at === TILE_CLASSES.length ? two.layouts.filter : layouts.filter,
      entries:
        two && at === TILE_CLASSES.length
          ? namedEntries(FILTER_TWO_BINDINGS, { ...own, blurred, tilesSecond: secondsB!.view })
          : namedEntries(FILTER_BINDINGS, { ...own, blurred }),
    })
  })
}

/** The groups the passes of the `nth` blur of the chain are bound with, over the image `input`, the
 *  blurred image `output` and, for two passes, the one `between` (`MotionBlurTargets`); those of
 *  two directions where `two` is given. */
export function bindGroups(
  device: GPUDevice,
  programs: MotionBlurPrograms,
  two: TwoDirectionPrograms | undefined,
  targets: MotionBlurTargets,
  nth: number,
  uniforms: readonly Uniform[],
  frame: ResolveFrame,
  images: { input: GPUTextureView; output: GPUTextureView; between?: GPUTextureView },
): MotionBlurGroups {
  const { input, output, between } = images
  const params = whole(uniforms[0].buffer)
  const filters = (color: GPUTextureView, blurred: GPUTextureView, binding: GPUBufferBinding) =>
    filterGroups(device, programs, two, targets, nth, binding, color, blurred)
  return {
    ...(two
      ? twoDirectionGroups(device, programs, two, targets, nth, params, frame)
      : oneDirectionGroups(device, programs, targets, nth, params, frame)),
    filter: filters(input, between ?? output, params),
    second: between && filters(between, output, whole(uniforms[1].buffer)),
  }
}
