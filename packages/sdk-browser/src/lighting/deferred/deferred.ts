import { encodeReflectionSource } from '../../reflections/encode.ts'
import type { ScreenReflection } from '../../reflections/gpu.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import { UNLIT_COMPOSITIONS, UNLIT_LIGHTING_SHADER } from './shaders.ts'
import { createContractVariants, type LitPrograms } from './contractVariants.ts'
import { cutsIn } from './contractCuts.ts'
import { createDeferredPlaceholders, type DeferredPlaceholders } from './setup.ts'
import {
  createDeferredProgram,
  type ComposedImage,
  type DeferredBindings,
  type DeferredProgram,
  type DirectLightResources,
} from './program.ts'
import { ZERO_DIRECT, createDeferredView } from './view.ts'
import { DEFERRED_LIGHTING_PASS } from '../../stage/passLabels.ts'
export { FULLSCREEN_VERTEX } from './shaders.ts'

/** Whether these resources light with the bounce program. */
const bounceOf = ({ bounceGrid, probes }: DirectLightResources) => !!bounceGrid && !!probes

type DeferredView = ReturnType<typeof createDeferredView>
type ContractVariants = ReturnType<typeof createContractVariants>

/** What the lighting keeps between its calls: the frame's program, which `bind` picks and every
 *  pass of the frame then draws with, the unlit one, the raw-output switch, and the size this image
 *  draws, from `update`: its targets may be larger (`renderScale.ts`). */
type LightingState = {
  active: DeferredProgram
  readonly unlit: DeferredProgram
  /** Diagnostic views output raw values: no filmic curve, no sRGB, no composed background. The
   *  indirect-irradiance view is one, and lighting says so, not the caller. */
  rawOutput: boolean
  readonly drawn: number[]
}

/** The unlit view's program, which composes by identity: with no declared source, no radiance is
 *  to be exposed or brought into the display range, and albedo must be read as-is. */
const unlitProgram = (device: GPUDevice, bindings: DeferredBindings) =>
  createDeferredProgram(
    device,
    { lighting: UNLIT_LIGHTING_SHADER, compose: UNLIT_COMPOSITIONS, label: 'UNLIT', direct: false },
    bindings,
  )

/** Deferred and frozen-source lighting programs: the lit ones from the start when `lit` says so,
 *  else compiled lazily for the active lighting mode. */
export async function createDeferredLighting(
  device: GPUDevice,
  onReady?: () => void,
  lit?: LitPrograms,
) {
  const view = createDeferredView(device)
  const placeholders = createDeferredPlaceholders(device)
  const bindings = { uniform: view.buffer, placeholders }
  // Programs, never a branch: the unlit view, and the contract ones (`contractVariants.ts`).
  const variants = createContractVariants(device, bindings, onReady, lit)
  // The program the first frame asks for, and its wide twin. Prepare waits for the one without
  // bounce, which lights any first frame; the bounce pair lands meanwhile.
  const litReady = lit?.precompile ? variants.precompile(false, lit.key) : Promise.resolve()
  if (lit?.precompile && lit.bounce) void variants.precompile(true, lit.key)
  const unlit = await unlitProgram(device, bindings).catch((error: unknown) => {
    view.dispose()
    placeholders.dispose()
    variants.release()
    throw error
  })
  const state: LightingState = { active: unlit, unlit, rawOutput: false, drawn: [1, 1] }
  return {
    uniform: view.buffer,
    /** What an absent contract resource is worth: the blend pass binds the same. */
    placeholders,
    /** Outputs the image in raw values, without the display chain. For a measurement view. */
    setRawOutput(value: boolean) {
      state.rawOutput = value
    },
    /** Settled once the lit program prepare started has landed, or failed (`LitPrograms`). */
    litReady,
    get usesContract() {
      return state.active !== unlit
    },
    setJitter: view.setJitter,
    /** Writes the view uniform of this image (`view.ts`). */
    update: viewUpdate(state, view),
    /** Select and lazily compile the active lighting program. */
    bind: programBind(state, variants, placeholders),
    settle: () => variants.settle(),
    /** What a frame lit with these resources waits for: the lit program's compile while no ready
     *  one can light it, else nothing (`contractVariants.ts`). */
    awaited: (direct: DirectLightResources) =>
      variants.awaited(bounceOf(direct), !!direct.narrow, cutsIn(direct)),
    /** Draws the lighting; returns the passes drawn (`lightPass`). */
    light: lightPass(state),
    /** True once the frame's program composes the chain's last bloom in (#963); the first call
     *  compiles what it needs, and `fail` hears why it cannot. */
    composesBloom: (fail: (error: unknown) => void) =>
      state.active.compositions.composesBloom(fail),
    /** Composes the lit image, or the one handed in (`composePass`). */
    compose: composePass(state),
    dispose() {
      view.dispose()
      placeholders.dispose()
      unlit.release()
      variants.release()
    },
  }
}

