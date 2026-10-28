import type { CapsuleShadowField } from '../contracts/capsuleShadowOptions.ts'

/** What the view's capsule shadow settings mean (`../contracts/capsuleShadowOptions.ts`). */
export const CAPSULE_SHADOW_MEANINGS: Readonly<Record<CapsuleShadowField, string>> = {
  capsuleShadows:
    'Whether objects cast capsule shadows (true, the default): soft shadows from spheres and capsules fitted to the bones of a skinned object, on the scene around it, from the lights and from the sky and indirect light. Only an object that carries capsules and sets castCapsuleDirectShadow or castCapsuleIndirectShadow casts them. False casts none of either kind.',
  capsuleDirectShadows:
    "Whether the lights' capsule shadows are cast (true, the default), by the objects that set castCapsuleDirectShadow. Needs capsuleShadows.",
  capsuleIndirectShadows:
    'Whether the capsule shadows of the sky and the indirect light are cast (true, the default), by the objects that set castCapsuleIndirectShadow. Needs capsuleShadows.',
  capsuleShadowsFullResolution:
    "Whether the capsule shadows are computed at the image's resolution (true) instead of half of it each way (false, the default): sharper, and four times the pixels.",
  capsuleMaxDirectOcclusionDistance:
    "How far from a capsule, in metres, a light's capsule shadow reaches (4 by default). The cost grows with it.",
  capsuleMaxIndirectOcclusionDistance:
    'How far from a capsule, in metres, the indirect capsule shadow reaches (2 by default). The cost grows with it.',
  capsuleShadowFadeAngleFromVertical:
    'The angle from straight up, in radians (π/3 by default), at which the indirect capsule shadow starts to fade out, so an object does not shadow itself under a light that comes from above.',
  capsuleIndirectConeAngle:
    "The angle, in radians (π/8 by default), of the light source of the indirect capsule shadow where its direction comes from the place's indirect light.",
  capsuleSkyAngleScale:
    "The factor (0.6 by default) on the angle of the indirect capsule shadow where its direction comes from the sky's unoccluded direction.",
  capsuleMinSkyAngle:
    "The least angle, in degrees (15 by default), of the indirect capsule shadow where its direction comes from the sky's unoccluded direction.",
  capsuleIndirectSelfShadowingIntensity:
    'How much of the indirect capsule shadow the surface of an object that casts it keeps (0.8 by default, from 0 to 1): below 1, an object shadows its own surface less than the rest of the scene.',
}
