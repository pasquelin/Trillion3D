/**
 * THE ATMOSPHERE'S PLACE IN THE LIGHT BUFFER, AND ITS TABLES' SIZES.
 *
 * Behind the fog, the light buffer (`DirectLights`, `../direct/lightWgsl.ts`) holds the sky's block
 * (`packages/sdk-core/src/scene/core/environmentSky.ts`), then three more regions, so that every
 * program that already reads the fog reads the air through the very same binding — the opaque
 * resolve, the transparent layers and the reflection trace alike:
 * - the atmosphere's block, written by the CPU when the air or the sun changes
 *   (`packages/sdk-core/src/scene/core/atmospherePack.ts`);
 * - the view's block, written by the GPU each image (`hazeWgsl.ts`, `captureWgsl.ts`): the
 *   view-projection the haze volume is addressed by, then the sky's mean radiance and whether the
 *   volume is valid;
 * - the haze volume itself: for each cell of a grid over the screen and the distance, the light
 *   the air scatters toward the eye and the transmittance along that ray, two half floats each —
 *   built every image, read by every surface (`aerialPerspective`);
 * - the sky's radiance by direction, behind the haze: a table over the sky above the horizon, in
 *   the scene's own axes, that a ray leaving the scene reads — a bounce probe's, a reflection's
 *   (`skyRadiance`, `skyRaysWgsl.ts`) — built when the sun or the air changes, not per image.
 * The tables the sky is drawn from, and their sizes, are the other half of this file: how finely
 * each is sampled is what makes the air cheap enough for every image.
 */
import { ATMOSPHERE_SLOTS } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../../../../sdk-core/src/scene/core/environment.ts'
import { SKY_SLOTS } from '../../../../sdk-core/src/scene/core/environmentSky.ts'
import { FOG_SLOTS } from '../../../../sdk-core/src/scene/core/fog.ts'
import { SCENE_LIGHT_HEADER_FLOATS } from '../../../../sdk-core/src/scene/light/contracts.ts'

/** The haze volume: cells across and down the screen, slices along the distance, the distance the
 *  slices reach, kilometres — past it the last slice is read —, and the samples marched per slice
 *  (the slice's own count grows with its depth). */
export const AERIAL_VOLUME = {
  width: 32,
  height: 32,
  slices: 16,
  depthKm: 96,
  samplesPerSlice: 2,
} as const

/** The sky seen by direction, from the ground: texels around the horizon (the azimuth) and up it (the
 *  elevation, spread by its square root so the horizon, where the sky changes fastest, has the
 *  most). The same marching as the sky's capture, for a thousand times the directions. */
export const SKY_RAYS = { azimuth: 128, elevation: 64, altitudeKm: 0.001 } as const
/** Texels of the sky table. */
export const SKY_RAYS_TEXELS = SKY_RAYS.azimuth * SKY_RAYS.elevation

/** Cells of the haze volume. */
export const AERIAL_TEXELS = AERIAL_VOLUME.width * AERIAL_VOLUME.height * AERIAL_VOLUME.slices
/** Bytes of a cell: four half floats. */
const AERIAL_TEXEL_BYTES = 8
/** `vec4` slots of the view's block: four columns of the view-projection, then the haze's head. */
export const ATMOSPHERE_VIEW_SLOTS = 8
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
} as const

/** Bytes of the three regions the atmosphere adds to the light buffer, in order. */
const ATMOSPHERE_BYTES = ATMOSPHERE_SLOTS * 16
const ATMOSPHERE_VIEW_BYTES = ATMOSPHERE_VIEW_SLOTS * 16
const AERIAL_BYTES = AERIAL_TEXELS * AERIAL_TEXEL_BYTES
/** A texel of the sky table: the radiance in three half floats and a spare. */
const SKY_RAYS_BYTES = SKY_RAYS_TEXELS * 8
/** What the atmosphere adds to the light buffer, behind the sky's block. */
export const ATMOSPHERE_REGION_BYTES =
  ATMOSPHERE_BYTES + ATMOSPHERE_VIEW_BYTES + AERIAL_BYTES + SKY_RAYS_BYTES

/** The light buffer's front as the atmosphere's own programs declare it: the same bytes as
 *  `DirectLights` up to the sky by direction, nothing of the lights themselves, and the same names
 *  where a member is read, so that the fog's and the haze's reads (`../fogShader.ts`) run on it. */
export const AIR_BUFFER_STRUCT = `struct AirBuffer{lead:array<vec4f,${LIGHT_LEAD_SLOTS}>,fog:array<vec4f,${FOG_SLOTS}>,sky:array<vec4f,${SKY_SLOTS}>,atmosphere:array<vec4f,${ATMOSPHERE_SLOTS}>,atmosphereView:array<vec4f,${ATMOSPHERE_VIEW_SLOTS}>,aerial:array<vec2u,${AERIAL_TEXELS}>,skyRays:array<vec2u,${SKY_RAYS_TEXELS}>,}`

/** The tables the sky and the haze are drawn from, as the marching builds them: size and samples. */
export const TRANSMITTANCE_LUT = { width: 256, height: 64, samples: 10 } as const
export const MULTISCATTERING_LUT = { width: 32, height: 32, samples: 15 } as const
/** The sky seen from the eye, around it: its samples grow with the distance marched, up to
 *  `maxSamples` from `distanceKm` on. */
export const SKY_VIEW_LUT = {
  width: 192,
  height: 104,
  minSamples: 4,
  maxSamples: 32,
  distanceKm: 150,
} as const
/** The sky's mean radiance at altitude, for the fog: directions marched, samples each. */
export const DISTANT_SKY = { directions: 64, samples: 10, altitudeKm: 6 } as const
/** The sky captured for the sky light: directions over the upper hemisphere, the eye's height. */
export const SKY_CAPTURE = { directions: 1024, threads: 64, altitudeKm: 0.001 } as const
