import { DEG2RAD } from '../../../../math/src/constants.ts'
import { SHADOW_PAGE } from './shadow/sunEntries.ts'
import type { SceneLightCloudShadow } from './lightCloudShadowFields.ts'
/** The indices of the air's lights: two are held, a sun and a moon, or two suns. */
export const ATMOSPHERE_SUN_INDICES = [0, 1] as const
/** The index of one of the air's lights. */
export type AtmosphereSunIndex = (typeof ATMOSPHERE_SUN_INDICES)[number]
/**
 * A scene light, version 2. Units are radiometric and linear (P1): `color` is a linear colour and
 * `intensity` a strictly positive radiometric intensity — a radiance for a `rect`. Four kinds,
 * and nothing else makes light in this engine (P6):
 * - `point`: a position and a range in metres beyond which it lights nothing;
 * - `spot`: the same plus a direction and a cone half-angle in radians;
 * - `directional`: the sun or an overcast sky — a propagation direction, no position and
 *   no range, the same irradiance everywhere, and clipmap shadows that follow the camera;
 * - `rect`: a one-sided rectangle of `size` metres centred on `position`, emitting along
 *   `direction`, its width along `right`; no cast shadow (`packages/sdk-browser/src/lighting/direct/rectLightWgsl.ts`).
 *
 * Fields a kind does not use are rejected at validation: a directional light with
 * a position would be a promise the engine would not keep.
 */
