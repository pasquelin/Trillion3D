import { blendShader } from './shader.ts'
import { BLEND_VIEW_SIZE } from './uniforms.ts'
import type { BlendGpuItem } from './state.ts'
import { BLEND_BINDINGS, atlasLayoutEntries, readOnly } from '../core/bindLayout.ts'
import {
  declaredBlendModes,
  pipelinesByMode,
  stageDescriptors,
  type BlendModePipelines,
} from './stagePipelines.ts'
import { BLEND_MODES } from '../../scene/materialBlending.ts'
import { createRoutedPipelines } from './routedPipelines.ts'
import { createReach } from './reach.ts'
import { filtersDisplay } from './equations.ts'
import { prepareDisplayProgram } from './displayFilterProgram.ts'
import type { WaterPass } from '../water/waterPass.ts'
import { families } from '../../host/families.ts'
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from '../../diagnostic/gpuVariant.ts'
import { feedbackFreeEntry } from '../tile/feedbackAbWgsl.ts'
import { blendTargets } from './blendTargets.ts'
import {
  createForwardVariants,
  leavesOut,
  FULL_CONTRACT,
  variantLabel,
  type ContractKey,
  type ForwardLit,
} from '../../lighting/deferred/contractVariants.ts'

/** A blend program: its module, and the pipelines drawn with it. */
type BlendProgram = { module: GPUShaderModule; pipelines: BlendModePipelines }

/** The blend fragment's values, in their order: what a feedback-free entry keeps. */
const BLEND_OUT: [string, string][] = ['color', 'asIs', 'tint', 'add'].map((name) => [
  name,
  'vec4f',
])
const FRAGMENT_IN = ['in:VSOut,@builtin(front_facing) front:bool', 'in,front'] as const

