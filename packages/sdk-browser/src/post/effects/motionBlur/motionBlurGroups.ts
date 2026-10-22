import { namedGroup, wholeBuffer as whole } from '../../../gpu/core/computeBindings.ts'
import { uniformBlock } from '../../../gpu/core/uniformBlock.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { CLASSIFY_BINDINGS, CLASSIFY_TWO_BINDINGS } from './classifyWgsl.ts'
import { GATHER_BINDINGS, GATHER_TWO_BINDINGS, SCATTER_BINDINGS } from './dilateWgsl.ts'
import { FILTER_BINDINGS } from './filterWgsl.ts'
import { FLATTEN_BINDINGS, FLATTEN_TWO_BINDINGS } from './flattenWgsl.ts'
import type { MotionBlurGroups } from './motionBlurEncode.ts'
import { MOTION_BLUR_PARAMS_BYTES, TILE_CLASSES, tileClasses } from './motionBlurLayout.ts'
import type { MotionBlurPrograms } from './motionBlurPrograms.ts'
import type { MotionBlurTargets } from './motionBlurTargets.ts'
import type { VariantPrograms } from './motionBlurVariants.ts'
import { FILTER_TWO_BINDINGS } from './weighTwoWgsl.ts'
import type { ResolveFrame } from '../webgpuKinds.ts'

/** A uniform and the words it is written from. */
export type Uniform = ReturnType<typeof uniformBlock>

/** A uniform of the blur's parameters. */
export const uniformOf = (device: GPUDevice): Uniform =>
  uniformBlock(device, `${MOTION_BLUR_PASS} uniform`, MOTION_BLUR_PARAMS_BYTES)

/** What the groups of a blur are made of: the device, the programs of the variant it is drawn with,
 *  and the shared ones (the drawn spread's layout), the targets and lists, the blur's uniform and the
 *  frame. */
type Context = {
  device: GPUDevice
  programs: MotionBlurPrograms
  vp: VariantPrograms
  targets: MotionBlurTargets
  nth: number
  params: GPUBufferBinding
  frame: ResolveFrame
}

/** What the passes before the filter read of the frame: the blur's uniform, the stage's uniform,
 *  vectors and the depth. */
const frameInputs = ({ params, frame }: Context) => ({
  params,
  view: whole(frame.view),
  vectors: frame.vectors,
  depth: frame.depth,
})

/** A group of a pass of the blur. */
const group = <Name extends string>(
  { device }: Context,
  layout: GPUBindGroupLayout,
  bindings: Record<Name, number>,
  resources: Partial<Record<Name, GPUBindingResource>>,
) => namedGroup(device, layout, bindings, resources, MOTION_BLUR_PASS)

/** The groups of the passes before the filter, with one direction: the flattening, the spread by
 *  reading or by drawing, and the classifying, which fills the `nth` blur's lists of the filter
 *  tiles. */
function oneDirectionGroups(c: Context) {
  const { flat, tilesA, tilesB } = c.targets.held
  const [gatherHalf, gatherFull, weighHalf, weighFull] = c.targets.lists(c.nth).map(whole)
  const { layouts } = c.vp
  return {
    flatten: group(c, layouts.flatten, FLATTEN_BINDINGS, {
      ...frameInputs(c),
      flat: flat.view,
      tiles: tilesA.view,
    }),
    gather: group(c, layouts.gather, GATHER_BINDINGS, {
      params: c.params,
      tiles: tilesA.view,
      out: tilesB.view,
    }),
    gatherDrawn: undefined,
    classify: group(c, layouts.classify, CLASSIFY_BINDINGS, {
      params: c.params,
      tiles: tilesB.view,
      gatherHalf,
      gatherFull,
      weighHalf,
      weighFull,
    }),
  }
}

/** The same with two directions, which also name the images of the tiles' second largest motions:
 *  the spread by reading the neighbours reads and writes the ranges and the seconds, the spread by
 *  drawing (`gatherDrawn`) leaves the drawn ranges as they are and spreads the seconds alone. */
function twoDirectionGroups(c: Context) {
  const { flat, tilesA, tilesB, secondsA, secondsB } = c.targets.held
  const [gatherHalf, gatherFull, weighHalf, weighFull, weighTwo] = c.targets.lists(c.nth).map(whole)
  const layouts = c.vp.layouts
  const spread = { params: c.params, tiles: tilesA.view, tilesSecond: secondsA!.view }
  return {
    flatten: group(c, layouts.flatten, FLATTEN_TWO_BINDINGS, {
      ...frameInputs(c),
      flat: flat.view,
      tiles: tilesA.view,
      tilesSecond: secondsA!.view,
    }),
    gather: group(c, layouts.gather, GATHER_TWO_BINDINGS, {
      ...spread,
      out: tilesB.view,
      outSecond: secondsB!.view,
    }),
    gatherDrawn: group(c, layouts.gatherDrawn!, GATHER_TWO_BINDINGS, {
      ...spread,
      centre: tilesB.view,
      outSecond: secondsB!.view,
    }),
    classify: group(c, layouts.classify, CLASSIFY_TWO_BINDINGS, {
      params: c.params,
      tiles: tilesB.view,
      tilesSecond: secondsB!.view,
      gatherHalf,
      gatherFull,
      weighHalf,
      weighFull,
      weighTwo,
    }),
  }
}

/** The groups of one filter pass, from the image `color` into `blurred`: one a class, each naming
 *  the `nth` blur's list of the tiles of its class; the class of two motions too, with two
 *  directions, which also names the image of the tiles' second largest motions. */
function filterGroups(
  c: Context,
  binding: GPUBufferBinding,
  color: GPUTextureView,
  blurred: GPUTextureView,
) {
  const { flat, tilesB, secondsB } = c.targets.held
  const lists = c.targets.lists(c.nth)
  const { layouts } = c.vp
  return tileClasses(c.vp.variant.directions).map((_, at) => {
    const own = {
      params: binding,
      color,
      sampler: c.programs.sampler,
      flat: flat.view,
      tiles: tilesB.view,
      list: whole(lists[at]),
      blurred,
    }
    return at < TILE_CLASSES.length
      ? group(c, layouts.filter, FILTER_BINDINGS, own)
      : group(c, layouts.filterTwo!, FILTER_TWO_BINDINGS, { ...own, tilesSecond: secondsB!.view })
  })
}

/** The groups the passes of the `nth` blur of the chain are bound with, over the image `input`, the
 *  blurred image `output` and, for two passes, the one `between` (`MotionBlurTargets`), for the
 *  programs of `variant`. */
export function bindGroups(
  device: GPUDevice,
  programs: MotionBlurPrograms,
  variant: VariantPrograms,
  targets: MotionBlurTargets,
  nth: number,
  uniforms: readonly Uniform[],
  frame: ResolveFrame,
  images: { input: GPUTextureView; output: GPUTextureView; between?: GPUTextureView },
): MotionBlurGroups {
  const { input, output, between } = images
  const params = whole(uniforms[0].buffer)
  const c: Context = { device, programs, vp: variant, targets, nth, params, frame }
  const { tilesA } = targets.held
  const before = variant.variant.directions > 1 ? twoDirectionGroups(c) : oneDirectionGroups(c)
  return {
    ...before,
    scatter: group(c, programs.scatterLayout, SCATTER_BINDINGS, { params, tiles: tilesA.view }),
    filter: filterGroups(c, params, input, between ?? output),
    second: between && filterGroups(c, whole(uniforms[1].buffer), between, output),
  }
}
