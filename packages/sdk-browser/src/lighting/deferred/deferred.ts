import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from './shaders.ts'
import { createContractVariants, type LitPrograms } from './contractVariants.ts'
import { cutsIn } from './contractCuts.ts'
import { createDeferredPlaceholders } from './setup.ts'
import type { ComposedImage, DirectLightResources } from './program.ts'
import type { PerLightLights } from '../shadows/vsm/projection/perLightPass.ts'
import { createTileClassification } from './classify.ts'
import { createSurfaceColourPass, createUnlitPass } from './colourPass.ts'
import { createComposer, type Composer } from './composer.ts'
import { litSteps, type LitProgram } from './litProgram.ts'
import { type ClearColor, ZERO_DIRECT, createDeferredView } from './view.ts'
import { createToneLut } from '../toneLut.ts'
import { createHeightFogPass, type FogPassResources } from '../fog/fogPass.ts'
import { createVolumetricLightPass } from './volumetricLightPass.ts'
import { HDR_COMPOSITION_PASS, HDR_PRESENT_PASS } from '../../diagnostic/stage/passLabels.ts'

/** Whether these resources light with the bounce program. */
const bounceOf = ({ bounceGrid }: DirectLightResources) => !!bounceGrid

/** The key of the lit program a frame bound to `direct` asks: whether it bounces, the lists' width and the cuts of its light code. */
const keyOf = (direct: DirectLightResources) =>
  [bounceOf(direct), !!direct.narrow, cutsIn(direct)] as const

type DeferredView = ReturnType<typeof createDeferredView>
type ContractVariants = ReturnType<typeof createContractVariants>

/** What the lighting keeps between its calls: the frame's lit program, which `bind` picks and every
 *  pass of the frame then draws with (none: the unlit view's), what the frame was bound to, the
 *  raw-output switch, the view of the lit image asked for, and the size this image draws, from
 *  `update`: its targets may be larger (`renderScale.ts`). */
type LightingState = {
  active: LitProgram | undefined
  surface?: SurfaceBuffer
  depth?: GPUTextureView
  direct: DirectLightResources
  /** Diagnostic views output raw values: no filmic curve, no sRGB, no composed background. The
   *  indirect-irradiance view is one, and lighting says so, not the caller. */
  rawOutput: boolean
  /** The lighting term the image shows in place of the lit surface (`setLightView`). */
  lightView: number
  readonly drawn: number[]
}

/** What the lighting is made of: its view, the stand-ins of the resources a frame leaves out, the
 *  tone table its compositions read, the lit programs (`createContractVariants`), the passes that
 *  need no program of a key, and the promise that the lit one `prepare` asked has landed. */
type LightingParts = {
  view: DeferredView
  placeholders: ReturnType<typeof createDeferredPlaceholders>
  tone: ReturnType<typeof createToneLut>
  variants: ContractVariants
  statics: Statics
  litReady: Promise<void>
}

/** The passes that need no program of a key: the surfaces' classification into tiles, the lit image's
 *  first pass, the unlit view's, the composition of both views, and the fog (made at the first lit
 *  image, `askFog`). */
type Statics = {
  classification: ReturnType<typeof createTileClassification>
  colour: Awaited<ReturnType<typeof createSurfaceColourPass>>
  unlit: Awaited<ReturnType<typeof createUnlitPass>>
  unlitComposer: Composer
  /** The lit composition, once the first lit program awaited it. */
  litComposed(): Composer | undefined
  fog(): ReturnType<typeof createHeightFogPass> | undefined
  askFog(): void
  /** The volumetric lightmap's light pass, made at the first lit image that has a lightmap
   *  (`lightPass`). */
  volumetricLight(): ReturnType<typeof createVolumetricLightPass>
  release(): void
}

