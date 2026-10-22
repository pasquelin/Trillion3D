import type { EffectKind, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { activePasses, countKinds, effectPassTargets, effectTargetBytes } from './targets.ts'
import {
  type FusedBlend,
  type OverlayFrame,
  type ResolveFrame,
  type WebgpuEffectKind,
  type WebgpuOverlayKind,
  type WebgpuResolveKind,
  HDR_KINDS,
  OVERLAY_KINDS,
  RESOLVE_KINDS,
} from './webgpuKinds.ts'
import { createStage, type MadeKinds, type Stage } from './effectKinds.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { PostFrame } from '../finish/finish.ts'
import type { BloomValues } from '../../../../sdk-core/src/contracts/bloomRules.ts'

/** The targets the chain's passes write, two at most, in turn: made at the image's size, released
 *  with it (`release`), and the kinds before tone mapping resized with them (`resizeKinds`). */
function createEffectTargets(
  device: GPUDevice,
  resizeKinds: (w: number, h: number, held: boolean) => void,
) {
  const textures: GPUTexture[] = [],
    views: GPUTextureView[] = []
  let width = 0,
    height = 0
  /** Frees the pass targets and what the kinds before tone mapping hold; the overlays keep
   *  theirs. */
  const release = () => {
    for (const target of textures) target.destroy()
    textures.length = views.length = 0
    resizeKinds(0, 0, false)
    width = height = 0
  }
  return {
    views,
    release,
    /** Bytes of the pass targets. */
    get bytes() {
      return effectTargetBytes(width, height, textures.length)
    },
    /** `count` targets of `w` × `h`, the kinds resized to match. */
    ensure(count: number, w: number, h: number) {
      if (w !== width || h !== height) release()
      width = w
      height = h
      while (textures.length > count) textures.pop()!.destroy()
      views.length = textures.length
      while (textures.length < count) {
        const target = device.createTexture({
          label: `Trillion3D effect target ${textures.length}`,
          size: { width: w, height: h },
          format: HDR_FORMAT,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        })
        textures.push(target)
        views.push(target.createView())
      }
      resizeKinds(w, h, true)
    },
  }
}

/** The passes on the resolved image: each kind sized for the passes that draw (zero frees it), the
 *  passes drawn in order, each over the image the one before left. */
export function createResolveStage(kinds: MadeKinds) {
  const stage = createStage()
  let passes = 0
  return {
    /** The render and compute passes the last `resolve` encoded. */
    get passes() {
      return passes
    },
    ready: (chain: readonly EffectPass[]) => kinds.ready(stage, activePasses(chain, stage.drawing)),
    resolve(
      encoder: GPUCommandEncoder,
      chain: readonly EffectPass[],
      input: GPUTextureView,
      frame: ResolveFrame,
    ) {
      passes = 0
      const drawn = activePasses(chain, stage.drawing)
      countKinds(drawn, stage.counts)
      for (const kind of RESOLVE_KINDS) {
        stage.nth[kind] = 0
        kinds.made[kind]?.resize(frame.extent[0], frame.extent[1], stage.counts[kind])
      }
      let view = input
      for (const pass of drawn) {
        const kind = kinds.made[pass.kind] as WebgpuResolveKind<EffectPass>
        view = kind.resolve(encoder, pass, stage.nth[pass.kind]++, view, frame)
        passes += kind.passes
      }
      return view
    },
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
  bloom?: BloomValues,
) {
  let view = input,
    written = 0
  for (let index = 0; index < chain.length; index++) {
    const pass = chain[index]
    const kind = kinds.made[pass.kind] as WebgpuEffectKind<EffectPass>
    const output = index < last ? targets.views[written % 2] : undefined
    const encoded = kind.encode(encoder, pass, stage.nth[pass.kind]++, view, output, post, bloom)
    if (!encoded) continue
    drawn.draws += encoded
    if (!output) drawn.blend = kind.blend
    else view = output
    written++
  }
  return view
}

/** The passes before tone mapping: each writes a full-size target the next one reads, two in turn
 *  at most, one fewer where the last leaves its blend to the composition. */
export function createHdrStage(device: GPUDevice, kinds: MadeKinds) {
  const stage = createStage()
  /** The kinds before tone mapping follow the targets' size; `held` false: they hold nothing. */
  const resizeKinds = (w: number, h: number, held: boolean) => {
    for (const kind of HDR_KINDS) kinds.made[kind]?.resize(w, h, held ? stage.counts[kind] : 0)
  }
  const targets = createEffectTargets(device, resizeKinds)
  const drawn: HdrDrawn = { draws: 0, blend: undefined }
  return {
    targets,
    ready: (chain: readonly EffectPass[]) => kinds.ready(stage, activePasses(chain, stage.drawing)),
    drawn,
    encode(
      encoder: GPUCommandEncoder,
      passes: readonly EffectPass[],
      input: GPUTextureView,
      w: number,
      h: number,
      post: PostFrame,
      bloom?: BloomValues,
    ) {
      drawn.draws = 0
      drawn.blend = undefined
      // An idle pass has nothing to draw: the chain is the passes that are not.
      const chain = activePasses(passes, stage.drawing)
      if (!chain.length) {
        targets.release()
        return input
      }
      if (!kinds.ready(stage, chain)) return input
      const last = chain.length - ('blend' in kinds.made[chain[chain.length - 1].kind]! ? 1 : 0)
      targets.ensure(effectPassTargets(last), w, h)
      return drawChain(encoder, stage, kinds, targets, chain, last, input, post, drawn, bloom)
    },
  }
}

/** The passes drawn over the display image, after tone mapping: each kind sized for the display. */
export function createOverlayStage(kinds: MadeKinds) {
  const stage = createStage()
  const after = (kind: EffectKind) => kinds.made[kind] as WebgpuOverlayKind<EffectPass>
  /** Frees what the overlays hold. */
  const release = () => {
    for (const kind of OVERLAY_KINDS) kinds.made[kind]?.resize(0, 0, 0)
  }
  return {
    release,
    overlay(encoder: GPUCommandEncoder, passes: readonly EffectPass[], frame: OverlayFrame) {
      let drawn = 0
      const chain = activePasses(passes, stage.drawing)
      if (!kinds.ready(stage, chain)) return drawn
      let any = false
      for (const kind of OVERLAY_KINDS) {
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