export interface SceneLight extends SceneLightCloudShadow {
  /** The light's name. */ id: string
  /** Point, spot, sun or rectangle. */ kind: 'point' | 'spot' | 'directional' | 'rect'
  /** Point and spot only: the point the light comes from, in metres. */
  position?: [number, number, number]
  /** Spot: the cone axis. Directional: the propagation direction (from the sun toward the
   *  ground). Rect: the normal of its emitting face. */
  direction?: [number, number, number]
  /** Its colour, linear RGB. */ color: [number, number, number]
  /** How strong it is. */ intensity: number
  /** Point, spot and rect: the range in metres, where energy vanishes exactly. */
  range?: number
  /** A spot's opening. */ coneAngle?: number
  /** Spot only: the share of the cone, from its edge inward, over which the light fades in
   *  `[0, 1]`; without it the edge softens over `spotEdgeSoftness`. */
  penumbra?: number
  /**
   * Point and spot only: the radius, in metres, of the envelope that holds the source.
   * A real light is always housed in something — lantern glass, reflector, shade
   * — and that envelope is geometry like any other: without this field, it enters its own
   * light's shadow map and turns it off. Fragments within this sphere do not cast a shadow;
   * the map's near plane continues to depend on range. This radius is also the source's: it sets
   * the source size of the contact-hardening shadow filter, and the lamp lights a surface as a
   * sphere of that radius (`emitterLength` for a tube): the horizon wraps the light, a highlight
   * spreads. It is a
   * property of the light, never an object name or a material type: the engine only knows
   * surfaces. Strictly positive and strictly less than the range; if absent, nothing changes.
   */
  emitterRadius?: number
  /** Point and spot only: the length, in metres, of the tube the source is (a capsule with its
   *  `emitterRadius`), centred on the light, along `emitterAxis`; absent, a sphere or a point.
   *  Strictly positive. */
  emitterLength?: number
  /** Point and spot only: the soft radius, in metres, that widens the highlight a source leaves
   *  without lighting more of the surface; strictly positive and strictly less than the range;
   *  absent, none. */
  emitterSoftRadius?: number
  /** Point and spot only, with an `emitterLength`: the unit direction the tube lies along (a
   *  light's own up, `[0, 1, 0]` unless given); refused without a length. */
  emitterAxis?: [number, number, number]
  /** Directional only: source disk angular radius in radians; absent is an ideal point source. */
  angularRadius?: number
  /** Directional only: how far from the eye, in metres, its shadow maps take every caster; past it
   *  a caster that does not cast far shadows is left out (`shadowOptions.ts`); 0 none; absent, 400. */
  shadowDistance?: number
  /** Directional only: whether the light is a candidate to light the atmosphere (`SceneAtmosphere`);
   *  absent, it is. Of the candidates the brightest is the atmosphere's sun: its light reaches
   *  surfaces through the air, and the sky is drawn from it; the fog scatters it as well, with an
   *  atmosphere or none. */
  atmosphereSun?: boolean
  /** Directional only: which of the air's two suns the light is a candidate for, 0 or 1 (a sun and
   *  a moon, or two suns); absent, 0. One light is held for each index, the brightest of the
   *  candidates of that index; the sky, the haze and the sky light take both, the fog scatters the
   *  one of index 0. */
  atmosphereSunIndex?: AtmosphereSunIndex
  /** Rect only: the unit axis its width runs along, perpendicular to `direction`. */
  right?: [number, number, number]
  /** Rect only: its width and height, in metres. */
  size?: [number, number]
  /** Whether it casts shadows. */ castsShadow: boolean
  /** How much of its light the volumetric fog (`SceneFog.volumetric`) and the clouds scatter:
   *  a factor on its colour there, `0` leaving it out of both; absent, `1`. It does not change
   *  the light on surfaces. */
  fogScattering?: number
  /** Whether its shadow also shadows the volumetric fog, where it casts a shadow: absent, a
   *  directional light does and a point, spot or rect does not. */
  shadowsFog?: boolean
  /** Whether its colour is multiplied by the colour of a black body at `temperatureKelvin`
   *  (`modules/sky/sunColour.ts`): the light's colour then follows its temperature; absent, off. */
  useTemperature?: boolean
  /** The temperature, in kelvin, of the black body `useTemperature` takes the colour of; read no
   *  lower than 1000 and no higher than 15000; absent, 6500 (the white of the working space). */
  temperatureKelvin?: number
  /** Directional only: a colour its disk in the sky is multiplied by, linear, three numbers of at
   *  least 0 (the sun's disk alone, never the light it gives); absent, white. */
  sunDiskTint?: [number, number, number]
  /** Directional only: whether its shadows also shade the air — the haze and the sky's march read
   *  the light's shadow along their rays, so that a mountain's shadow reaches into the haze;
   *  absent, off. It takes the air's `atmosphereSampleLightShadowMap` setting on as well. */
  shadowsAir?: boolean
  /** Directional only: whether the transmittance of the air toward the light is read for each
   *  surface point, not once at the ground under the eye: a sun low over a mountain range
   *  reddens its valley and not its summit; absent, off. */
  transmittancePerPixel?: boolean
  /** The id of the light function material (`lightFunctionIdOf`, `world/material/lightFunctionMaterial.ts`) the light's colour is
   *  multiplied by, at each point it lights, by what the material gives there; absent, none. */
  lightFunction?: string
  /** Beside a `lightFunction`: its scale in metres a tile, `[up, right, along the light]`; absent,
   *  10.24 on each (`LIGHT_FUNCTION_DEFAULTS`). */
  lightFunctionScale?: [number, number, number]
  /** Beside a `lightFunction`: the distance in metres from the eye past which the light function
   *  has faded to the disabled brightness over a fifth of it; absent, 1000. */
  lightFunctionFadeDistance?: number
  /** Beside a `lightFunction`: the brightness of the light where its light function is faded out;
   *  absent, 0.5. */
  lightFunctionDisabledBrightness?: number
  /** Rect only, beside a `lightFunction`: the half-angle in degrees of the cone its light function
   *  is projected through, at most 89; absent or 0, the function is laid flat on the face's plane. */
  lightFunctionConeAngle?: number
  /** Directional only: whether the light darkens the fog's and the air's inscattering where
   *  something near the eye hides its direction (the light shafts' occlusion); absent, off. */
  shaftOcclusion?: boolean
  /** Directional only, with the occlusion: what an occlusion of 0 maps to, 1 darkening nothing;
   *  absent, 0.05. */
  shaftOcclusionDarkness?: number
  /** Directional only, with the occlusion: everything closer to the eye than this distance, in
   *  metres, occludes the shafts; absent, 1000. */
  shaftOcclusionDepthRange?: number
  /** Directional only: the direction, three numbers not all 0, the shafts come from instead of the
   *  light's own, normalised where it is used; absent, the light's own. */
  shaftOverrideDirection?: [number, number, number]
  /** Whether the light blurs the bright colour of the image away from itself and adds it back (the
   *  light shafts' bloom), for a directional light; absent, off. */
  shaftBloom?: boolean
  /** With the bloom: the factor on the colour added; absent, 0.2. */
  shaftBloomScale?: number
  /** With the bloom: the brightness the image must pass, after exposure, to bloom; absent, 0. */
  shaftBloomThreshold?: number
  /** With the bloom: a brightness above it, after exposure, is brought down to it; absent, 100. */
  shaftBloomMaxBrightness?: number
  /** With the bloom: the factor on the bloom's colour, linear, three numbers of at least 0;
   *  absent, white. */
  shaftBloomTint?: [number, number, number]
}
/** Exposure, display curve and the irradiance from every direction (`../core/environment.ts`). */
/** The version of the light contract this engine reads. */ export const SCENE_LIGHT_VERSION = 2
/**
 * What the host asks to see. `lit` is real lighting and that alone; `unlit` is the raw-albedo
 * diagnostic view — material colour as-is, with no light, no ambient and
 * no emission — for geometry benches that compare images pixel-exact. `auto`, the
 * default, yields `unlit` as long as no light is declared and `lit` as soon as there is one.
 *
 * `bounce` is the third diagnostic view: indirect irradiance alone, multiplied by
 * exposure and output as linear values without ACES or sRGB. This is what the harness compares to
 * the compiler oracle; it is not an image to look at, and it is black without a rigged bounce.
 */
