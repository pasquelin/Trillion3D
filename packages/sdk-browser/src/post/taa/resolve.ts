import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../../lighting/deferred/fullscreen.ts'
import { FILTER_FORMAT } from '../../blend/display/displayFilter.ts'
import { createTaaLayout } from './bindingsWgsl.ts'
import { taaResolveShader } from './resolveWgsl.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { TAA_PASS } from '../../diagnostic/stage/passLabels.ts'

/** The share target: the as-is share in red, the history's validity in green, eight bits each. */
const SHARE_FORMAT: GPUTextureFormat = 'rg8unorm'
/** A history's targets, in the resolve's order: colour, share target. */
export const HISTORY_FORMATS = [HDR_FORMAT, SHARE_FORMAT] as const

/** The usage of a target a resolve writes: drawn and read, never stored — a stored texture is never
 *  losslessly compressed on an Apple GPU (Metal's `shaderWrite`, which Dawn sets for
 *  `STORAGE_BINDING`). */
export const resolveTargetUsage = () =>
  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING

/** A pass of the temporal pass into `views`, each cleared — on a tiled GPU a clear loads nothing —,
 *  under its label: the history update's and the anti-aliaser's. */
export const taaPass = (views: readonly GPUTextureView[]): GPURenderPassDescriptor => ({
  label: TAA_PASS,
  colorAttachments: views.map((view) => ({
    view,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  })),
})

type TaaResolveKind = 'asIs' | 'flagless' | 'blended'

/**
 * The pass's history updates (`taaResolveShader`, one program for every render scale, the display's
 * size its ratio one), all compiled at preparation, so a frame that switches compiles nothing: the one
 * of a frame with an as-is pixel, the flagless one, which binds no surface flags and reads no as-is
 * share, and the blended one. A `filtered` one, resolving the display layers too (`layers.ts`) —
 * two more targets, which a frame without a filtering blend never pays —, compiles off the frame
 * when first asked: `undefined` till then.
 */
export async function createTaaResolves(device: GPUDevice) {
  // One layout per kind and filter, for the pass's life.
  const layouts: Record<string, GPUBindGroupLayout> = {}
  const resolve = async (kind: TaaResolveKind, filtered = false) => {
    const asIs = kind !== 'flagless',
      blended = kind === 'blended',
      layout = (layouts[kind + filtered] ??= createTaaLayout(device, asIs, blended, filtered)),
      label = blended ? 'TAA_RESOLVE_BLENDED' : asIs ? 'TAA_RESOLVE' : 'TAA_RESOLVE_FLAGLESS',
      name = label + (filtered ? '_FILTERED' : '')
    const module = await createCheckedShaderModule(
      device,
      taaResolveShader(asIs, blended, filtered),
      name,
    )
    const targets: GPUColorTargetState[] = HISTORY_FORMATS.map((format) => ({ format }))
    if (filtered) targets.push({ format: FILTER_FORMAT }, { format: FILTER_FORMAT })
    return {
      layout,
      pipeline: await makeFullscreenPipeline(device, module, layout, 'resolve', targets),
    }
  }
  const [asIs, flagless, blended] = await Promise.all([
    resolve('asIs'),
    resolve('flagless'),
    resolve('blended'),
  ])
  const layered = new Map<TaaResolveKind, Awaited<ReturnType<typeof resolve>> | undefined>()
  const filtered = (kind: TaaResolveKind) => {
    if (!layered.has(kind)) {
      layered.set(kind, undefined)
      // One that fails to compile leaves the resolve without layers, never an unhandled rejection.
      resolve(kind, true).then(
        (made) => void layered.set(kind, made),
        () => {},
      )
    }
    return layered.get(kind)
  }
  return { asIs, flagless, blended, filtered }
}
