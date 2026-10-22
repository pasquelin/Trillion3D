import {
  AMBIENT_OCCLUSION_PRESET_LEVELS,
  type AmbientOcclusionField,
} from '../contracts/ambientOcclusionOptions.ts'

/** What the quality levels write of `field`, by the table the runtime reads (`AMBIENT_OCCLUSION_PRESET_LEVELS`). */
const written = (field: keyof (typeof AMBIENT_OCCLUSION_PRESET_LEVELS)['smooth']) =>
  Object.entries(AMBIENT_OCCLUSION_PRESET_LEVELS)
    .map(([level, values]) => `${String(values[field])} at '${level}'`)
    .join(', ')

/** What each setting of the screen-space ambient occlusion means (`../contracts/ambientOcclusionOptions.ts`);
 *  it applies to the lit image where no screen probes light the pixels. The defaults and the ranges are the
 *  schema's own. */
export const AMBIENT_OCCLUSION_MEANINGS: Readonly<Record<AmbientOcclusionField, string>> = {
  ambientOcclusion:
    "The master switch of the screen-space ambient occlusion: the contact shadow a crease, a corner or the foot of a wall casts on the light that comes from all round, found in the depth the image drew. It darkens a surface's emission and the sky light's diffuse, never a declared light, and only where no screen probes light the pixels (they carry their own short-range occlusion). false draws none.",
  ambientOcclusionIntensity:
    'How much of the occlusion shows, from 0 (none: off) to 1 (all of it).',
  ambientOcclusionStaticFraction:
    "The share of what the base pass left in the picture — a surface's emission — that the occlusion darkens, from 0 to 1.",
  ambientOcclusionRadius:
    'How far from a point, in metres, a surface may be and occlude it. By default it is the radius at 4 m from the eye and grows with the distance, so that its share of the image holds; with ambientOcclusionRadiusInWorldSpace it is the radius in the world at any distance.',
  ambientOcclusionRadiusInWorldSpace:
    "Whether the radius is the world's, in metres, rather than the view's, which is the radius at 4 m from the eye and grows with the distance.",
  ambientOcclusionFadeDistance:
    'The distance from the eye, in metres, where the occlusion has faded to nothing, so that far surfaces take none.',
  ambientOcclusionFadeRadius:
    'How many metres before ambientOcclusionFadeDistance the occlusion starts to fade.',
  ambientOcclusionPower:
    'The exponent the occlusion is raised to: more makes the occluded corners darker and the rest lighter.',
  ambientOcclusionBias:
    'How far a point is lifted off its surface along its normal before the search, in thousandths of its depth: more avoids self-occlusion on slopes and shows less of a crease.',
  ambientOcclusionQuality: `The quality the search runs at, from 0 to 100: it picks how many resolutions the search runs at (1 below 35, 2 below 70, 3 over) and how many samples a pixel takes. The ceiling ambientOcclusionMaxQuality holds it down, ambientOcclusionLevels sets the resolutions itself.`,
  ambientOcclusionMipBlend:
    'How much of the coarser resolution is blended into the finer one, from 0.1 to 1.',
  ambientOcclusionMipScale:
    'How the radius grows over each coarser resolution, a factor of at least 0.5; larger spreads the occlusion wider at the coarser levels.',
  ambientOcclusionMipThreshold:
    "The depth step, per centimetre and over the resolution, under which the neighbours that the coarser levels' setup halves count as one surface.",
  ambientOcclusionLevels: `The resolutions the search runs at: 1 to 3, 0 none (no occlusion); -1 follows the quality. The quality levels write ${written('ambientOcclusionLevels')}.`,
  ambientOcclusionMaxQuality: `A ceiling on the quality, from 0 to 100; 100 holds none, and a negative value forces the quality its absolute value names. The quality levels write ${written('ambientOcclusionMaxQuality')}.`,
  ambientOcclusionMipLevelFactor: `How fast the samples of the search climb the depth pyramid's coarser levels along the search; 0 reads the finest level only, and 1 or less never leaves it. The quality levels write ${written('ambientOcclusionMipLevelFactor')}.`,
  ambientOcclusionRadiusScale: `A scale on the radius, from 0.1 to 15. The quality levels write ${written('ambientOcclusionRadiusScale')}.`,
  ambientOcclusionWithScreenProbes:
    "Whether the occlusion is also drawn where screen probes light the pixels, occluding their light: it applies only when the probes' own short-range occlusion (screenProbeShortRangeOcclusion) is off; false by default, the probes' occlusion alone is used.",
}