export type SceneLightingView = 'auto' | 'lit' | 'unlit' | 'bounce'
/**
 * Published settings of direct lighting. These are named product choices, not buried
 * constants: every runtime bound rereads them, and the diagnostic publishes them as-is.
 */
export const LIGHT_SETTINGS = {
  /** Angular radius of the solar disk in radians; zero explicitly requests hard shadows. */
  sunAngularRadius: (0.5357 * DEG2RAD) / 2,
  /**
   * The longest list of a cell of the light grid a MOVING image draws from (X2): past it, the
   * cell's lights are summed in full. A scene of at most this many lights resolves with a light
   * array that long. A cell's list holds every light that reaches it, however many, in a pool the
   * size of the view; a cell the pool has no room for walks every light of the scene — those that
   * miss it add an exact zero —, so no light is ever dropped.
   */
  tileLights: 64,
  /** Side in pixels of a cell of the light grid. */
  tileSize: 64,
  /** Depth slices of the light grid: past the last, a cell reaches to infinity. */
  gridSlices: 256,
  /** Slices of the light grid to a doubling of the view depth, from the near plane. */
  gridSlicesPerOctave: 16,
  /**
   * Side of a shadow page, in texels: the unit of the physical pool, of the virtual maps and of
   * invalidation. A moving object only stales the pages its projected box covers.
   */
  shadowPage: SHADOW_PAGE,
  /** Side of a lamp face's finest mip, in texels: 32 × 32 pages of 128 (pool: `shadowPoolSize`). */
  lampFaceSize: 4096,
  /** Virtual pages the shading may request per frame at least, as many as the pool holds past it;
   *  the rest ask again the next frame. */
  shadowRequestCap: 4096,
  /** Width of the softened edge of a spot cone, in cosine units: against staircasing. */
  spotEdgeSoftness: 0.02,
  /** The squared distance, in square metres, added to a lamp's squared distance in its inverse
   *  square: 1 square centimetre, so that the light stays finite at the lamp. */
  lampDistanceBias: 1e-4,
  /**
   * Clipmap levels of a directional light. Level `L` has texels of `2^L` metres, and a pixel
   * reads the level whose texel is at most its own footprint: sixteen levels cover a far/near
   * ratio of 2^15.
   */
  sunLevels: 16,
  /**
   * Pages per side of a clipmap level's extent around the camera. It is a capacity, not a
   * tuning: every pixel reads its own density while `height / tan(halfFovY)` stays within
   * `sunLevelPages · shadowPage / 2` = 4096 (a 4K canvas at a 55° vertical field); beyond, the
   * outer pixels read the next level, at half the density.
   */
  sunLevelPages: 64,
  /** Near plane of a slice: a fraction of the range, never less than this floor. */
  shadowNearFraction: 1 / 200,
  /** Nearest shadow distance. */ shadowNearMin: 0.05,
  /**
   * Offset of the sample point along the normal, in texels of the map read: half a texel, the
   * margin for what is not the receiver's plane — its curvature within a texel, the rounding of
   * both depths. The receiver's slope is covered by a depth margin over the PCF's reach, and
   * past 45° by a further offset, in the same texels (`shadowDepthMargin`, `shadowNormalTexels`):
   * no bias is a length of the scene.
   */
  shadowNormalOffsetTexels: 0.5,
  /**
   * How a translucent surface reads a light's shadow: 0, the default and the cheaper, one sample
   * of the light's map (`vsmSampleLight`); 1, the receiver's full trace the opaque projection runs, the translucent
   * casters' colour along its rays included (`vsmTraceFactor`).
   */
  translucentShadowQuality: 0 as 0 | 1,
  /** Whether a local light's shadow reaches a translucent surface, default off to spare each
   *  translucent pixel a shadow lookup per local light: off, a shadowed local light lights it
   *  unshadowed. */
  translucentLocalShadows: false as boolean,
} as const
/**
 * Shadow slices the atlas addresses, under the page table's own rules — never a limit on
 * the lights: a shadow-casting light beyond them lights without a shadow, and the frame counts it
 * (`shadowCastersUnsliced`).
 */
