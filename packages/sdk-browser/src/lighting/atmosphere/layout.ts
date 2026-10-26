/**
 * THE ATMOSPHERE'S PLACE IN THE LIGHT BUFFER, AND ITS TABLES' SIZES.
 *
 * Behind the fog, the light buffer (`DirectLights`, `../direct/lightWgsl.ts`) holds three regions, so that every
 * program that already reads the fog reads the air through the very same binding — the opaque
 * resolve, the transparent layers and the reflection trace alike:
 * - the atmosphere's block, written by the CPU when the air or the sun changes
 *   (`packages/sdk-core/src/scene/core/atmospherePack.ts`);
 * - the view's block, written by the GPU each image (`hazeWgsl.ts`, `captureWgsl.ts`): the
 *   view-projection the haze volume is addressed by, then the sky's mean radiance and whether the
 *   volume is valid;
 * - the fog volume's view block (`../fog/viewSlots.ts`), written by the CPU each image the scene's
 *   fog builds a volume: where a surface finds its cell in it;
 * - the haze volume itself: for each cell of a grid over the screen and the distance, the light
 *   the air scatters toward the eye and the transmittance along that ray, four half floats (or four
 *   32-bit floats) —, built every image, read by every surface (`aerialPerspective`), its size
 *   (`AirShape.aerial`) held to the room the buffer has (`AERIAL_CELLS_MAX`);
 * - the transmittance table, published for the programs that light a surface through the air
 *   (`airTint`, `airTintWgsl.ts`), after the haze volume.
 * The tables the sky is drawn from, and their sizes, are the quality settings' (`shape.ts`): how finely
 * each is sampled is what makes the air cheap enough for every image.
 */