/** The fog pass and the lightmap's light pass, each made at its first ask. */
function lazyPasses(
  device: GPUDevice,
  uniform: GPUBuffer,
  lit: LitPrograms | undefined,
  failed: (error: unknown) => void,
) {
  let fogPass: ReturnType<typeof createHeightFogPass> | undefined
  let lightmapPass: ReturnType<typeof createVolumetricLightPass> | undefined
  return {
    askFog() {
      fogPass ??= createHeightFogPass(device, uniform, lit?.localFog !== false, failed)
    },
    fog: () => fogPass,
    volumetricLight: () => (lightmapPass ??= createVolumetricLightPass(device, uniform, failed)),
    release() {
      fogPass?.release()
      lightmapPass?.release()
    },
  }
}

/** The lit composition, made when a lit program first asks (`createContractVariants`): a scene
 *  that is never lit never compiles it. */
function lazyLitComposer(device: GPUDevice, bindings: Parameters<typeof createComposer>[2]) {
  let litComposition: Promise<Composer> | undefined,
    litComposer: Composer | undefined,
    released = false
  return {
    ready: () =>
      (litComposition ??= createComposer(device, CONTRACT_COMPOSITIONS, bindings, 'LIT').then(
        (made) => {
          // Released while it was being made: nothing will ever name it.
          if (released) made.release()
          return (litComposer = made)
        },
      )),
    current: () => litComposer,
    release() {
      released = true
      litComposer?.release()
    },
  }
}

/** Deferred and frozen-source lighting programs: the lit ones from the start when `lit` says so,
 *  else compiled lazily for the active lighting mode. */
export async function createDeferredLighting(
  device: GPUDevice,
  onReady?: () => void,
  lit?: LitPrograms,
) {
  const view = createDeferredView(device)
  const placeholders = createDeferredPlaceholders(device)
  // The table every lit composition reads its display value from, made at its first ask.
  const tone = createToneLut(device)
  const bindings = { uniform: view.buffer, placeholders, tone }
  const failed = (error: unknown) => lit?.onFailure?.(error)
  const litComposer = lazyLitComposer(device, bindings)
  // Programs, never a branch: the unlit view, and the contract ones (`contractVariants.ts`).
  const variants = createContractVariants(device, bindings, onReady, lit, litComposer.ready)
  // The program the first frame asks for, and its wide twin. Prepare waits for the one without
  // bounce, which lights any first frame; the bounce pair lands meanwhile.
  const litReady = lit?.precompile ? variants.precompile(false, lit.key) : Promise.resolve()
  if (lit?.precompile && lit.bounce) void variants.precompile(true, lit.key)
  const classification = createTileClassification(device, failed)
  const lazy = lazyPasses(device, view.buffer, lit, failed)
  if (lit?.precompile) lazy.askFog()
  const made = await Promise.all([
    createUnlitPass(device, view.buffer, 'DEFERRED'),
    createSurfaceColourPass(device, view.buffer),
    createComposer(device, UNLIT_COMPOSITIONS, bindings, 'UNLIT'),
  ]).catch((error: unknown) => {
    classification.dispose()
    lazy.fog()?.release()
    view.dispose()
    placeholders.dispose()
    tone.dispose()
    variants.release()
    throw error
  })
  const [unlit, colour, unlitComposer] = made
  const statics: Statics = {
    classification,
    colour,
    unlit,
    unlitComposer,
    litComposed: litComposer.current,
    fog: lazy.fog,
    askFog: lazy.askFog,
    volumetricLight: lazy.volumetricLight,
    release() {
      classification.dispose()
      colour.release()
      unlit.release()
      unlitComposer.release()
      litComposer.release()
      lazy.release()
    },
  }
  return lightingOf({ view, placeholders, tone, variants, statics, litReady })
}

