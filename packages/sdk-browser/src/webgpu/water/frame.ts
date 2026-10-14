import { bindForwardReflection } from '../../reflections/gpu.ts'
import { frontAttachment, frontFromWater } from '../../reflections/frontAttachment.ts'
import { createWaterCopy } from './copy.ts'
import { createWaterDepthRestore } from './depthRestore.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { bindWaterFrame, type WaterFrameState } from './frameBind.ts'
import { drawBlendRuns } from '../blend/draw.ts'
import { feedbackAttachment } from '../pages/prepare/attachments.ts'
import type { BlendLighting } from '../core/blendBindEntries.ts'
import type { BlendPipelines } from '../blend/stagePipelines.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { WaterSources } from './compositeGroup.ts'
import { createWaterCompositeLayout, createWaterComposites } from './pipelines.ts'
import { routedFilter } from '../blend/displayFilter.ts'
import { activeAsIsShare } from '../pages/prepare/asIsShareTarget.ts'
import { createWaterPasses } from './passes.ts'
import { createReach, type Reach } from '../blend/reach.ts'
import { createForwardVariants, type ForwardLit } from '../../lighting/deferred/forwardVariants.ts'
import { FULL_CONTRACT, type ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { VERDICT } from '../blend/verdictLayout.ts'

/**
 * The frame side of the water pass: the composite program, and everything an image reuses as long
 * as what it names does not change — the bind group, the copy that freezes the backdrop, the
 * surface pass and the composite pass (`createWaterPasses`). The targets change on a resize, the
 * lighting resources when the shadow atlas or the probe grid arrive, the verdict when the scene's
 * items do: `bind` writes their identities and rebuilds only when one moved, so a still frame
 * builds and allocates nothing.
 */
export async function createWaterFrame(
  device: GPUDevice,
  feedback = true,
  lit?: ForwardLit,
  reach: Reach = createReach({ modes: [], share: false, filtered: false }),
) {
  const layout = createWaterCompositeLayout(device)
  const [composites, restore, copy] = await Promise.all([
    // The composite lit with the code the scene's lights need (`createForwardVariants`).
    createForwardVariants((key) => createWaterComposites(device, layout, key, reach), lit),
    // The opaque depth's restore: the surface pass's first draw, on its targets.
    createWaterDepthRestore(device, feedback),
    // The backdrop's freeze, over the rectangle the GPU wrote.
    createWaterCopy(device),
  ])
  const frame: WaterFrameState = {
    device,
    layout,
    composites,
    restore,
    copy,
    sources: {} as WaterSources,
    identity: createWebgpuBindIdentity(2),
    targets: createWebgpuBindIdentity(),
    groups: [],
    passes: createWaterPasses(),
  }
  return {
    /** The opaque depth's restore, whose lobed pipeline the lobed stage prepares
     *  (`lobedStage.ts`). */
    restore,
    /** The compile a frame of lobed transmissive items waits for while no composite with the lobe
     *  code is ready: the one with every code path, which lights any (`askLobedPrograms`). */
    lobedAwaited: () => composites.awaited(FULL_CONTRACT),
    /** Names the frame's targets and resources, the item records whose poses the volumes name, and
     *  the verdict whose rectangle and gate the pass draws by; false while one of them does not
     *  exist. */
    bind: (
      gpu: WebgpuGpuState,
      uniform: GPUBuffer,
      lighting: BlendLighting,
      items: GPUBuffer,
      verdict: GPUBuffer,
    ) => bindWaterFrame(frame, gpu, uniform, lighting, items, verdict),
    /** Encodes the water pass on the image the blends left (`encodeWaterFrame`). */
    encode: (
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      pipelines: BlendPipelines,
      key: Partial<ContractKey>,
      lobed = false,
    ) => encodeWaterFrame(frame, rt, encoder, pipelines, key, lobed),
    dispose() {
      restore.dispose()
      copy.dispose()
      frame.group = undefined
      frame.groups.length = 0
      frame.surfaces = undefined
    },
  }
}

/**
 * Encodes the water pass on the image the blends left, its extent and its gate the GPU's
 * (`argsWgsl.ts`): the backdrop is frozen (`copy.ts`) — the lit image copied over the rectangle
 * the surfaces may refract —, the opaque depth restored by the surface pass's first draw into the
 * depth the surface stage tests, on the rectangle's quad; the transmissive surfaces draw into the
 * opaque resolve's material surfaces, free since that resolve consumed them, and the water word
 * into the display colour the composition writes later — the surface flags stay the opaque
 * resolve's, read by temporal antialiasing and the composition after this pass —, with hardware
 * depth written so the nearest surface of a pixel is the one kept; then the rectangle's quad
 * lights and composes every water pixel into the HDR target, which keeps what it held wherever no
 * water is (the display layers where their mask is set), and, when the frame has a share, its
 * coverage as the reactive value the blends and particles also write (`asIsShare.ts`). No scissor:
 * a surface's fragments lie in its rectangle by construction — its local box enclosed under its
 * pose and the projection, with every rounding (`rectWgsl.ts`) —, the quads cover the rectangle
 * alone, and every draw and the copy take zero instances or workgroups from the GPU when no water
 * draws. The word clear stays full-target, a load clear. The composite is the program of the frame's lights' `key`
 * (`createForwardVariants`). With `lobed`, `pipelines` are the lobed stage's (`lobedStage.ts`): the
 * lobes target is one more attachment, and the composite the program that reads it
 * (`waterLobesWgsl.ts`); without, the program without lobe code. Returns the surface draws encoded.
 */
function encodeWaterFrame(
  frame: WaterFrameState,
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  pipelines: BlendPipelines,
  key: Partial<ContractKey>,
  lobed: boolean,
) {
  const { group, passes, sources } = frame
  if (!group || !frame.surfaces) throw new Error('WATER_NOT_BOUND')
  const [width, height] = rt.gpu.targetSize,
    front = rt.gpu.reflection!.front
  frame.copy.encode(encoder)
  const written = rt.vis.writesFeedback ? feedbackAttachment(rt) : undefined
  const pass = encoder.beginRenderPass(passes.surface(lobed, frontAttachment(front, true), written))
  pass.setViewport(0, 0, width, height, 0, 1)
  frame.restore.draw(pass, lobed)
  rt.run.gpuDrawCalls++
  const encoded = drawBlendRuns(rt, frame.device, pass, 1, pipelines)
  pass.end()
  // The next image's front depth carries this one's from the rectangle the GPU wrote.
  frontFromWater(encoder, front, sources.verdict)
  const share = activeAsIsShare(rt),
    filter = routedFilter(rt.gpu.displayFilter)
  const composite = encoder.beginRenderPass(passes.composite(filter, share?.view))
  composite.setViewport(0, 0, width, height, 0, 1)
  composite.setPipeline(frame.composites.pick(key, lobed).at(!!filter, !!share))
  composite.setBindGroup(0, group)
  bindForwardReflection(composite, rt)
  if (filter) composite.setBindGroup(2, filter.maskGroup)
  composite.drawIndirect(sources.verdict, VERDICT.quadArgs * 4)
  composite.end()
  return encoded
}

export type WaterFrame = Awaited<ReturnType<typeof createWaterFrame>>