import { MAX_10_BIT_FLOAT } from '../../../../math/src/constants.ts'
import { ATMOSPHERE_SLOTS } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts'
import { FOG_SLOTS } from '../../../../sdk-core/src/scene/core/fog.ts'
import { SCENE_LIGHT_HEADER_FLOATS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { FOG_VIEW_SLOTS } from '../fog/viewSlots.ts'
import { LOCAL_FOG_SLOTS } from '../fog/localLayout.ts'
import { AERIAL_CELLS_MAX } from './shape.ts'

/** The cells of the haze volume the light buffer holds room for, four half floats each
 *  (`shape.ts`): the volume asked for is made to fit. */
const AERIAL_TEXELS = AERIAL_CELLS_MAX

/** The transmittance table as the programs that light the surfaces read it, a copy kept in the
 *  light buffer (`airTintWgsl.ts`): texels across and down, the table resampled when its own size
 *  is another. */
export const PUBLISHED_TRANSMITTANCE = { width: 256, height: 64 } as const
const TINT_TEXELS = PUBLISHED_TRANSMITTANCE.width * PUBLISHED_TRANSMITTANCE.height

/** Bytes of a cell: four half floats. */
const AERIAL_TEXEL_BYTES = 8
/** `vec4` slots of the view's block: four columns of the view-projection, then the haze's head and
 *  an orthographic view's direction. */
const ATMOSPHERE_VIEW_SLOTS = 8
/** `vec4` slots before the fog: the header, the environment's coefficients (the fog, then the sky's
 *  block follow, up to the atmosphere's: `LIGHT_BUFFER_AT`, `frame/backend/state/lightBuffer.ts`,
 *  reads the same floats). */
const LIGHT_LEAD_SLOTS = SCENE_LIGHT_HEADER_FLOATS / 4 + ENVIRONMENT_COEFFICIENTS

/** The slots of the view's block. */
export const VIEW_SLOT = {
  /** The first column of the view-projection (the four follow). */
  projection: 0,
  /** The sky's mean radiance, then 1 while the haze volume was built for the image of a perspective
   *  view, 2 for that of an orthographic one (`ortho`), 0 before it is built. */
  haze: 4,
  /** The haze volume's cells across the screen and down it, its slices and its length in
   *  kilometres: what a surface reads it by, written with the volume. */
  volume: 5,
  /** Whether a cell holds four 32-bit floats and not four half floats, then whether a surface
   *  nearer than the haze's start skips the read. */
  flags: 6,
  /** An orthographic view's direction (unit, `xyz`) and the offset of its near plane along it (`w`,
   *  metres): a point's distance along every pixel's ray, from the near plane, is its dot with the
   *  direction less the offset. Zero for a perspective view. */
  ortho: 7,
} as const

/** Bytes of the three regions the atmosphere adds to the light buffer, in order. */
const ATMOSPHERE_BYTES = ATMOSPHERE_SLOTS * 16
const ATMOSPHERE_VIEW_BYTES = ATMOSPHERE_VIEW_SLOTS * 16
const FOG_VIEW_BYTES = FOG_VIEW_SLOTS * 16
const LOCAL_FOG_BYTES = LOCAL_FOG_SLOTS * 16
/** Where the fog volume's view block starts, in bytes from the atmosphere's block. */
export const FOG_VIEW_REGION_AT = ATMOSPHERE_BYTES + ATMOSPHERE_VIEW_BYTES
const AERIAL_BYTES = AERIAL_TEXELS * AERIAL_TEXEL_BYTES
/** A texel of the published transmittance: its three channels, as the table stores them, in half floats. */
const TINT_BYTES = TINT_TEXELS * 8
/** Where the local fog volumes' block starts, in bytes from the atmosphere's block: behind the
 *  published transmittance, the last region before the rectangles' lobe. */
export const LOCAL_FOG_REGION_AT =
  ATMOSPHERE_BYTES + ATMOSPHERE_VIEW_BYTES + FOG_VIEW_BYTES + AERIAL_BYTES + TINT_BYTES
/** What the atmosphere adds to the light buffer, behind the sky's block. */
export const ATMOSPHERE_REGION_BYTES = LOCAL_FOG_REGION_AT + LOCAL_FOG_BYTES

/** The members of the light buffer from the fog to the published transmittance (the fog volume's view block among them), which `DirectLights`
 *  (`../direct/lightWgsl.ts`) and the atmosphere's own programs' `AirBuffer` declare by one text. */
export const LIGHT_AIR_MEMBERS = `fog:array<vec4f,${FOG_SLOTS}>,atmosphere:array<vec4f,${ATMOSPHERE_SLOTS}>,atmosphereView:array<vec4f,${ATMOSPHERE_VIEW_SLOTS}>,fogView:array<vec4f,${FOG_VIEW_SLOTS}>,aerial:array<vec2u,${AERIAL_TEXELS}>,tint:array<vec2u,${TINT_TEXELS}>,localFog:array<vec4f,${LOCAL_FOG_SLOTS}>,`

/** The light buffer's front as the atmosphere's own programs declare it: the same bytes as
 *  `DirectLights` up to the published transmittance, nothing of the lights themselves, and the same names
 *  where a member is read, so that the fog's and the haze's reads (`../fogShader.ts`) run on it. */
export const AIR_BUFFER_STRUCT = `struct AirBuffer{lead:array<vec4f,${LIGHT_LEAD_SLOTS}>,${LIGHT_AIR_MEMBERS}}`

/** The sky's mean radiance at altitude, for the fog: directions marched, samples each (the
 *  altitude is a setting: `shape.ts`). */
export const DISTANT_SKY = { directions: 64, samples: 10 } as const
/** How far over the planet's ground an eye is held, kilometres (5 m): the sky is seen from the
 *  surface, never from inside the planet. The view's eye (`writeAirFrame`) and the place the sky
 *  light captures its sky from (`writeCapture`, `sceneToPlanet`) are held to it alike. */
export const EYE_FLOOR = 0.005

/** The most radiance a sky pass writes, per channel: half the largest value of the 10-bit float
 *  (64512), so that room is left for what is added after it — the clouds, the bloom, the effects.
 *  The sky of the view and the sky of the sky light's capture are held to it alike; the 10-bit
 *  float's own largest value bounds the light of a surface's emission, not the sky. */
export const SKY_MAX_RADIANCE = MAX_10_BIT_FLOAT * 0.5
