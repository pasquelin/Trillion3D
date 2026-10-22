import type { SkyLightPart } from '../../../../sdk-core/src/modules/sky/skyLight.ts'

/** The sky light each runtime holds, written where it is set (`setSkyLightSource`) and read by whoever needs only the
 *  light's settings — the distance fields' update, the occlusion's gate —: a leaf, so that none of them reaches the
 *  sky light's capture to read it. */
const held = new WeakMap<object, SkyLightPart>()

/** The sky light `rt` holds, none where it has no light. */
export const heldSkyLight = (rt: object) => held.get(rt)

/** `rt` holds `part` from now on, or no light (`undefined`). */
export function holdSkyLight(rt: object, part: SkyLightPart | undefined) {
  if (part) held.set(rt, part)
  else held.delete(rt)
}
