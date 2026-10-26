import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * WHAT THE AIR'S PROGRAMS KNOW OF AN IMAGE: where the eye stands on the planet and how it is
 * turned, and the camera's matrices — one uniform, written each image (`writeAirFrame`).
 *
 * The planet's ground is the scene's plane `y = groundHeight`; the planet is a sphere under it,
 * its top at `groundPosition` on that plane, lengths in kilometres. The eye is lifted onto the
 * ground if it dips below, so that the sky is always seen; above the air it stays where it is, and
 * the planet and its air are seen from outside (the programs march a ray that starts above the air
 * from its top, `moveToTopAtmosphere`). The sky is drawn from a table around the eye in its own
 * frame, whose up is the planet's at the eye and whose forward is the camera's, turned to be across
 * the up: `forward`, `left` and `up` are the table's three axes in the scene. `hidden.x` is 1 for the
 * image of a view the air is not drawn in (the atmosphere's `inMainView` off), 0 otherwise; `hidden.y`
 * is 1 where the atmosphere holds its light out (`SceneAtmosphere.holdout`, with the alpha holdout on).
 */
export const FRAME_LAYOUT = fieldLayout('AirFrame', [
  ['inverseViewProj', 'mat4x4f'],
  ['viewProj', 'mat4x4f'],
  ['camera', 'vec4f'],
  ['forward', 'vec4f'],
  ['left', 'vec4f'],
  ['up', 'vec4f'],
  ['eye', 'vec4f'],
  ['lift', 'vec4f'],
  ['size', 'vec4f'],
  ['capture', 'vec4f'],
  ['preExposure', 'vec4f'],
  ['index', 'vec4u'],
  ['hidden', 'vec4f'],
] as const)
