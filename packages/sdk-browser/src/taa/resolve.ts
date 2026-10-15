import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts'
import { FILTER_FORMAT } from '../webgpu/blend/displayFilter.ts'
import { createTaaLayout } from './bindingsWgsl.ts'
import { taaResolveShader } from './resolveWgsl.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'

/** As-is share, flicker gradient, still weight and history count. Geometry uses an integer target. */
export const SHARE_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** The flicker measure: the blurred luma history's half-float bits, then the flicker total and
 *  count in a byte each, one word (`shadingPack`). */
export const MOIRE_FORMAT: GPUTextureFormat = 'r32uint'
/** Full placement identity and reversed depth of each display pixel (`geometryHistoryWgsl.ts`). */
export const GEOMETRY_FORMAT: GPUTextureFormat = 'rg32uint'
/** A history's targets, in the resolve's order: colour, as-is share, geometry, flicker measure. */
export const HISTORY_FORMATS = [HDR_FORMAT, SHARE_FORMAT, GEOMETRY_FORMAT, MOIRE_FORMAT] as const

/** The usage of a target a resolve writes: drawn and read, never stored — a stored texture is never
 *  losslessly compressed on an Apple GPU (Metal's `shaderWrite`, which Dawn sets for
 *  `STORAGE_BINDING`). */
export const resolveTargetUsage = () =>
  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING

type TaaResolveKind = 'asIs' | 'flagless' | 'blended'

/**
 * The pass's resolves (`taaResolveShader`, one program for every render scale, the display's size
 * its ratio one), all compiled at preparation, so a frame that switches compiles nothing: the one
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
