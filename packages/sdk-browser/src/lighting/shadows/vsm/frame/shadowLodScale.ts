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
 * the main view. The one source of it, and a value the cache follows (`followCacheContent`): pages drawn and pages kept are at
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