/** The forward materials' bind layout, which the feedback-free diagnostic pipelines share. */
function blendLayout(device: GPUDevice) {
  const b = BLEND_BINDINGS
  return device.createBindGroupLayout({
    entries: [
      { binding: b.indices, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.positions, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.uvs, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      {
        binding: b.uniform,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', minBindingSize: BLEND_VIEW_SIZE },
      },
      // Each item's record, read at the rank the vertex index carries: it is what replaces the
      // dynamic uniform offset, and therefore the bind group per draw.
      { binding: b.items, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      ...atlasLayoutEntries(b.color),
      { binding: b.sampler, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ...atlasLayoutEntries(b.data),
      // Every normal a transparent reads is a float atlas (`../core/floatAtlas.ts`).
      {
        binding: b.normals,
        visibility: GPUShaderStage.VERTEX,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
      },
      { binding: b.directLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.clusterDiagnostic, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.planInstances, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.clusterSpans, visibility: GPUShaderStage.VERTEX, buffer: readOnly },
      { binding: b.shadowData, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      // The virtual shadow maps (`BLEND_VSM_BINDINGS`): projection data, uniforms, pool.
      { binding: b.shadowAtlas, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.shadowSampler,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
      {
        binding: b.shadowTransmittance,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'uint', viewDimension: '2d-array' },
      },
      { binding: b.shadowTranslucentDepth, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      { binding: b.bounceGrid, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      {
        binding: b.probes,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' },
      },
      { binding: b.tileLights, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      // The resident proxy, **read-only**: a binding the fragment stage could write would
      // cost the pass its early depth reject (4232 hidden fragment draws). The probes and the
      // surface cache are atlases (`../../bounce/atlas.ts`), no storage buffer.
      { binding: b.proxy, visibility: GPUShaderStage.FRAGMENT, buffer: readOnly },
      {
        binding: b.surfaceCache,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'unfilterable-float' },
      },
    ],
  })
}

/** Builds the forward-material pipelines for transparent draws, and the water pass of a scene
 *  that transmits; a reference
 *  session's water walks its mirror ray whole (`unboundedReflections`): the session's
 *  `context`. Both light with the code the scene's lights need, as the opaque resolve
 *  (`createForwardVariants`): `lit`, the key the first frame asks for. */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: BlendGpuItem[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  share = false,
  { unboundedReflections, lit }: { unboundedReflections?: boolean; lit?: ForwardLit } = {},
) {
  // Without a variant, production compiles no diagnostic stage and has no write mask of its own.
  const selected = blendVariantPipeline(variant)
  const entryPoint = feedback ? selected.entryPoint : 'fsWithoutFeedback'
  const { writeMask } = selected
  const blendBindGroupLayout = sharedLayout ?? blendLayout(device)
  // The water pass exists for a scene that transmits, outside any diagnostic variant: under one,
  // the transmission slice draws as one more blend, the same fragment stage measured on all.
  const wantsWater = !variant && items.some((item) => item.transmissive)
  // Its code, transmission's, is imported by the first scene that transmits, glass or water, and
  // awaited here as the scene's other resources are, before any frame. An import that
  // could not load is the scene's refusal (`FAMILY_LOAD_FAILED`), never a scene without its water.
  const waterCode = wantsWater ? await families.transmission.load() : undefined
  let waterRefused: Error | undefined
  // What the scene's materials and settings reach now (`reach.ts`): normal with any item (the
  // transmission slice draws on it under a diagnostic), every mode an item declares, the share set
  // drawn now, the display layers when a mode filters. A change compiles its own, off the frame.
  // No item, no blend program.
  const declared = declaredBlendModes(items)
  const reach = createReach({
    modes: declared,
    share,
    filtered: !variant && declared.some(filtersDisplay),
  })
  /** The module lit with the code `key` leaves in, and its pipelines; the water surface stage, which
   *  lights nothing, is an entry of the module with every code path alone. */
  const compile = async (key: ContractKey): Promise<BlendProgram> => {
    const surface = leavesOut(key) ? undefined : waterCode
    let code =
      blendShader(key) +
      (surface?.WATER_SURFACE_WGSL ?? '') +
      (variant ? DIAGNOSTIC_BLEND_WGSL : '')
    if (!feedback) {
      for (const entry of ['fs', 'fsFiltered'])
        code = feedbackFreeEntry(code, entry, 'BlendOut', BLEND_OUT, ...FRAGMENT_IN)
      if (surface) code = surface.waterWithoutFeedback(code)
    }
    const label = `BLEND${variantLabel(key)}`
    const module = device.createShaderModule({ label, code: code })
    // Two lazy sets: with no reader of the share its slot stays empty, no target is bound.
    const sets = [false, true].map((withShare) => ({
      perMode: pipelinesByMode(device, (mode) =>
        stageDescriptors(
          device,
          module,
          blendBindGroupLayout,
          {
            module,
            entryPoint,
            targets: blendTargets(mode, writeMask, feedback, false, withShare),
          },
          false,
        ),
      ),
      routed: createRoutedPipelines(device, module, blendBindGroupLayout, feedback, (mode) =>
        blendTargets(mode, writeMask, feedback, true, withShare),
      ),
    }))
    const { routed: maskSet } = sets[+share]
    /** Compiles, off the frame, what is reached and not made yet; a program built later, or a
     *  reach that grows, calls it again. The mask pass is one set's, whatever the share. */
    const catchUp = async () => {
      const { modes, shares } = reach.state
      // The display layers are no part of a diagnostic variant (`beginDisplayFilter`).
      const filtered = reach.state.filtered && !variant
      const list = [...modes]
      await Promise.all([
        filtered && prepareDisplayProgram(device),
        ...[...shares].map((withShare) => {
          const { perMode, routed } = sets[+withShare]
          return Promise.all([
            perMode.precompile(list),
            filtered && (routed === maskSet ? routed : routed.filtered).precompile(list),
          ])
        }),
      ])
    }
    reach.onChange(catchUp)
    await catchUp()
    const pipelines: BlendModePipelines = {
      mask: maskSet.mask,
      reach: reach.reach,
      lit: (frame) => programOf(frame).pipelines,
      at(rank, filtered = false, withShare = false) {
        const mode = BLEND_MODES[Math.floor(rank / 3)]
        if (!mode) throw new Error(`blend pipeline rank ${rank} names no blending mode`)
        const set = sets[+withShare]
        return (filtered ? set.routed.filtered : set.perMode).at(mode, rank % 3)
      },
    }
    return { module, pipelines }
  }
  const programOf = await createForwardVariants(compile, lit)
  const { module, pipelines: blendPipelines } = programOf(FULL_CONTRACT)
  // A device that refuses the pass keeps the blends, and `waterRefused` names why to the caller.
  const water: WaterPass | undefined = await waterCode
    ?.createWaterPass(
      device,
      module,
      blendBindGroupLayout,
      feedback,
      unboundedReflections === true,
      lit,
      reach,
    )
    .catch((error: unknown) => {
      waterRefused = error instanceof Error ? error : new Error(String(error))
      return undefined
    })
  return { blendBindGroupLayout, blendPipelines, water, waterRefused }
}