/** The calls that set a term of the view uniform. */
function viewSetters(state: LightingState, view: DeferredView) {
  return {
    /** Outputs the image in raw values, without the display chain. For a measurement view. */
    setRawOutput(value: boolean) {
      state.rawOutput = value
    },
    setJitter: view.setJitter,
    /** The lighting term a view of the lit image shows in place of the surface (`writeLightView`). */
    setLightView(code: number) {
      state.lightView = code
      view.writeLightView(code)
    },
    /** The shading models' switches (`writeModelSwitches`). */
    setModelSwitches: view.writeModelSwitches,
    /** The subsurface model's transmittance distance (`writeSubsurfaceDistance`). */
    setSubsurfaceDistance: view.writeSubsurfaceDistance,
    /** How the lit passes apply the ambient occlusion of this image (`writeAmbientOcclusion`). */
    setAmbientOcclusion: view.writeAmbientOcclusion,
    /** How the indirect pass reads the screen probes' history of this image (`writeScreenProbes`). */
    setScreenProbes: view.writeScreenProbes,
    /** What the lit passes' contact shadows' rays read of the view (`writeContactShadows`). */
    setContactShadows: view.writeContactShadows,
    /** The look of the light a surface reflects (`writeReflectionLook`). */
    setReflectionLook: view.writeReflectionLook,
  }
}

/** The lighting's calls that ask the lit programs of a variant table for what a frame lit with some resources needs. */
function variantAsks(variants: ContractVariants) {
  return {
    /** What a frame lit with these resources waits for: the lit program's compile while no ready
     *  one can light it, else nothing (`contractVariants.ts`). */
    awaited: (direct: DirectLightResources) => variants.awaited(...keyOf(direct)),
    /** Starts the compile of the bounce program of the key these resources ask, before the probes it reads exist: the bounce wants it, and it compiles beside the probes' rigging
     *  instead of after it. Nothing waits for it here (`awaited` does once the probes are there). */
    askBounce: (direct: DirectLightResources) =>
      void variants.exact(true, !!direct.narrow, cutsIn(direct)),
    /** Asks the per-light path's pipelines (`PerLightProgram.ready`) of the program a frame lit with these resources will bind, once it
     *  is compiled: their compile holds the frames, so that no image is drawn without the lights they draw (and
     *  advances no history) while they compile. Returns the compile of that program while it is pending: the frames wait for it too. */
    askPerLight: (direct: DirectLightResources) => {
      // The program the image will bind once compiled, never the one lent while it compiles: what the frame waits for follows the lights'
      // configuration, not which compile happened to land first. The compile pending, else the per-light pipelines asked (their ask holds the frames).
      const exact = variants.exact(
        ...keyOf(direct),
        !!direct.skyShadowing,
        !!direct.capsuleIndirect,
      )
      if (!exact.program) return exact.pending
      exact.program.perLightReady()
    },
  }
}

/** The lighting's calls that lay the fog over a lit image or a layer of its own. */
function fogCalls(
  state: LightingState,
  statics: Statics,
  placeholders: LightingParts['placeholders'],
) {
  return {
    /** Lays the fog over the lit image, after the lights and the sky (`fogPass`); nothing while the
     *  pass is not asked or not compiled. */
    fog: fogPass(state, statics, placeholders),
    /** The fog pass's group 0 and layout over the frame's resources, for a pass that lays the fog over a layer of its own (the hair strands'
     *  composition, `fogOverModules`); none while the pass is not asked or compiled. */
    fogBinding: () => {
      const pass = statics.fog()
      const resources = fogResourcesOf(state, placeholders)
      if (!pass?.ready || !resources) return undefined
      return { layout: pass.layout, localFog: pass.localFog, group: pass.groupOf(resources) }
    },
    /** Lays the fog over the water pass's copy of the scene (`fogBehindWaterPass`). */
    fogBehindWater: fogBehindWaterPass(state, statics, placeholders),
  }
}

