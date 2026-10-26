import type { EffectKind, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { countKinds, effectPassTargets, effectTargetBytes } from './targets.ts'
import {
  type FusedBlend,
  type OverlayFrame,
  type ResolveFrame,
  type WebgpuEffectKind,
  type WebgpuOverlayKind,
  type WebgpuResolveKind,
} from './webgpuKinds.ts'
import { createStage, type MadeKinds, type Stage } from './effectKinds.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { PostFrame } from '../finish/finish.ts'
import { kindsAt } from './kindRules.ts'
import { sizedImage } from '../filters/sizedImage.ts'
import type { KindSettings } from './kindSettings.ts'
import type { PlanStage } from './stagePlan.ts'

/** The targets the chain's passes write, two at most, in turn: made at the image's size, released
 *  with it (`release`, retired with the frame that may still name them), and the kinds before tone
 *  mapping resized with them (`resizeKinds`). */
function createEffectTargets(
  device: GPUDevice,
  resizeKinds: (w: number, h: number, held: boolean) => void,
) {
  const images = [0, 1].map((at) =>
    sizedImage(
      device,
      `Trillion3D effect target ${at}`,
      HDR_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
    ),
  )
  const views: GPUTextureView[] = []
  let width = 0,
    height = 0
  /** Frees the pass targets and what the kinds before tone mapping hold; the overlays keep
   *  theirs. */
  const release = () => {
    for (const image of images) image.release()
    views.length = 0
    resizeKinds(0, 0, false)
    width = height = 0
  }
  return {
    views,
    release,
    /** Bytes of the pass targets. */
    get bytes() {
      return effectTargetBytes(width, height, views.length)
    },
    /** `count` targets of `w` × `h`, the kinds resized to match. */
    ensure(count: number, w: number, h: number) {
      if (w !== width || h !== height) release()
      width = w
      height = h
      for (let at = count; at < images.length; at++) images[at].release()
      views.length = count
      for (let at = 0; at < count; at++) views[at] = images[at].view(w, h)
      resizeKinds(w, h, true)
    },
  }
}

/** What the last `resolve` of a stage left: the passes it encoded, the half-size image the last
 *  pass that drew wrote, and whether it was handed a pass that draws. */
type ResolveState = { passes: number; holds: boolean; half: GPUTextureView | undefined }

/** Resizes the kinds of the stage for `chain`, then draws its passes in order, each over the
 *  image the one before left and given the view's settings of its kind; returns the last image. */
function resolveChain(
  kinds: MadeKinds,
  settings: KindSettings,
  stage: ReturnType<typeof createStage>,
  stageKinds: ReturnType<typeof kindsAt>,
  state: ResolveState,
  encoder: GPUCommandEncoder,
  chain: readonly EffectPass[],
  input: GPUTextureView,
  frame: ResolveFrame,
) {
  state.passes = 0
  state.half = undefined
  state.holds = chain.length > 0
  countKinds(chain, stage.counts)
  for (const kind of stageKinds) {
    stage.nth[kind] = 0
    kinds.made[kind]?.resize(frame.extent[0], frame.extent[1], stage.counts[kind])
  }
  let view = input
  for (const pass of chain) {
    const kind = kinds.made[pass.kind] as WebgpuResolveKind<EffectPass, unknown>
    const values = settings.of(pass.kind, frame.session)
    const next = kind.resolve(encoder, pass, stage.nth[pass.kind]++, view, frame, values)
    // The image a pass left is its own, with the half-size image it wrote beside it, if any.
    if (next !== view) state.half = kind.half
    view = next
    state.passes += kind.passes
  }
  return view
}

/** Sets up, ahead of the temporal pass, the first pass of `chain` whose kind flattens its motion
 *  in the nearest velocity (`WebgpuResolveKind.fuse`), as `resolve` will draw it: what that
 *  dispatch writes, none where no pass does or its kind is not made yet. The view's settings are
 *  peeked, never consumed: `resolve` reads them for the image. */
function fuseChain(
  kinds: MadeKinds,
  settings: KindSettings,
  stage: ReturnType<typeof createStage>,
  chain: readonly EffectPass[],
  frame: ResolveFrame,
) {
  countKinds(chain, stage.counts)
  for (const pass of chain) {
    const kind = kinds.made[pass.kind] as WebgpuResolveKind<EffectPass, unknown> | undefined
    if (!kind?.fuse) continue
    kind.resize(frame.extent[0], frame.extent[1], stage.counts[pass.kind])
    return kind.fuse(pass, frame, settings.peek(pass.kind, frame.session))
  }
  return undefined
}

/** The passes of a stage that runs on the lit image before the temporal pass, or on the image it
 *  resolved (`at`): the passes that draw (`KindSettings.drawn`), each kind sized for them (zero
 *  frees it), the passes drawn in order, each over the image the one before left and given the
 *  view's settings of its kind. */
export function createResolveStage(kinds: MadeKinds, settings: KindSettings, at: PlanStage) {
  const stage = createStage()
  const stageKinds = kindsAt(at)
  const state: ResolveState = { passes: 0, holds: false, half: undefined }
  return {
    /** The render and compute passes the last `resolve` encoded. */
    get passes() {
      return state.passes
    },
    /** The half-size image of the image the last `resolve` returned, where the last pass that drew
     *  wrote one beside it (`WebgpuResolveKind.half`). */
    get half() {
      return state.half
    },
    /** Whether the stage holds anything: the last `resolve` was handed a pass that draws. */
    get holds() {
      return state.holds
    },
    ready: (chain: readonly EffectPass[]) => kinds.ready(stage, chain),
    fuse: (chain: readonly EffectPass[], frame: ResolveFrame) =>
      fuseChain(kinds, settings, stage, chain, frame),
    resolve: (
      encoder: GPUCommandEncoder,
      chain: readonly EffectPass[],
      input: GPUTextureView,
      frame: ResolveFrame,
    ) => resolveChain(kinds, settings, stage, stageKinds, state, encoder, chain, input, frame),
  }
}

/** What the passes before tone mapping drew: the render passes encoded and the blend the last left
 *  to the composition, rewritten by each image. */
interface HdrDrawn {
  draws: number
  blend: FusedBlend | undefined
}

/** Draws the first `last` of `chain` — each over the image the one before wrote, the first over
 *  `input` —, into the targets in turn, and the rest, which write none, to the composition
 *  (`drawn.blend`); returns the image after them. */
function drawChain(
  encoder: GPUCommandEncoder,
  stage: Stage,
  kinds: MadeKinds,
  targets: ReturnType<typeof createEffectTargets>,
  chain: readonly EffectPass[],
  last: number,
  input: GPUTextureView,
  post: PostFrame,
  drawn: HdrDrawn,
  valuesOf: (kind: EffectKind) => unknown,
) {
  let view = input,
    written = 0
  for (let index = 0; index < chain.length; index++) {
    const pass = chain[index]
    const kind = kinds.made[pass.kind] as WebgpuEffectKind<EffectPass, unknown>
    const output = index < last ? targets.views[written % 2] : undefined
    const values = valuesOf(pass.kind)
    const encoded = kind.encode(encoder, pass, stage.nth[pass.kind]++, view, output, post, values)
    if (!encoded) continue
    drawn.draws += encoded
    if (!output) drawn.blend = kind.blend
    else view = output
    written++
  }
  return view
}

/** The passes before tone mapping: each writes a full-size target the next one reads, two in turn
 *  at most, one fewer where the last leaves its blend to the composition. They are the passes that
 *  draw (`KindSettings.drawn`): the caller filters, the stage draws what it is handed. */
export function createHdrStage(device: GPUDevice, kinds: MadeKinds, settings: KindSettings) {
  const stage = createStage()
  const stageKinds = kindsAt('before-tone-mapping')
  // The session's context the image's settings are read from, set by `encode`: none, the kinds read their defaults.
  let context: object | undefined
  const valuesOf = (kind: EffectKind) => settings.of(kind, context)
  /** The kinds before tone mapping follow the targets' size; `held` false: they hold nothing. */
  const resizeKinds = (w: number, h: number, held: boolean) => {
    for (const kind of stageKinds) kinds.made[kind]?.resize(w, h, held ? stage.counts[kind] : 0)
  }
  const targets = createEffectTargets(device, resizeKinds)
  const drawn: HdrDrawn = { draws: 0, blend: undefined }
  return {
    targets,
    ready: (chain: readonly EffectPass[]) => kinds.ready(stage, chain),
    drawn,
    encode(
      encoder: GPUCommandEncoder,
      chain: readonly EffectPass[],
      input: GPUTextureView,
      w: number,
      h: number,
      post: PostFrame,
      session?: object,
    ) {
      context = session
      drawn.draws = 0
      drawn.blend = undefined
      if (!chain.length) {
        targets.release()
        return input
      }
      if (!kinds.ready(stage, chain)) return input
      const last = chain.length - ('blend' in kinds.made[chain[chain.length - 1].kind]! ? 1 : 0)
      targets.ensure(effectPassTargets(last), w, h)
      return drawChain(encoder, stage, kinds, targets, chain, last, input, post, drawn, valuesOf)
    },
  }
}

/** The passes drawn over the display image, after tone mapping, as `KindSettings.drawn` hands them:
 *  each kind sized for the display. */
export function createOverlayStage(kinds: MadeKinds) {
  const stage = createStage()
  const stageKinds = kindsAt('after-tone-mapping')
  const after = (kind: EffectKind) => kinds.made[kind] as WebgpuOverlayKind<EffectPass>
  /** Frees what the overlays hold. */
  const release = () => {
    for (const kind of stageKinds) kinds.made[kind]?.resize(0, 0, 0)
  }
  return {
    release,
    overlay(encoder: GPUCommandEncoder, chain: readonly EffectPass[], frame: OverlayFrame) {
      let drawn = 0
      if (!kinds.ready(stage, chain)) return drawn
      let any = false
      for (const kind of stageKinds) {
        kinds.made[kind]?.resize(frame.size[0], frame.size[1], stage.counts[kind])
        any ||= stage.counts[kind] > 0
      }
      if (!any) return drawn
      for (const pass of chain)
        drawn += after(pass.kind).overlay(encoder, pass, stage.nth[pass.kind]++, frame)
      return drawn
    },
  }
}
