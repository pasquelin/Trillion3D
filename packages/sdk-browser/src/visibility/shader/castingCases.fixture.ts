import { NO_DISTANCE_FIELD_ROOT, SHADOW_MAPLESS_ROOT, SHADOWLESS_ROOT } from './castingMark.ts'

/** The ways a mesh leaves the shadows that the placement tests follow (`follow.test.ts`, `posesComposedFlags.test.ts`): the flag set, its
 *  value, the root bit it marks (`nodeCasting`), and whether the mesh is one of the primitives of a model, another of which casts. */
export const CASTING_CASES = [
  { flag: 'castShadow', on: false, bit: SHADOWLESS_ROOT, grouped: false },
  { flag: 'affectDistanceFieldLighting', on: false, bit: NO_DISTANCE_FIELD_ROOT, grouped: false },
  // A mesh of one primitive that leaves the shadow maps casts into none at all: its root is shadowless.
  { flag: 'castsShadowMaps', on: false, bit: SHADOWLESS_ROOT, grouped: false },
  // A primitive of a mesh of several, another of which casts into the maps: only its surface leaves them.
  { flag: 'castsShadowMaps', on: false, bit: SHADOW_MAPLESS_ROOT, grouped: true },
] as const

/** The end of a casting case's title. */
export const castingTitleSuffix = (grouped: boolean) =>
  grouped ? ', among the primitives of one mesh' : ''
