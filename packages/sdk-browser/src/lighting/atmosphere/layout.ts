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
 *   (`airTint`, `airTintWgsl.ts`), after the sky by direction;
 * - the sky's radiance by direction, behind the haze: a table over the sky above the horizon, in
 *   the scene's own axes, that a ray leaving the scene reads — a bounce probe's, a reflection's
 *   (`skyRadiance`, `skyRaysWgsl.ts`) — built when the sun or the air changes, not per image.
 * The tables the sky is drawn from, and their sizes, are the quality settings' (`shape.ts`): how finely
 * each is sampled is what makes the air cheap enough for every image.
 */
import { ATMOSPHERE_SLOTS } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts'
import { FOG_SLOTS } from '../../../../sdk-core/src/scene/core/fog.ts'
import { SCENE_LIGHT_HEADER_FLOATS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { FOG_VIEW_SLOTS } from '../fog/viewSlots.ts'
import { AERIAL_CELLS_MAX } from './shape.ts'

/** The cells of the haze volume the light buffer holds room for, four half floats each
 *  (`shape.ts`): the volume asked for is made to fit. */
const AERIAL_TEXELS = AERIAL_CELLS_MAX

/** The sky seen by direction, from the ground: texels around the horizon (the azimuth) and up it (the
 *  elevation, spread by its square root so the horizon, where the sky changes fastest, has the
 *  most). The same marching as the sky's capture, for a thousand times the directions. */
export const SKY_RAYS = { azimuth: 128, elevation: 64, altitudeKm: 0.001 } as const
/** Texels of the sky table. */
const SKY_RAYS_TEXELS = SKY_RAYS.azimuth * SKY_RAYS.elevation

/** The transmittance table as the programs that light the surfaces read it, a copy kept in the
 *  light buffer (`airTintWgsl.ts`): texels across and down, the table resampled when its own size
 *  is another. */
export const PUBLISHED_TRANSMITTANCE = { width: 256, height: 64 } as const
const TINT_TEXELS = PUBLISHED_TRANSMITTANCE.width * PUBLISHED_TRANSMITTANCE.height

/** Bytes of a cell: four half floats. */
const AERIAL_TEXEL_BYTES = 8
/** `vec4` slots of the view's block: four columns of the view-projection, then the haze's head. */
const ATMOSPHERE_VIEW_SLOTS = 8
/** `vec4` slots before the fog: the header, the environment's coefficients (the fog, then the sky's
 *  block follow, up to the atmosphere's: `LIGHT_BUFFER_AT`, `frame/backend/state/lightBuffer.ts`,
 *  reads the same floats). */
const LIGHT_LEAD_SLOTS = SCENE_LIGHT_HEADER_FLOATS / 4 + ENVIRONMENT_COEFFICIENTS

/** The slots of the view's block. */
export const VIEW_SLOT = {
  /** The first column of the view-projection (the four follow). */
  projection: 0,
  /** The sky's mean radiance, then 1 while the haze volume was built for the image. */
  haze: 4,
  /** The haze volume's cells across the screen and down it, its slices and its length in
   *  kilometres: what a surface reads it by, written with the volume. */
  volume: 5,
  /** Whether a cell holds four 32-bit floats and not four half floats, then whether a surface
   *  nearer than the haze's start skips the read. */
  flags: 6,
} as const

/** Bytes of the three regions the atmosphere adds to the light buffer, in order. */
const ATMOSPHERE_BYTES = ATMOSPHERE_SLOTS * 16
const ATMOSPHERE_VIEW_BYTES = ATMOSPHERE_VIEW_SLOTS * 16
const FOG_VIEW_BYTES = FOG_VIEW_SLOTS * 16
/** Where the fog volume's view block starts, in bytes from the atmosphere's block. */
export const FOG_VIEW_REGION_AT = ATMOSPHERE_BYTES + ATMOSPHERE_VIEW_BYTES
const AERIAL_BYTES = AERIAL_TEXELS * AERIAL_TEXEL_BYTES
/** A texel of the sky table: the radiance in three half floats and a spare. */
const SKY_RAYS_BYTES = SKY_RAYS_TEXELS * 8
/** A texel of the published transmittance: its three channels, as the table stores them, in half floats. */
const TINT_BYTES = TINT_TEXELS * 8
/** What the atmosphere adds to the light buffer, behind the sky's block. */
export const ATMOSPHERE_REGION_BYTES =
  ATMOSPHERE_BYTES +
  ATMOSPHERE_VIEW_BYTES +
  FOG_VIEW_BYTES +
  AERIAL_BYTES +
  SKY_RAYS_BYTES +
  TINT_BYTES

/** The members of the light buffer from the fog to the sky by direction (the fog volume's view block among them), which `DirectLights`
 *  (`../direct/lightWgsl.ts`) and the atmosphere's own programs' `AirBuffer` declare by one text. */
export const LIGHT_AIR_MEMBERS = `fog:array<vec4f,${FOG_SLOTS}>,atmosphere:array<vec4f,${ATMOSPHERE_SLOTS}>,atmosphereView:array<vec4f,${ATMOSPHERE_VIEW_SLOTS}>,fogView:array<vec4f,${FOG_VIEW_SLOTS}>,aerial:array<vec2u,${AERIAL_TEXELS}>,skyRays:array<vec2u,${SKY_RAYS_TEXELS}>,tint:array<vec2u,${TINT_TEXELS}>,`

/** The light buffer's front as the atmosphere's own programs declare it: the same bytes as
 *  `DirectLights` up to the sky by direction, nothing of the lights themselves, and the same names
 *  where a member is read, so that the fog's and the haze's reads (`../fogShader.ts`) run on it. */
export const AIR_BUFFER_STRUCT = `struct AirBuffer{lead:array<vec4f,${LIGHT_LEAD_SLOTS}>,${LIGHT_AIR_MEMBERS}}`

/** The sky's mean radiance at altitude, for the fog: directions marched, samples each (the
 *  altitude is a setting: `shape.ts`). */
export const DISTANT_SKY = { directions: 64, samples: 10 } as const
/** The sky captured for the sky light: directions over the upper hemisphere, the eye's height (the
 *  altitude here is the default of `AirFrame.capture`). */
export const SKY_CAPTURE = { altitudeKm: 0.001 } as const