export const MAX_SHADOW_SLICES = 64

/** Faces of a point light's slice: six. */
export const POINT_FACES = 6
/** Floats of a light in the GPU buffer: six `vec4f`. */
export const SCENE_LIGHT_FLOATS = 24
/** Light-buffer header: count, then three reserved words. */
export const SCENE_LIGHT_HEADER_FLOATS = 4
/** Rank of a light kind in the GPU buffer: the shader refers to it by this number, not by name.
 *  @property point - A bulb. @property spot - A torch. @property directional - The sun.
 *  @property rect - A glowing rectangle. */
export const LIGHT_KIND = { point: 0, spot: 1, directional: 2, rect: 3 } as const
/** The kind word's rank is under this; the flags are the bits above it. */
export const LIGHT_KIND_SPAN = 4
/** The flags a light's kind word carries above its rank (`LIGHT_KIND`): each one bit, its value
 *  added to the rank. @property castsShadow - The light casts shadows. @property shadowsFog - Its
 *  shadow also shadows the volumetric fog. */
export const LIGHT_FLAG = { castsShadow: LIGHT_KIND_SPAN, shadowsFog: 2 * LIGHT_KIND_SPAN } as const
/** The step of a light function table's index in a light's kind word: the word is the rank, plus the
 *  flags (`LIGHT_FLAG`), plus this times the index; 0, no light function. */
export const LIGHT_FUNCTION_STEP = 4 * LIGHT_KIND_SPAN
/** The bits the flags and the rank take below the index: `LIGHT_FUNCTION_STEP` is `1 << this`. */
export const LIGHT_FUNCTION_SHIFT = 4
/** What the scheduler knows of the view: a camera, not a matrix, to stay without a dependency. */
export interface ShadowViewpoint {
  /** Where the viewpoint stands. */ position: readonly [number, number, number]
  /** Which way it looks. */ forward: readonly [number, number, number]
  /** Half its vertical opening. */ halfFovY: number
  /** Width over height. */ aspect: number
  /** Nearest distance. */ near: number
  /** Farthest distance. */ far: number
  /** World size of one pixel at the near plane: the finest footprint any pixel of the view has. */
  pixelNear: number
}
/** The eleven numbers of a view, in order: position, axis, half-field, aspect, near, far, and
 *  the pixel's footprint at the near plane. */
export const VIEW_NUMBERS = 11
export function writeView<T extends Float32Array | Float64Array>(view: ShadowViewpoint, out: T) {
  out.set(view.position)
  out.set(view.forward, 3)
  out[6] = view.halfFovY
  out[7] = view.aspect
  out[8] = view.near
  out[9] = view.far
  out[10] = view.pixelNear
  return out
}
