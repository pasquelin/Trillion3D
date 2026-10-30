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
  type FusedFlatten,
} from './motionBlur/motionBlurLayout.ts'
import { fusedVelocityFits } from '../taa/analysisLayouts.ts'
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
import { dropHolds, resizeHolds } from './holds.ts'
import { noLayers } from '../../blend/translucencyLayers.ts'

/** What one blur of the chain holds: its uniforms, the clock its time scale follows, and the groups
 *  its passes are bound with, one set for each of the inputs taking turns. */
type Held = {
  /** The uniform of the blur, and the one of a separable blur's second pass, made when it asks. */
  uniforms: Uniform[]
  clock: ReturnType<typeof createMotionBlurClock>
  identity: WebgpuBindIdentity
  groups: MotionBlurGroups[]
  /** What the first blur hands the temporal pass's nearest velocity to flatten into (`fuse`),
   *  rewritten by each image it is asked for; the programs it was set up with and the count of its
   *  asks, which the image finds the flattening by (`ResolveFrame.flatten`). */
  flatten?: FusedFlatten
  setUp?: { token: number; variant: VariantPrograms }
  /** What the uniforms are written from, refilled at each image (`setUp`). */
  input?: MotionBlurInput
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
  images: {
    input: GPUTextureView
    output: GPUTextureView
    half: GPUTextureView
    between?: GPUTextureView
  },
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
  next[8] = images.half
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

/** The programs of the variant the blur of `settings` is drawn with on `frame`, once compiled. */
const variantOf = (shared: Shared, frame: ResolveFrame, settings: MotionBlurValues) =>
  shared.variantFor({
    directions: settings.motionBlurDirections as 1 | 2,
    flat: flatFormOf(frame.camera.perspective),
  })

/**
 * Whether the blur `nth` of a chain of `count` writes the half-size image beside its blurred one, for
 * the scene's chain to read in place of the pass that draws it: the last blur's, for the image it
 * leaves is the chain's; and only where the image lies in textures of its own size — the half-size
 * image is half of those —, and the quality leaves it to the passes (`ResolveFrame.halfBeside`).
 */
const writesHalf = (nth: number, count: number, frame: ResolveFrame) =>
  nth === count - 1 &&
  frame.halfBeside !== false &&
  frame.size[0] === frame.extent[0] &&
  frame.size[1] === frame.extent[1]

/**
 * Whether the blur `nth` of a chain of `count` lays the layers drawn after the motion blur over the
 * image it writes (`ResolveFrame.lateLayers`): the last blur's, as the half-size image is (`writesHalf`).
 */
const laysLayers = (nth: number, count: number, frame: ResolveFrame) =>
  nth === count - 1 ? frame.lateLayers : undefined

/** Sets the blur `mine` of `blur`, the `nth` of the chain of `count`, up for this image with the
 *  programs of `variant`: its targets made, its uniforms written, its clock advanced once. */
function setUp(
  device: GPUDevice,
  { targets }: Shared,
  mine: Held,
  blur: MotionBlur,
  frame: ResolveFrame,
  settings: MotionBlurValues,
  variant: VariantPrograms,
  half: boolean,
  layers: ResolveFrame['lateLayers'],
) {
  targets.ensure(frame.extent, frame.allocated, variant.variant)
  // One input per blur, refilled at each image: the parameters are written at once.
  const input = (mine.input ??= {
    blur,
    settings,
    image: frame.size,
    grid: frame.render,
    timeScale: 1,
  })
  input.blur = blur
  input.settings = settings
  input.image = frame.size
  input.grid = frame.render
  input.timeScale = mine.clock.next(frame.now, effectiveTargetFps(blur, settings))
  // The half-size image comes with the image the last pass leaves: a separable blur's second.
  const separable = settings.motionBlurSeparable
  // The layers are laid over the image the last pass writes: a separable blur's second.
  const extent = layers?.extent
  input.halfInput = settings.motionBlurHalfResInput && frame.resolved
  input.half = half && !separable
  input.layers = separable ? undefined : extent
  input.drawn = layers?.drawn
  writeUniform(device, mine, 0, input)
  if (separable) {
    input.halfInput = false
    input.half = half
    input.layers = extent
    writeUniform(device, mine, 1, input)
  }
}

/** Encodes the blur `mine` of `blur`, the `nth` of the chain, over `input` into the image its rank
 *  names, set up here unless it was ahead of the temporal pass (`fuse`); returns the passes encoded. */
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
  half: boolean,
  layers: ResolveFrame['lateLayers'],
) {
  const { targets } = shared
  // Set up ahead of the temporal pass for this very image (`fuse`): its flattening may be done.
  const fused = frame.flatten
  const ahead = nth === 0 && fused && mine.setUp?.token === fused.token ? mine.setUp : undefined
  mine.setUp = undefined
  const variant = ahead?.variant ?? variantOf(shared, frame, settings)
  if (!ahead) setUp(device, shared, mine, blur, frame, settings, variant, half, layers)
  const output = targets.output(nth % 2).view
  const between = settings.motionBlurSeparable ? targets.output(2).view : undefined
  const groups = groupsOf(device, shared, variant, mine, nth, frame, {
    input,
    output,
    half: targets.half(nth % 2).view,
    between,
  })
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
    flattened: !!ahead && !!fused?.written,
    layers: layers?.group ?? noLayers(device),
  })
}

type Resolve = WebgpuResolveKind<MotionBlur, MotionBlurValues>

/** What the last `resolve` left: the passes it encoded and the half-size image it wrote. */
type BlurState = { passes: number; half: GPUTextureView | undefined }

