import { createKinds } from './effectKinds.ts'
import { createKindSettings, type KindSettings } from './kindSettings.ts'
import { createHdrStage, createOverlayStage, createResolveStage } from './effectStages.ts'
import type { PlanStage } from './stagePlan.ts'
import { createPostMaterials } from '../materials/postMaterials.ts'

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
 *
 * Its members: `stage(at)` is the passes around the temporal pass, `'before-resolve'` on the lit image and
 * `'after-resolve'` on the resolved one — `ready` says whether every kind the passes need is compiled (the
 * compile of those that are not starts there, so a frame that draws nothing yet still brings them),
 * `resolve` draws them over `input` in order and returns the image after them, `input` itself when none
 * draws (what the kinds of a stage hold is sized for the passes that draw, and freed when none does),
 * `passes` the render and compute passes the last `resolve` encoded, `holds` whether the stage holds
 * anything; `ready` and `encode` do the same for the passes before tone mapping, over `input`, an image of
 * `w` × `h` — `encode` returns what composition reads, `input` itself when there is nothing to draw: a last
 * pass whose kind has a blend leaves it to the composition (`blend`) and writes no target — the glow of the
 * chain's last bloom is added there (`finished`, `../finish/finishWgsl.ts`) —; a pass before it writes the
 * next one's input; the kinds' settings are read from the session `context` it is handed. Every stage is
 * handed the passes that draw (`KindSettings.drawn`), an idle pass or one the view's settings turn off
 * excluded. `overlay` draws those after tone mapping over `frame`'s display image and returns the render
 * passes encoded, none while a kind they need compiles; with no pass to draw, what the overlays hold is
 * freed. `materials` draws the post-process materials of the chain's blendables around them (`../materials/postMaterials.ts`).
 */
export function createWebgpuEffects(
  device: GPUDevice,
  fail: (error: unknown) => void,
  settings: KindSettings = createKindSettings(),
) {
  const kinds = createKinds(device, fail)
  const stages = {
    'before-resolve': createResolveStage(kinds, settings, 'before-resolve'),
    'after-resolve': createResolveStage(kinds, settings, 'after-resolve'),
  }
  const hdr = createHdrStage(device, kinds, settings)
  const overlays = createOverlayStage(kinds)
  const materials = createPostMaterials(device)
  return {
    /** True while programs compile: the image drawn meanwhile lacks the chain. */
    get loading() {
      return kinds.loading
    },
    ready: hdr.ready,
    /** Resolves once every program in compilation has arrived or failed. */
    settled: kinds.settled,
    /** Bytes of every target the chain holds: the pass targets and each kind's own. */
    get bytes() {
      return hdr.targets.bytes + kinds.bytes + materials.bytes
    },
    /** The post-process materials of the chain's blendables (`world.effects.blendables`), drawn at the places the image offers them. */
    materials,
    /** Render passes the last `encode` drew: zero when it drew none. */
    get draws() {
      return hdr.drawn.draws
    },
    /** The passes before the temporal pass (`'before-resolve'`) or after it (`'after-resolve'`). */
    stage: (at: PlanStage) => stages[at],
    /** The last pass's blend the last `encode` left to the composition. */
    get blend() {
      return hdr.drawn.blend
    },
    encode: hdr.encode,
    overlay: overlays.overlay,
    /** Frees what the overlays hold: the chain draws none. */
    releaseOverlays: overlays.release,
    dispose() {
      hdr.targets.release()
      overlays.release()
      materials.dispose()
      kinds.dispose()
    },
  }
}

export type WebgpuEffects = ReturnType<typeof createWebgpuEffects>
