import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'

/** What the shadows' level of detail reads of the engine: the shadow settings, and the streaming
 *  quality scale the residency holds (`../../../../geometry/residency/poolPressure.ts`). */
type ShadowLodRuntime = Parameters<typeof readShadowSetting>[0] & {
  readonly services: { readonly residency: { readonly qualityScale: number } }
  /** The image's number, when the runtime has one: the scale is worked out once for it. */
  readonly run?: { readonly frame?: number }
}

/** The streaming quality scale falls by 3% an update under pool pressure (`createPoolPressure`), so it can move every image: the shadows
 *  follow it by steps of half an octave (from 1 down to its floor of a tenth, eight steps), not by each move. */
const QUALITY_STEPS_PER_OCTAVE = 2

/**
 * The scale of the shadow maps' level of detail: two to the minus `shadowGeometryLodBias` (held by the setting to
 * `SHADOW_GEOMETRY_LOD_BIAS_LIMIT` stops, so that the scale and the tolerance over it stay finite, normal f32 values), times the
 * streaming quality scale taken to its nearest step (`QUALITY_STEPS_PER_OCTAVE`) — coarser shadows where residency is under pressure, as
 * the main view. The one source of it, and the one value the cache follows (`followShadowLodScale`): pages drawn and pages kept are at
 * the same scale. The cut's tolerance for the casters' clusters is the image's divided by it (`shadowSelectionPixelError`) and the
 * patches' edge factors are multiplied by it (`vsmShadowTessellation`). Worked out once for an image (its number, `run.frame`) however many of those
 * ask it.
 */
export function shadowLodScale(rt: ShadowLodRuntime) {
  const frame = rt.run?.frame
  const held = frame === undefined ? undefined : scaleOfImage.get(rt)
  if (held && held.frame === frame) return held.scale
  const scale =
    2 ** -readShadowSetting(rt, 'shadowGeometryLodBias') *
    2 **
      (Math.round(Math.log2(rt.services.residency.qualityScale) * QUALITY_STEPS_PER_OCTAVE) /
        QUALITY_STEPS_PER_OCTAVE)
  if (frame !== undefined) scaleOfImage.set(rt, { frame, scale })
  return scale
}
/** The scale worked out for the image last asked, by runtime. */
const scaleOfImage = new WeakMap<object, { frame: number; scale: number }>()

/** The pixels an edge of a casters' cluster may span: the image's tolerance over `shadowLodScale`. */
export const shadowSelectionPixelError = (
  rt: ShadowLodRuntime & { readonly run: { readonly gate: { readonly pixelError: number } } },
) => rt.run.gate.pixelError / shadowLodScale(rt)

/** The scale the shadow cache was last drawn at, by cache. */
const seen = new WeakMap<object, number>()

/**
 * The shadow maps' pages hold the detail drawn at the scale of their frame: when `shadowLodScale` changes (the bias set anew, or the
 * streaming quality crossing a step) the cache is dropped, every light drawn again at the new scale, as a change of a light's key does.
 * Called once a frame, where the casters of the maps are drawn from (`vsmRasterScene`).
 */
export function followShadowLodScale(
  rt: ShadowLodRuntime & {
    readonly lights: {
      readonly vsm?: { readonly state: { readonly cache: { invalidate(): void } } }
    }
  },
) {
  const cache = rt.lights.vsm?.state.cache
  if (!cache) return
  const scale = shadowLodScale(rt),
    before = seen.get(cache)
  seen.set(cache, scale)
  if (before !== undefined && before !== scale) cache.invalidate()
}
