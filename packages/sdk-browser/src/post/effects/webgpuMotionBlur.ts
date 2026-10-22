import {
  effectiveMax,
  effectiveTargetFps,
  type MotionBlurValues,
} from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { MotionBlur } from '../../../../sdk-core/src/world/effect/motionBlur.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { createMotionBlurClock } from './motionBlur/motionBlurClock.ts'
import { encodeMotionBlur, type MotionBlurGroups } from './motionBlur/motionBlurEncode.ts'
import { bindGroups, uniformOf, type Uniform } from './motionBlur/motionBlurGroups.ts'
import {
  BASE_VARIANT,
  MOTION_BLUR_PARAMS_BYTES,
  flatFormOf,
  type BlurVariant,
} from './motionBlur/motionBlurLayout.ts'
import {
  spreadsByDrawing,
  writeMotionBlurParams,
  type MotionBlurInput,
} from './motionBlur/motionBlurParams.ts'
import {
  createMotionBlurPrograms,
  createOtherVariant,
  type MotionBlurPrograms,
} from './motionBlur/motionBlurPrograms.ts'
import { createMotionBlurTargets, type MotionBlurTargets } from './motionBlur/motionBlurTargets.ts'
import type { VariantPrograms } from './motionBlur/motionBlurVariants.ts'
import type { ResolveFrame, WebgpuResolveKind } from './webgpuKinds.ts'

/** What one blur of the chain holds: its uniforms, the clock its time scale follows, and the groups
 *  its passes are bound with, one set for each of the inputs taking turns. */
type Held = {
  /** The uniform of the blur, and the one of a separable blur's second pass, made when it asks. */
  uniforms: Uniform[]
  clock: ReturnType<typeof createMotionBlurClock>
  identity: WebgpuBindIdentity
  groups: MotionBlurGroups[]
}

/** Writes the uniform `at` of `mine` — 0 the blur's, 1 its second pass's, made at the first
 *  separable blur —, where the second reads the full-size image alone. */
function writeUniform(device: GPUDevice, mine: Held, at: number, input: MotionBlurInput) {
  const uniform = (mine.uniforms[at] ??= uniformOf(device))
  writeMotionBlurParams(uniform.words.f, uniform.words.u, input)
  uniform.send()
}

/** The programs and targets every blur of the chain shares, and the programs a blur asking for
 *  `wanted` is drawn with: its variant's once they are compiled, the base's until then
 *  (`createWebgpuMotionBlur`). */
type Shared = {
  programs: MotionBlurPrograms
  targets: MotionBlurTargets
  variantFor: (wanted: BlurVariant) => VariantPrograms
}

/** A variant's key. */
const keyOf = ({ directions, flat }: BlurVariant) => `${directions} ${flat}`

/**
 * The programs of the variants other than the base — two directions (`motionBlurDirections`), an
 * orthographic view's form of the flattened motion —, each compiled at the first ask (`for`) and none
 * before they arrive: a blur is drawn with the base's meanwhile, and `arriving` tells a compile
 * runs. A compile that fails is said once (`fail`) and not asked again.
 */
function createVariantGate(
  device: GPUDevice,
  programs: MotionBlurPrograms,
  fail: (error: unknown) => void,
) {
  const made = new Map([[keyOf(BASE_VARIANT), programs.base]])
  const refused = new Set<string>()
  let arriving: Promise<void> | undefined
  return {
    get arriving() {
      return arriving
    },
    for(wanted: BlurVariant) {
      const key = keyOf(wanted)
      const held = made.get(key)
      if (held) return held
      if (!arriving && !refused.has(key))
        arriving = createOtherVariant(device, programs, wanted).then(
          (variant) => void (made.set(key, variant), (arriving = undefined)),
          (error) => void (refused.add(key), (arriving = undefined), fail(error)),
        )
      return programs.base
    },
  }
}

/** The groups of `mine` over `images` and the frame's motion, made again where what they name
 *  moved. */
function groupsOf(
  device: GPUDevice,
  { programs, targets }: Shared,
  variant: VariantPrograms,
  mine: Held,
  nth: number,
  frame: ResolveFrame,
  images: { input: GPUTextureView; output: GPUTextureView; between?: GPUTextureView },
) {
  const { identity } = mine,
    { next } = identity
  next[0] = targets.generation
  next[1] = frame.view
  next[2] = frame.vectors
  next[3] = frame.depth
  next[4] = images.input
  next[5] = images.output
  next[6] = images.between
  next[7] = mine.uniforms[1]
  if (identity.moved())
    mine.groups[identity.slot] = bindGroups(
      device,
      programs,
      variant,
      targets,
      nth,
      mine.uniforms,
      frame,
      images,
    )
  return mine.groups[identity.slot]
}