/** The lighting's calls over its parts (`LightingParts`). */
function lightingOf({ view, placeholders, tone, variants, statics, litReady }: LightingParts) {
  const state: LightingState = {
    active: undefined,
    direct: {},
    rawOutput: false,
    lightView: 0,
    drawn: [1, 1],
  }
  /** The composition of the program the frame is lit with: the lit chain's once a lit program is
   *  picked (it awaited it), else the unlit view's. */
  const composerOf = (): Composer =>
    (state.active && statics.litComposed()) || statics.unlitComposer
  return {
    uniform: view.buffer,
    /** What an absent contract resource is worth: the blend pass binds the same. */
    placeholders,
    /** The tone table the lit compositions read: baked again, when its settings or the scene's
     *  display curve changed, by the frame before the composition (`../../post/finish/toneFrame.ts`). */
    toneLut: tone,
    ...viewSetters(state, view),
    /** Settled once the lit program prepare started has landed, or failed (`LitPrograms`). */
    litReady,
    get usesContract() {
      return !!state.active
    },
    /** The lit program the frame was bound to, none for the unlit view's: the strands' light is made over its layouts and groups. */
    get litProgram() {
      return state.active
    },
    /** Whether the frame is lit with the bounce program, which reads the probes' light. */
    get bouncing() {
      return !!state.active?.bounce
    },
    /** Writes the view uniform of this image (`view.ts`). */
    update: viewUpdate(state, view),
    /** Select and lazily compile the active lighting program. */
    bind: programBind(state, variants, statics, composerOf),
    settle: () => variants.settle(),
    ...variantAsks(variants),
    /** Asks for the fog pass, made at the first lit image: its compile holds the frames. */
    askFog: () => statics.askFog(),
    /** Draws the lit image's light (`lightPass`). */
    light: lightPass(state, statics, placeholders, view.buffer),
    ...fogCalls(state, statics, placeholders),
    /** True once the frame's program composes the finishing in (#963); the first call compiles
     *  what it needs, and `sink` hears why it cannot. */
    composesFinish: (sink: (phase: string, error: unknown) => void) =>
      composerOf().compositions.composesFinish(sink),
    /** Composes the lit image, or the one handed in (`composePass`). */
    compose: composePass(composerOf, view),
    dispose() {
      view.dispose()
      placeholders.dispose()
      tone.dispose()
      statics.release()
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
    clear: ClearColor,
    diagnostic: boolean,
    direct: ArrayLike<number> = ZERO_DIRECT,
  ) => {
    const raw = diagnostic || state.rawOutput
    state.drawn[0] = width
    state.drawn[1] = height
    view.write(inverseViewProjection, camera, width, height, clear, raw, direct)
  }
}

/** The lighting's `bind`: selects, and lazily compiles, the frame's lit program (none: the unlit view),
 *  and names what the frame is lit from. */
function programBind(
  state: LightingState,
  variants: ContractVariants,
  statics: Statics,
  composerOf: () => Composer,
) {
  return (
    surface: SurfaceBuffer,
    depth: GPUTextureView,
    hdr: GPUTextureView,
    wantsContract: boolean,
    direct: DirectLightResources = {},
    onFailure?: (error: unknown) => void,
  ) => {
    // A program still compiling lends the frame the best one ready (`contractVariants.ts`).
    state.active =
      (wantsContract &&
        variants.pick(
          ...keyOf(direct),
          onFailure,
          !!direct.skyShadowing,
          !!direct.capsuleIndirect,
        )) ||
      undefined
    state.surface = surface
    state.depth = depth
    state.direct = direct
    composerOf().bind(surface, hdr)
    if (state.active) statics.askFog()
  }
}

/**
 * The lighting's `light`: the surfaces cut into tiles by the class of their pixels (`tileClass.ts`),
 * then the lit image in one render pass (`createLitProgram`): written whole (the background, the
 * surfaces shown as they are, the emission), then the light of the directional lights, of the local
 * lights, and the indirect light added to it. The unlit view draws its one pass. Returns the draws made.
 */
function lightPass(
  state: LightingState,
  statics: Statics,
  placeholders: ReturnType<typeof createDeferredPlaceholders>,
  uniform: GPUBuffer,
) {
  return (encoder: GPUCommandEncoder, hdr: GPUTextureView) => {
    const { active, surface, depth, drawn, direct } = state
    if (!surface || !depth) throw new Error('SURFACE_NOT_BOUND')
    const [width, height] = drawn
    if (!active) {
      statics.unlit.draw(encoder, hdr, surface, width, height)
      return 1
    }
    const { classification } = statics
    classification.ensure(width, height)
    classification.encode(encoder, surface.stores()[1], uniform, width, height)
    // The lightmap's light on the pixels, left in a texture the indirect pass reads (`volumetricLightPass.ts`):
    // none while its pipeline compiles, or where the image reads no lightmap.
    direct.volumetricLight = undefined
    if (direct.volumetricLightmap) {
      const gather = statics.volumetricLight()
      if (gather.ready)
        direct.volumetricLight = gather.draw(
          encoder,
          surface,
          depth,
          direct.volumetricLightmap,
          width,
          height,
        )
    }
    active.bind(surface, depth, direct, classification.lists)
    const occlusion = direct.ambientOcclusion ?? placeholders.ambientOcclusion
    const pass = statics.colour.begin(encoder, hdr, width, height)
    statics.colour.record(pass, surface, occlusion)
    return (
      1 +
      drawLights(
        statics.colour,
        active,
        encoder,
        hdr,
        pass,
        classification.draws,
        state.lightView,
        perLightOf(state.lightView, direct),
        drawn,
      )
    )
  }
}

/** The shadowed local lights the frame lights one by one (`DirectLightResources.perLight`), where the view shows the whole lighting;
 *  else none, and the batched loop lights them. */
const perLightOf = (lightView: number, direct: DirectLightResources) =>
  (lightView === 0 || lightView === 3) && !direct.sampled ? direct.perLight : undefined

/**
 * The lights of the lit image, one driver for both paths: the steps of `litSteps` in their order, into the pass `pass` the colour
 * began. On the batched path they are the indirect light's, the sun's and the local lights', one pass. With per-light lights
 * (`shadowOnePassProjection` false) the pass is ended before each light's draw and begun again over the image as it stands
 * (`resume`), the light's mask encoded between them (`PerLightLights.encodeMask`): the lights are drawn in the order of their
 * records, after the indirect light's draw, which the first pass holds with the sun's and the local lights'. While the path's pipelines compile
 * (`ready`) the local lights' step still leaves the shadowed lights out and no per-light step is drawn: no light reads a mask that
 * was not projected, and the frame is drawn again once they are compiled (`chainReady`). Returns the draws made.
 */
function drawLights(
  colour: Statics['colour'],
  active: LitProgram,
  encoder: GPUCommandEncoder,
  hdr: GPUTextureView,
  first: GPURenderPassEncoder,
  draws: GPUBuffer,
  lightView: number,
  lights: PerLightLights | undefined,
  [width, height]: readonly number[],
) {
  const ready = !!lights && lights.ready() && active.perLightReady()
  let pass = first,
    made = 0
  for (const step of litSteps(lightView, ready ? lights.count : 0)) {
    if (typeof step === 'number') {
      pass.end()
      lights!.encodeMask(encoder, step)
      pass = colour.resume(encoder, hdr, width, height)
    }
    made += active.drawStep(pass, draws, step, lights)
  }
  pass.end()
  return made
}

/** What the fog passes are bound to this frame, none while the frame is not lit or bound. */
function fogResourcesOf(
  state: LightingState,
  placeholders: ReturnType<typeof createDeferredPlaceholders>,
): FogPassResources | undefined {
  const { active, surface, depth, direct } = state
  if (!active || !surface || !depth || !direct.lights) return undefined
  return {
    surface,
    depth,
    lights: direct.lights,
    fog: direct.fog ?? placeholders.fog,
    lightShaft: direct.lightShaft ?? placeholders.lightShaft,
    haze: direct.haze ?? placeholders.hazeVolume,
  }
}

/** The lighting's `fog`: the fog laid over the lit image, once the lights and the sky are in it —
 *  holding its light out where `holdout` says —, from the resources the frame was bound to (`bind`): its light buffer, the fog's cubemap and volume,
 *  the light shafts' mask and the haze's volume, each by its stand-in where the image has none. */
function fogPass(
  state: LightingState,
  statics: Statics,
  placeholders: ReturnType<typeof createDeferredPlaceholders>,
) {
  return (encoder: GPUCommandEncoder, hdr: GPUTextureView, holdout = false) => {
    const pass = statics.fog()
    const resources = fogResourcesOf(state, placeholders)
    if (!pass?.ready || !resources) return
    pass.draw(encoder, hdr, resources, state.drawn[0], state.drawn[1], holdout)
  }
}

/** The lighting's `fogBehindWater`: the fog over the scene without the single-layer water, at the depths the water pass's copy holds, from the
 *  resources the frame was bound to; nothing while the fog pass is not asked or compiled. */
function fogBehindWaterPass(
  state: LightingState,
  statics: Statics,
  placeholders: ReturnType<typeof createDeferredPlaceholders>,
) {
  return (
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    waterDepth: GPUTextureView,
    width: number,
    height: number,
  ) => {
    const pass = statics.fog()
    const resources = fogResourcesOf(state, placeholders)
    if (!pass?.ready || !resources) return
    pass.drawBehindWater(encoder, target, resources, waterDepth, width, height)
  }
}

/** The size of the image a composition reads, `drawn`, of the display it shows it at, `shown`, and
 *  of the surfaces a debug view's as-is pixels are read from, `surface` (`drawn` where absent). */
export type ComposeSource = {
  drawn: readonly number[]
  shown: readonly number[]
  surface?: readonly number[]
}
/** A source at the display's size: read pixel for pixel. */
const AT_DISPLAY: ComposeSource = { drawn: [1, 1], shown: [1, 1] }

/** The lighting's `compose`: composes the lit image, or `composed`: the temporal output, or the
 *  effect chain's, finished by its group when it has one, a debug view's as-is pixels drawn over it
 *  from the surfaces; reading none when `asIs` says none is in the frame. `source` is the size of the image composed and the display's, which it upscales to
 *  where it was drawn below it (`writeSource`); none, an image at the display's size. With a
 *  `presentation`, the display colour `view` is written as well unless `writesDisplay` is false. */
function composePass(composerOf: () => Composer, uniform: DeferredView) {
  const target: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
  }
  const shown: GPURenderPassColorAttachment = { ...target }
  const plain: GPURenderPassDescriptor = {
    label: HDR_COMPOSITION_PASS,
    colorAttachments: [target],
  }
  const presented: GPURenderPassDescriptor = {
    label: HDR_PRESENT_PASS,
    colorAttachments: [target, shown],
  }
  const canvasOnly: GPURenderPassDescriptor = {
    label: HDR_PRESENT_PASS,
    colorAttachments: [shown],
  }
  const groups: GPUBindGroup[] = []
  return (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    clear: GPUColor,
    presentation?: GPUTextureView,
    composed?: ComposedImage,
    asIs = true,
    source: ComposeSource = AT_DISPLAY,
    writesDisplay = true,
  ) => {
    const composer = composerOf()
    const composition = composer.composition(composed, asIs)
    uniform.writeSource(source.drawn, source.shown, source.surface)
    if (!composition) throw new Error('SURFACE_NOT_BOUND')
    target.view = view
    target.clearValue = clear
    if (presentation) {
      shown.view = presentation
      shown.clearValue = clear
    }
    const finish = composed?.finish,
      pipelines = composer.compositions.pipelines(composition.input, !!finish)
    // The canvas alone where nothing reads the display colour this frame (`writesDisplay` false).
    const canvas = presentation && !writesDisplay ? pipelines.canvas : undefined
    groups.length = 0
    groups.push(composition.group)
    if (finish) groups.push(finish)
    drawFullscreenTriangle(
      encoder,
      canvas ? canvasOnly : presentation ? presented : plain,
      canvas ?? (presentation ? pipelines.present : pipelines.draw),
      groups,
    )
  }
}
