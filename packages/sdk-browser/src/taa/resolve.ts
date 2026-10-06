import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { makeFullscreenPipeline } from '../lighting/deferred/fullscreen.ts'
import { FILTER_FORMAT } from '../webgpu/blend/displayFilter.ts'
import { taaShader } from './shaderWgsl.ts'
import { createTaaLayout } from './bindingsWgsl.ts'
import { taaUpscaleShader } from './upscaleWgsl.ts'

/** As-is share, flicker gradient, still weight and history count. Geometry uses an integer target. */
export const SHARE_FORMAT: GPUTextureFormat = 'rgba8unorm'
/** The flicker measure: the blurred luma history's half-float bits, then the flicker total and
 *  count in a byte each, one word (`shadingPack`). */
export const MOIRE_FORMAT: GPUTextureFormat = 'r32uint'

/** The usage of a target a resolve writes: drawn and read, never stored — a stored texture is never
 *  losslessly compressed on an Apple GPU (Metal's `shaderWrite`, which Dawn sets for
 *  `STORAGE_BINDING`). */
export const resolveTargetUsage = () =>
  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING

type TaaResolveKind = 'asIs' | 'flagless' | 'blended'

/**
 * The pass's resolves, all compiled at preparation, so a frame that switches compiles nothing: the
 * one of a frame with an as-is pixel, the flagless one, which binds no surface flags and reads no
 * as-is share, and the blended one. The same three again reconstruct a
 * frame drawn below the display (`upscaleWgsl.ts`): compiled at preparation with `upscale` — a
 * session asking a scale below 1 —, otherwise off the frame when `upscaled` is first asked, which
 * answers `undefined` till then. A `filtered` twin, resolving the display layers too
 * (`layers.ts`), compiles off the frame when first asked: `undefined` till then. So does an
 * `unreactive` one, for a frame whose blends, particles and water wrote no reactive value: it reads
 * none, its 0 the value of the zero texel bound in its place — the same words, one fetch fewer. The
 * native flagless and as-is ones are asked at once, off the preparation.
 */
export async function createTaaResolves(device: GPUDevice, upscale = false) {
  // One layout per kind and filter, shared by its native and upscaling resolves: one choice of
  // stage for the pass's life, as its twins compile off the frame.
  const layouts: Record<string, GPUBindGroupLayout> = {}
  const resolve = async (
    kind: TaaResolveKind,
    scaled: boolean,
    filtered = false,
    reactive = true,
  ) => {
    const asIs = kind !== 'flagless',
      blended = kind === 'blended',
      layout = (layouts[kind + filtered] ??= createTaaLayout(device, asIs, blended, filtered)),
      label = blended ? 'TAA_RESOLVE_BLENDED' : asIs ? 'TAA_RESOLVE' : 'TAA_RESOLVE_FLAGLESS',
      name =
        label +
        (scaled ? '_UPSCALE' : '') +
        (filtered ? '_FILTERED' : '') +
        (reactive ? '' : '_UNREACTIVE')
    const module = await createCheckedShaderModule(
      device,
      (scaled ? taaUpscaleShader : taaShader)(asIs, blended, filtered, reactive),
      name,
    )
    const targets: GPUColorTargetState[] = [
      { format: 'rgba16float' },
      { format: SHARE_FORMAT },
      { format: 'rg32uint' },
      { format: MOIRE_FORMAT },
    ]
    if (filtered) targets.push({ format: FILTER_FORMAT }, { format: FILTER_FORMAT })
    return {
      layout,
      pipeline: await makeFullscreenPipeline(device, module, layout, 'resolve', targets),
    }
  }
  const set = async (scaled: boolean) => {
    const [asIs, flagless, blended] = await Promise.all([
      resolve('asIs', scaled),
      resolve('flagless', scaled),
      resolve('blended', scaled),
    ])
    return { asIs, flagless, blended }
  }
  let upscaledSet: Awaited<ReturnType<typeof set>> | undefined, compiling: Promise<void> | undefined
  const upscaled = () => {
    if (!compiling) {
      compiling = set(true).then((made) => void (upscaledSet = made))
      // Asked off the frame, a set that fails to compile leaves it at the display's size.
      compiling.catch(() => {})
    }
    return upscaledSet
  }
  if (upscale) upscaled()
  const native = await set(false)
  // Asked at preparation, a failure refuses the pass, as the native set's does.
  if (upscale) await compiling
  const twins = new Map<string, Awaited<ReturnType<typeof resolve>> | undefined>()
  const twin = (kind: TaaResolveKind, scaled: boolean, filtered: boolean) => {
    const key = `${kind}${scaled}${filtered}`
    if (!twins.has(key)) {
      twins.set(key, undefined)
      // A twin that fails to compile leaves the resolve it stands for, never an unhandled rejection.
      resolve(kind, scaled, filtered, filtered).then(
        (made) => void twins.set(key, made),
        () => {},
      )
    }
    return twins.get(key)
  }
  const filtered = (kind: TaaResolveKind, scaled: boolean) => twin(kind, scaled, true)
  const unreactive = (kind: TaaResolveKind, scaled: boolean) => twin(kind, scaled, false)
  unreactive('flagless', false)
  unreactive('asIs', false)
  return { ...native, upscaled, filtered, unreactive }
}
