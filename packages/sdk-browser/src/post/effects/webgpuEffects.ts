import type { EffectKind, EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import {
  activePasses,
  countKinds,
  EFFECT_KINDS,
  effectPassTargets,
  effectTargetBytes,
} from './targets.ts'
import {
  type FusedBlend,
  type Kinds,
  type OverlayFrame,
  type WebgpuEffectKind,
  type WebgpuOverlayKind,
  HDR_KINDS,
  OVERLAY_KINDS,
  WEBGPU_KINDS,
} from './webgpuKinds.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { PostFrame } from '../finish/finish.ts'

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

/**
 * The WebGPU side of `world.effects`: the passes that run before tone mapping, between the temporal
 * resolve and the composition that tone-maps, and those drawn over the display image it made
 * (`overlay`). Each pass writes a full-size `rgba16float` target the next one reads, two in turn at
 * most; each kind keeps its own resources. Nothing exists before the first frame with a pass: the
 * targets are made then, at the image's size, and follow it — one fewer, as the composition takes
 * the last pass's blend over; a kind's programs compile in the background at its first pass, and
 * until every kind of the chain is ready the image is drawn without the chain (`loading`), which
 * its caller draws again once they arrive (`settled`) rather than hold. `fail` is called when one
 * cannot be made, and the image stays without the chain.
 */
export function createWebgpuEffects(device: GPUDevice, fail: (error: unknown) => void) {
  const made: Partial<Kinds> = {},
    pending = new Map<EffectKind, Promise<void>>(),
    counts = {} as Record<EffectKind, number>,
    nth = {} as Record<EffectKind, number>,
    // The passes of the stage that draw, rewritten by each call: an image allocates none.
    drawing: EffectPass[] = []
  let failed = false,
    disposed = false,
    draws = 0,
    blend: FusedBlend | undefined
  /** The kinds before tone mapping follow the targets' size; `held` false: they hold nothing. */
  const resizeKinds = (w: number, h: number, held: boolean) => {
    for (const kind of HDR_KINDS) made[kind]?.resize(w, h, held ? counts[kind] : 0)
  }
  const targets = createEffectTargets(device, resizeKinds)
  const load = <K extends EffectKind>(kind: K) => {
    if (failed || pending.has(kind)) return
    const loaded = WEBGPU_KINDS[kind].create(device).then(
      (implementation) => {
        // Arrived after the chain was disposed (a closed session, a lost device): freed, unsaid.
        if (disposed) return implementation.dispose()
        made[kind] = implementation
        pending.delete(kind)
      },
      (error) => {
        if (disposed) return
        failed = true
        pending.delete(kind)
        fail(error)
      },
    )
    pending.set(kind, loaded)
  }
  /** The implementation of a pass's kind at its stage, compiled (`readyFor`): the chain holds
   *  built-ins only (`EffectKind`), each drawn at the stage its table entry says. */
  const before = (kind: EffectKind) => made[kind] as WebgpuEffectKind<EffectPass>
  const after = (kind: EffectKind) => made[kind] as WebgpuOverlayKind<EffectPass>
  /** Draws `pass` with its kind's implementation; the chain holds built-ins only (`EffectKind`). */
  const encodePass = (
    encoder: GPUCommandEncoder,
    pass: EffectPass,
    input: GPUTextureView,
    output: GPUTextureView | undefined,
    post: PostFrame,
  ) => before(pass.kind).encode(encoder, pass, nth[pass.kind]++, input, output, post)
  /** Frees what the overlays hold. */
  const releaseOverlays = () => {
    for (const kind of OVERLAY_KINDS) made[kind]?.resize(0, 0, 0)
  }
  /** Counts the passes of each kind, `passes` the ones that draw; false while a kind they need is
   *  not compiled. */
  const readyFor = (passes: readonly EffectPass[]) => {
    countKinds(passes, counts)
    for (const kind of EFFECT_KINDS) nth[kind] = 0
    let ready = !failed
    for (const kind of EFFECT_KINDS)
      if (counts[kind] && !made[kind]) {
        load(kind)
        ready = false
      }
    return ready
  }
  return {
    /** True while programs compile: the image drawn meanwhile lacks the chain. */
    get loading() {
      return pending.size > 0
    },
    /** Whether every kind `passes` needs is compiled; the compile of those that are not starts
     *  here, so a frame that draws nothing yet still brings them. */
    ready: (passes: readonly EffectPass[]) => readyFor(activePasses(passes, drawing)),
    /** Resolves once every program in compilation has arrived or failed. */
    settled: () => Promise.all(pending.values()),
    /** Bytes of every target the chain holds: the pass targets and each kind's own. */
    get bytes() {
      let bytes = targets.bytes
      for (const kind of EFFECT_KINDS) bytes += made[kind]?.bytes ?? 0
      return bytes
    },
    /** Render passes the last `encode` drew: zero when it drew none. */
    get draws() {
      return draws
    },
    /** The last pass's blend the last `encode` left to the composition, which then reads the
     *  image returned through it. */
    get blend() {
      return blend
    },
    /** Encodes `passes` over `input`, an image of `w` × `h`, and returns what composition reads:
     *  `input` itself when there is nothing to draw. A last pass whose kind has a blend leaves it
     *  to the composition (`blend`) and writes no target: the glow of the chain's last bloom is
     *  added by the composition (`finished`, `../finish/finishWgsl.ts`); a pass before it writes
     *  the next one's input. */
    encode(
      encoder: GPUCommandEncoder,
      passes: readonly EffectPass[],
      input: GPUTextureView,
      w: number,
      h: number,
      post: PostFrame,
    ) {
      draws = 0
      blend = undefined
      // An idle pass has nothing to draw: the chain is the passes that are not.
      const chain = activePasses(passes, drawing)
      if (!chain.length) {
        targets.release()
        return input
      }
      if (!readyFor(chain)) return input
      const fuses = 'blend' in before(chain[chain.length - 1].kind)
      const last = chain.length - (fuses ? 1 : 0)
      targets.ensure(effectPassTargets(last), w, h)
      let view = input,
        written = 0
      for (let index = 0; index < chain.length; index++) {
        const pass = chain[index]
        const output = index < last ? targets.views[written % 2] : undefined,
          drawn = encodePass(encoder, pass, view, output, post)
        if (!drawn) continue
        draws += drawn
        if (!output) blend = before(pass.kind).blend
        else view = output
        written++
      }
      return view
    },
    /** Draws `passes`, the chain's after tone mapping, over `frame`'s display image, in order, an
     *  idle one passed by; returns the render passes encoded, none while a kind they need compiles
     *  (`loading`). With no pass to draw, what the overlays hold is freed: nothing is allocated for
     *  an idle pass. */
    overlay(encoder: GPUCommandEncoder, passes: readonly EffectPass[], frame: OverlayFrame) {
      let drawn = 0
      const chain = activePasses(passes, drawing)
      if (!readyFor(chain)) return drawn
      let any = false
      for (const kind of OVERLAY_KINDS) {
        made[kind]?.resize(frame.size[0], frame.size[1], counts[kind])
        any ||= counts[kind] > 0
      }
      if (!any) return drawn
      for (const pass of chain)
        drawn += after(pass.kind).overlay(encoder, pass, nth[pass.kind]++, frame)
      return drawn
    },
    /** Frees what the overlays hold: the chain draws none. */
    releaseOverlays,
    dispose() {
      disposed = true
      targets.release()
      releaseOverlays()
      for (const kind of EFFECT_KINDS) made[kind]?.dispose()
    },
  }
}

export type WebgpuEffects = ReturnType<typeof createWebgpuEffects>
