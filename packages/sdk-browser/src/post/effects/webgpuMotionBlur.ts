import type { MotionBlur } from '../../../../sdk-core/src/world/effect/motionBlur.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { createMotionBlurClock } from './motionBlur/motionBlurClock.ts'
import { encodeMotionBlur, type MotionBlurGroups } from './motionBlur/motionBlurEncode.ts'
import { bindGroups, uniformOf, type Uniform } from './motionBlur/motionBlurGroups.ts'
import { MOTION_BLUR_PARAMS_BYTES } from './motionBlur/motionBlurLayout.ts'
import {
  spreadsByDrawing,
  writeMotionBlurParams,
  type MotionBlurInput,
} from './motionBlur/motionBlurParams.ts'
import {
  createMotionBlurPrograms,
  type MotionBlurPrograms,
} from './motionBlur/motionBlurPrograms.ts'
import { createMotionBlurTargets, type MotionBlurTargets } from './motionBlur/motionBlurTargets.ts'
import {
  createTwoDirectionPrograms,
  type TwoDirectionPrograms,
} from './motionBlur/motionBlurTwoPrograms.ts'
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
  writeChanged(device, uniform.buffer, uniform.words.u, 0, uniform.words.u.length)
}

/** The programs and targets every blur of the chain shares, and the programs of two directions a
 *  blur asked `asked` directions is drawn with: none for one, or while they compile
 *  (`createWebgpuMotionBlur`). */
type Shared = {
  programs: MotionBlurPrograms
  targets: MotionBlurTargets
  twoFor: (asked: number) => TwoDirectionPrograms | undefined
}

/**
 * The programs of two directions, compiled at the first ask (`for(asked)`, with `asked` of 2) and
 * none before they arrive: a blur is drawn with one meanwhile (`arriving` tells the compile runs).
 * A compile that fails is said once (`fail`) and not asked again.
 */
function createTwoGate(
  device: GPUDevice,
  programs: MotionBlurPrograms,
  fail: (error: unknown) => void,
) {
  let made: TwoDirectionPrograms | undefined,
    arriving: Promise<void> | undefined,
    refused = false
  return {
    get arriving() {
      return arriving
    },
    for(asked: number) {
      if (asked < 2 || refused) return undefined
      if (!made)
        arriving ??= createTwoDirectionPrograms(device, programs).then(
          (two) => void ((made = two), (arriving = undefined)),
          (error) => void ((refused = true), (arriving = undefined), fail(error)),
        )
      return made
    },
  }
}

/** The groups of `mine` over `images` and the frame's motion, made again where what they name
 *  moved. */
function groupsOf(
  device: GPUDevice,
  { programs, targets }: Shared,
  two: TwoDirectionPrograms | undefined,
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
      two,
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
) {
  const { programs, targets } = shared,
    { settings } = frame
  const two = shared.twoFor(settings.motionBlurDirections)
  targets.ensure(frame.extent, frame.allocated, two ? 2 : 1)
  const output = targets.output(nth % 2).view
  const between = settings.motionBlurSeparable ? targets.output(2).view : undefined
  const params = {
    blur,
    settings,
    image: frame.size,
    grid: frame.render,
    timeScale: mine.clock.next(frame.now, blur.targetFps),
  }
  writeUniform(device, mine, 0, params)
  if (between) writeUniform(device, mine, 1, { ...params, halfInput: false })
  const groups = groupsOf(device, shared, two, mine, nth, frame, { input, output, between })
  const drawn = spreadsByDrawing(blur.max, settings.motionBlurScatter, frame.size[0])
  return encodeMotionBlur(device, encoder, {
    programs,
    kit: two ? (drawn ? two.kits.drawn : two.kits.read) : programs.kit,
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
 * draws. The programs of two directions (`motionBlurDirections`) are compiled at the first blur
 * that asks for them (`arriving`, `fail` where they cannot be made): it is drawn with one direction
 * meanwhile, and the image is drawn again once they arrive.
 */
export async function createWebgpuMotionBlur(
  device: GPUDevice,
  fail: (error: unknown) => void = () => {},
): Promise<WebgpuResolveKind<MotionBlur>> {
  const programs = await createMotionBlurPrograms(device)
  const gate = createTwoGate(device, programs, fail)
  const shared: Shared = {
    programs,
    targets: createMotionBlurTargets(device),
    twoFor: (asked) => gate.for(asked),
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
    /** The compile of the programs of two directions, while it runs. */
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
    resolve(encoder, blur, nth, input, frame) {
      const mine = held[nth]
      // An image that shows what the one before did has no motion: the streak is nil, the clock
      // follows the frame all the same.
      if (frame.still) {
        mine.clock.next(frame.now, blur.targetFps)
        passes = 0
        return input
      }
      passes = drawBlur(device, encoder, shared, mine, blur, nth, input, frame)
      return shared.targets.output(nth % 2).view
    },
    dispose: release,
  }
}