/** Encodes the blur `mine` of `blur`, the `nth` of the chain, over `input` into the image its rank
 *  names; returns the passes encoded. */
function drawBlur(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  shared: Shared,
  mine: Held,
  blur: MotionBlur,
  nth: number,
  input: GPUTextureView,
  frame: ResolveFrame,
  settings: MotionBlurValues,
) {
  const { targets } = shared
  const variant = shared.variantFor({
    directions: settings.motionBlurDirections as 1 | 2,
    flat: flatFormOf(frame.camera.perspective),
  })
  targets.ensure(frame.extent, frame.allocated, variant.variant)
  const output = targets.output(nth % 2).view
  const between = settings.motionBlurSeparable ? targets.output(2).view : undefined
  const params = {
    blur,
    settings,
    image: frame.size,
    grid: frame.render,
    timeScale: mine.clock.next(frame.now, effectiveTargetFps(blur, settings)),
    halfInput: settings.motionBlurHalfResInput && frame.resolved,
  }
  writeUniform(device, mine, 0, params)
  if (between) writeUniform(device, mine, 1, { ...params, halfInput: false })
  const groups = groupsOf(device, shared, variant, mine, nth, frame, { input, output, between })
  const drawn = spreadsByDrawing(
    effectiveMax(blur, settings),
    settings.motionBlurScatter,
    frame.size[0],
  )
  return encodeMotionBlur(device, encoder, {
    programs: shared.programs,
    kit: drawn ? variant.kits.drawn : variant.kits.read,
    targets,
    groups,
    lists: targets.lists(nth),
    image: frame.size,
    grid: frame.render,
    drawn,
  })
}

/**
 * The WebGPU motion blur (`motionBlur/`): the passes of each blur of the chain, which run one after
 * the other on the targets they share (`motionBlur/motionBlurTargets.ts`) — the blurred image
 * of one is the next one's input, the two taking turns —, and, for each blur, its uniform, its
 * clock and its groups, made as the chain asks (`resize`) and kept while the images they name
 * hold. `resolve` blurs the image it is handed with the nth blur, from the motion measured for the
 * image (`ResolveFrame`), and returns the blurred image. Nothing exists before the first blur that
 * draws. The programs of two directions (`motionBlurDirections`) and of an orthographic view are
 * compiled at the first blur that asks for them (`arriving`, `fail` where they cannot be made): it is
 * drawn with the base's meanwhile, and the image is drawn again once they arrive.
 */
export async function createWebgpuMotionBlur(
  device: GPUDevice,
  fail: (error: unknown) => void = () => {},
): Promise<WebgpuResolveKind<MotionBlur, MotionBlurValues>> {
  const programs = await createMotionBlurPrograms(device)
  const gate = createVariantGate(device, programs, fail)
  const shared: Shared = {
    programs,
    targets: createMotionBlurTargets(device),
    variantFor: (wanted) => gate.for(wanted),
  }
  const held: Held[] = []
  let passes = 0
  const drop = ({ uniforms }: Held) => uniforms.forEach(({ buffer }) => retire(device, buffer))
  const release = () => {
    held.forEach(drop)
    held.length = 0
    shared.targets.release()
  }
  return {
    get bytes() {
      let uniforms = 0
      for (const { uniforms: made } of held) uniforms += made.length
      return shared.targets.bytes + uniforms * MOTION_BLUR_PARAMS_BYTES
    },
    /** The render and compute passes the last `resolve` encoded. */
    get passes() {
      return passes
    },
    /** The compile of the programs of another variant, while it runs. */
    get arriving() {
      return gate.arriving
    },
    resize(_width: number, _height: number, count: number) {
      if (!count) return release()
      while (held.length < count)
        held.push({
          uniforms: [uniformOf(device)],
          clock: createMotionBlurClock(),
          identity: createWebgpuBindIdentity(2),
          groups: [],
        })
      while (held.length > count) drop(held.pop()!)
    },
    resolve(encoder, blur, nth, input, frame, settings) {
      const mine = held[nth]
      // An image that shows what the one before did has no motion: the streak is nil, the clock
      // follows the frame all the same.
      if (frame.still) {
        mine.clock.next(frame.now, effectiveTargetFps(blur, settings))
        passes = 0
        return input
      }
      passes = drawBlur(device, encoder, shared, mine, blur, nth, input, frame, settings)
      return shared.targets.output(nth % 2).view
    },
    dispose: release,
  }
}