/** The lighting's `update`: writes the view uniform of this image (`view.ts`), and keeps the size
 *  it draws. */
function viewUpdate(state: LightingState, view: DeferredView) {
  return (
    inverseViewProjection: ArrayLike<number>,
    camera: readonly number[],
    width: number,
    height: number,
    clearColor: number,
    diagnostic: boolean,
    direct: ArrayLike<number> = ZERO_DIRECT,
    sampledRank = 0,
  ) => {
    const raw = diagnostic || state.rawOutput
    state.drawn[0] = width
    state.drawn[1] = height
    view.write(inverseViewProjection, camera, width, height, clearColor, raw, direct, sampledRank)
  }
}

/** The lighting's `bind`: selects, and lazily compiles, the frame's program, and binds it. */
function programBind(
  state: LightingState,
  variants: ContractVariants,
  placeholders: DeferredPlaceholders,
) {
  return (
    surface: SurfaceBuffer,
    depth: GPUTextureView,
    hdr: GPUTextureView,
    wantsContract: boolean,
    direct: DirectLightResources = {},
    onFailure?: (error: unknown) => void,
  ) => {
    const { unlit } = state
    // A program still compiling lends the frame the best one ready (`contractVariants.ts`).
    const active =
      (wantsContract &&
        variants.pick(bounceOf(direct), !!direct.narrow, cutsIn(direct), onFailure)) ||
      unlit
    state.active = active
    active.bind(surface, depth, hdr, direct)
    // A program reading a shadow mask: its decode table is filled, in its own submit, before
    // this frame's (`projectionMaskTable.ts`).
    if (active !== unlit && direct.vsmMask) placeholders.vsmMaskTable.fill()
  }
}

/** The lighting's `light`: draws the lighting, after the reflection source when the frame's
 *  program reflects, the next image's source then written beside it; returns the passes drawn
 *  (#1157). */
function lightPass(state: LightingState) {
  return (encoder: GPUCommandEncoder, target: GPUTextureView, reflection?: ScreenReflection) => {
    const { active, drawn } = state
    const group = active.lightGroup
    if (!group) throw new Error('SURFACE_NOT_BOUND')
    const reflected = reflection?.active && active.reflection
    if (reflected) encodeReflectionSource(encoder, target, reflection, reflected, group, drawn)
    const colorAttachments: GPURenderPassColorAttachment[] = [
      { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
    ]
    const source = reflected && reflection.source?.target
    if (source) colorAttachments.push({ ...colorAttachments[0], view: source })
    const pass = encoder.beginRenderPass({ label: DEFERRED_LIGHTING_PASS, colorAttachments })
    pass.setViewport(0, 0, drawn[0], drawn[1], 0, 1)
    pass.setPipeline(reflected ? reflected.final : active.light)
    if (reflected) pass.setBindGroup(1, reflection.group)
    pass.setBindGroup(0, group)
    pass.draw(3)
    pass.end()
    return reflected ? (reflection.history && !reflection.history.reuse ? 4 : 2) : 1
  }
}

/** The lighting's `compose`: composes the lit image, or `composed`: the temporal output, or the
 *  effect chain's, with the bloom blend it left; reading no as-is share when `asIs` says none is in
 *  the frame. */
function composePass(state: LightingState) {
  return (
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    clear: GPUColor,
    presentation?: GPUTextureView,
    composed?: ComposedImage,
    asIs = true,
  ) => {
    const { active } = state
    const composition = active.composition(composed, asIs)
    if (!composition) throw new Error('SURFACE_NOT_BOUND')
    const colorAttachments: GPURenderPassColorAttachment[] = [
      { view: target, loadOp: 'clear', storeOp: 'store', clearValue: clear },
    ]
    if (presentation) colorAttachments.push({ ...colorAttachments[0], view: presentation })
    const pass = encoder.beginRenderPass({
      label: presentation ? 'Trillion3D HDR composition + present' : 'Trillion3D HDR composition',
      colorAttachments,
    })
    const blend = composed?.bloom,
      { draw, present } = active.compositions.pipelines(composition.input, !!blend)
    pass.setPipeline(presentation ? present : draw)
    pass.setBindGroup(0, composition.group)
    if (blend) pass.setBindGroup(1, blend.group, [blend.offset])
    pass.draw(3)
    pass.end()
  }
}