/** A new hold for one blur of the chain. */
const newHeld = (device: GPUDevice): Held => ({
  uniforms: [uniformOf(device)],
  clock: createMotionBlurClock(),
  identity: createWebgpuBindIdentity(2),
  groups: [],
})

/** Retires the uniform buffers of `held`: the commands of this image may still name them. */
const dropHeld = (device: GPUDevice, { uniforms }: Held) =>
  uniforms.forEach(({ buffer }) => retire(device, buffer))

/** Bytes of the shared targets and of the uniforms of every hold. */
function blurBytes(shared: Shared, held: Held[]) {
  let uniforms = 0
  for (const { uniforms: made } of held) uniforms += made.length
  return shared.targets.bytes + uniforms * MOTION_BLUR_PARAMS_BYTES
}

/** Sets the first blur up ahead of the temporal pass, and hands it the flattening it will find
 *  its motion in; none when it has no sets yet or the fused velocity does not fit. */
function fuseBlur(
  device: GPUDevice,
  shared: Shared,
  held: Held[],
  ...[blur, frame, settings]: Parameters<NonNullable<Resolve['fuse']>>
) {
  const mine = held[0]
  // The first image of a blur has no sets yet: it flattens its own motion.
  if (!mine || frame.still) return undefined
  const variant = variantOf(shared, frame, settings)
  if (!fusedVelocityFits(device.limits, variant.variant)) return undefined
  setUp(
    device,
    shared,
    mine,
    blur,
    frame,
    settings,
    variant,
    writesHalf(0, held.length, frame),
    laysLayers(0, held.length, frame),
  )
  const { flat, tilesA, secondsA } = shared.targets.held
  const flatten = (mine.flatten ??= {
    variant: variant.variant,
    params: mine.uniforms[0].buffer,
    flat: flat.view,
    tiles: tilesA.view,
    tilesSecond: undefined,
    token: 0,
    written: false,
  })
  flatten.variant = variant.variant
  flatten.params = mine.uniforms[0].buffer
  flatten.flat = flat.view
  flatten.tiles = tilesA.view
  flatten.tilesSecond = secondsA?.view
  flatten.token++
  flatten.written = false
  mine.setUp = { token: flatten.token, variant }
  return flatten
}

/** Blurs `input` with the nth blur and returns the blurred image; the input itself, the clock
 *  following the frame all the same, where the image shows what the one before did. */
function resolveBlur(
  device: GPUDevice,
  shared: Shared,
  held: Held[],
  state: BlurState,
  ...[encoder, blur, nth, input, frame, settings]: Parameters<Resolve['resolve']>
) {
  const mine = held[nth]
  // An image that shows what the one before did has no motion: the streak is nil, the clock
  // follows the frame all the same.
  if (frame.still) {
    mine.clock.next(frame.now, effectiveTargetFps(blur, settings))
    state.passes = 0
    state.half = undefined
    return input
  }
  const wrote = writesHalf(nth, held.length, frame)
  const layers = laysLayers(nth, held.length, frame)
  state.passes = drawBlur(
    device,
    encoder,
    shared,
    mine,
    blur,
    nth,
    input,
    frame,
    settings,
    wrote,
    layers,
  )
  frame.lateComposed ||= !!layers
  state.half = wrote ? shared.targets.half(nth % 2).view : undefined
  return shared.targets.output(nth % 2).view
}

/**
 * The WebGPU motion blur (`motionBlur/`): the passes of each blur of the chain, which run one after
 * the other on the targets they share (`motionBlur/motionBlurTargets.ts`) — the blurred image
 * of one is the next one's input, the two taking turns —, and, for each blur, its uniform, its
 * clock and its groups, made as the chain asks (`resize`) and kept while the images they name
 * hold. `resolve` blurs the image it is handed with the nth blur, from the motion measured for the
 * image (`ResolveFrame`), and returns the blurred image — the last blur's with its half-size image
 * (`half`), which the filter writes beside it as it stores the image. Nothing exists before the first blur that
 * draws. The programs of two directions (`motionBlurDirections`) and of an orthographic view are
 * compiled at the first blur that asks for them (`arriving`, `fail` where they cannot be made): it is
 * drawn with the base's meanwhile, and the image is drawn again once they arrive.
 */
export async function createWebgpuMotionBlur(
  device: GPUDevice,
  fail: (error: unknown) => void = () => {},
): Promise<Resolve> {
  const programs = await createMotionBlurPrograms(device)
  const gate = createVariantGate(device, programs, fail)
  const shared: Shared = {
    programs,
    targets: createMotionBlurTargets(device),
    variantFor: (wanted) => gate.for(wanted),
  }
  const held: Held[] = []
  const make = () => newHeld(device)
  const drop = (mine: Held) => dropHeld(device, mine)
  const state: BlurState = { passes: 0, half: undefined }
  const release = () => {
    dropHolds(held, drop)
    shared.targets.release()
  }
  return {
    get bytes() {
      return blurBytes(shared, held)
    },
    /** The render and compute passes the last `resolve` encoded. */
    get passes() {
      return state.passes
    },
    /** The half-size image of the image the last `resolve` returned, where it wrote one. */
    get half() {
      return state.half
    },
    /** The compile of the programs of another variant, while it runs. */
    get arriving() {
      return gate.arriving
    },
    resize(_width: number, _height: number, count: number) {
      if (!count) return release()
      resizeHolds(held, count, make, drop)
    },
    fuse: (...args) => fuseBlur(device, shared, held, ...args),
    resolve: (...args) => resolveBlur(device, shared, held, state, ...args),
    dispose: release,
  }
}
