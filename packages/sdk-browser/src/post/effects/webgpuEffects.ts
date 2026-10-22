import { createKinds } from './effectKinds.ts'
import { createHdrStage, createOverlayStage, createResolveStage } from './effectStages.ts'

/**
 * The WebGPU side of `world.effects`: the passes that run on the resolved image (the motion blur),
 * those that run before tone mapping, between the temporal resolve and the composition that
 * tone-maps, and those drawn over the display image it made (`overlay`). Each pass before tone
 * mapping writes a full-size `rgba16float` target the next one reads, two in turn at most; each
 * kind keeps its own resources. Nothing exists before the first frame with a pass: the targets are
 * made then, at the image's size, and follow it — one fewer, as the composition takes the last
 * pass's blend over; a kind's programs compile in the background at its first pass, and until
 * every kind of the chain is ready the image is drawn without the chain (`loading`), which its
 * caller draws again once they arrive (`settled`) rather than hold. `fail` is called when one
 * cannot be made, and the image stays without the chain.
 */
export function createWebgpuEffects(device: GPUDevice, fail: (error: unknown) => void) {
  const kinds = createKinds(device, fail)
  const resolved = createResolveStage(kinds)
  const hdr = createHdrStage(device, kinds)
  const overlays = createOverlayStage(kinds)
  return {
    /** True while programs compile: the image drawn meanwhile lacks the chain. */
    get loading() {
      return kinds.loading
    },
    /** Whether every kind `passes` needs is compiled; the compile of those that are not starts
     *  here, so a frame that draws nothing yet still brings them. */
    ready: hdr.ready,
    /** Resolves once every program in compilation has arrived or failed. */
    settled: kinds.settled,
    /** Bytes of every target the chain holds: the pass targets and each kind's own. */
    get bytes() {
      return hdr.targets.bytes + kinds.bytes
    },
    /** Render passes the last `encode` drew: zero when it drew none. */
    get draws() {
      return hdr.drawn.draws
    },
    /** Whether every kind the passes on the resolved image need is compiled; the compile of those
     *  that are not starts here. */
    readyResolved: resolved.ready,
    /** The render and compute passes the last `resolve` encoded. */
    get resolvedPasses() {
      return resolved.passes
    },
    /** Draws `passes`, the chain's on the resolved image, over `input` in order, an idle one
     *  passed by, and returns the image after them: `input` itself when none draws. What the kinds
     *  of this stage hold is sized for the passes that draw, and freed when none does. */
    resolve: resolved.resolve,
    /** The last pass's blend the last `encode` left to the composition, which then reads the
     *  image returned through it. */
    get blend() {
      return hdr.drawn.blend
    },
    /** Encodes `passes` over `input`, an image of `w` × `h`, and returns what composition reads:
     *  `input` itself when there is nothing to draw. A last pass whose kind has a blend leaves it
     *  to the composition (`blend`) and writes no target: the glow of the chain's last bloom is
     *  added by the composition (`finished`, `../finish/finishWgsl.ts`); a pass before it writes
     *  the next one's input. */
    encode: hdr.encode,
    /** Draws `passes`, the chain's after tone mapping, over `frame`'s display image, in order, an
     *  idle one passed by; returns the render passes encoded, none while a kind they need compiles
     *  (`loading`). With no pass to draw, what the overlays hold is freed: nothing is allocated for
     *  an idle pass. */
    overlay: overlays.overlay,
    /** Frees what the overlays hold: the chain draws none. */
    releaseOverlays: overlays.release,
    dispose() {
      hdr.targets.release()
      overlays.release()
      kinds.dispose()
    },
  }
}

export type WebgpuEffects = ReturnType<typeof createWebgpuEffects>
