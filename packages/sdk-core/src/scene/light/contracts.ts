import { DEG2RAD } from '../../../../math/src/constants.ts'
import { SHADOW_PAGE } from './shadow/sunEntries.ts'
import type { SceneLightCloudShadow } from './lightCloudShadowFields.ts'
import type { SceneLightLamp } from './lightLampFields.ts'
import type { LightUnits } from './lightUnits.ts'
import type { SceneLightShadow } from './lightShadowFields.ts'
/** The indices of the air's lights: two are held, a sun and a moon, or two suns. */
export const ATMOSPHERE_SUN_INDICES = [0, 1] as const
/** The index of one of the air's lights. */
export type AtmosphereSunIndex = (typeof ATMOSPHERE_SUN_INDICES)[number]
/** The ways a light may move and be lit (`SceneLight.mobility`). */
export const LIGHT_MOBILITY = ['static', 'stationary', 'movable'] as const
export type LightMobility = (typeof LIGHT_MOBILITY)[number]
/** The mobility of a light that names none: every kind's, the reference's actors' default. */
export const DEFAULT_LIGHT_MOBILITY: LightMobility = 'stationary'

/**
 * A scene light, version 4. Units are linear (P1): `color` is a linear colour and `intensity` its
 * strength — lux for a `directional`; for a `point`, a `spot` and a `rect`, a number in its
 * `intensityUnits` (unitless by default, `lightUnits.ts`), which the store turns into the one
 * physical number the GPU holds (`brightnessOf`, `fields.ts`) — with no luminous efficacy: a glTF
 * file's candela is the same number here, and the exposure maps it to the picture. Version 3 named a
 * spot's opening `coneAngle` with a `penumbra` share, and read a lamp that named no unit in
 * candelas. Version 2 read a rect's intensity as its radiance; it is now candelas, a radiance of the candelas over half the
 * face's area (a version-2 radiance `L` is `L / 2` nits). Four kinds, and nothing else makes light
 * in this engine (P6):
 * - `point`: a position and a range in metres beyond which it lights nothing;
 * - `spot`: the same plus a direction and an inner and an outer cone half-angle in radians;
 * - `directional`: the sun or an overcast sky — a propagation direction, no position and
 *   no range, the same irradiance everywhere, and clipmap shadows that follow the camera;
 * - `rect`: a one-sided rectangle of `size` metres centred on `position`, emitting along
 *   `direction`, its width along `right`; it casts a shadow as a point light does, in the cube of
 *   its range, its source radius half its width (`packages/sdk-browser/src/lighting/direct/rectLightWgsl.ts`).
 *
 * Fields a kind does not use are rejected at validation: a directional light with
 * a position would be a promise the engine would not keep.
 */
export interface SceneLight extends SceneLightCloudShadow, SceneLightLamp, SceneLightShadow {
  /** The light's name. */ id: string
  /** Point, spot, sun or rectangle. */ kind: 'point' | 'spot' | 'directional' | 'rect'
  /** Point and spot only: the point the light comes from, in metres. */
  position?: [number, number, number]
  /** Spot: the cone axis. Directional: the propagation direction (from the sun toward the
   *  ground). Rect: the normal of its emitting face. */
  direction?: [number, number, number]
  /** Its colour, linear RGB. */ color: [number, number, number]
  /** How strong it is, in lux for a directional light and in its `intensityUnits` for a point, spot
   *  or rect; at least 0, any finite number in `'ev'` where the unit is read (a rect, or a
   *  point or spot under the inverse square). Absent, 10 lux for a directional light, and for a
   *  lamp 5000 unitless, the light of 8 candelas written in its unit (`defaultIntensityOf`). A lamp
   *  in nits whose unit is read needs a source of some area. */
  intensity?: number
  /** Point, spot and rect only: the unit its `intensity` is written in (`LIGHT_UNITS`); absent,
   *  unitless. */
  intensityUnits?: LightUnits
  /** Point, spot and rect: the range in metres, where energy vanishes exactly. */
  range?: number
  /** Spot only: the half-angle, in radians, of the cone where the light is whole; absent, 0, an
   *  inner cone of nothing: the light is full on the axis. In `[0, π/2)`; held a gap short of the
   *  outer cone (`spotAnglesOf`). */
  innerConeAngle?: number
  /** Spot only: the half-angle, in radians, of the cone where the light fades to nothing, by the
   *  square of a ramp in the cosine from the inner cone; strictly in `(0, π/2)`. */
  outerConeAngle?: number
  /** Directional only: source disk angular radius in radians; absent is an ideal point source. */
  angularRadius?: number
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
  /** Directional only: the light's priority for the one directional light the forward-shaded
   *  surfaces, the translucent ones' cloud shade and the volumetric fog read
   *  (`SceneLightStore.forwardDirectionalSlot`): a whole number of at least 0. The directional light
   *  of the highest priority is chosen; of equal priorities the one whose colour times intensity,
   *  squared, is greatest, the first added of equals; absent, 0. */
  forwardShadingPriority?: number
  /** Rect only: the unit axis its width runs along, perpendicular to `direction`. */
  right?: [number, number, number]
  /** Rect only: its width and height, in metres; a side under 1 cm lights and casts as 1 cm. */
  size?: [number, number]
  /** Whether it casts shadows. */ castsShadow: boolean
  /** How much of its light the volumetric fog (`SceneFog.volumetric`) and the clouds scatter:
   *  a factor on its colour there, `0` leaving it out of both; absent, `1`. It does not change
   *  the light on surfaces. */
  fogScattering?: number
  /** How the light is meant to move and be lit: `static` (baked into the lightmaps, it neither moves nor
   *  changes and casts no dynamic shadow), `stationary` (it does not move, its colour and intensity
   *  may change: its direct light on static surfaces is baked, its dynamic shadows are cast) or
   *  `movable` (fully dynamic); absent, `stationary`, the reference's default of every light kind.
   *  The volumetric lightmap reads it (`mobilityOf`). */
  mobility?: LightMobility
  /** Whether its shadow also shadows the volumetric fog, where it casts a shadow: absent, a
   *  directional light does and a point, spot or rect does not. */
  shadowsFog?: boolean
  /** Whether the light shines through the subsurface-profile surfaces it shadows (their transmission:
   *  the light that crosses the thickness behind the lit side); absent, off. It acts on a `movable`
   *  light that casts a shadow alone (`transmitsOf`). */
  transmission?: boolean
  /** Point, spot and rect only: the factor on the resolution its shadow is given, a number of at
   *  least 0; absent, 1. It acts on whether the light takes a shadow and how it fades
   *  (`shadowFadeResolution`, `shadowResolutionScaleZeroDisables`), 0 taking the shadow away. */
  shadowResolutionScale?: number
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
/** The version of the light contract this engine reads. */ export const SCENE_LIGHT_VERSION = 4
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
export const LIGHT_SETTINGS = /* @__PURE__ */ (() =>
  ({
    /** Angular radius of the solar disk in radians; zero explicitly requests hard shadows. This is the
     *  directional light's own default (a disk of 0.5357 degrees); the sky module's sun part sets the
     *  level's (0.7357 degrees, `modules/sky/sunPart.ts`) on the light it makes, so a light placed alone
     *  and the sky's sun differ here as the component and the level they come from do. */
    sunAngularRadius: (0.5357 * DEG2RAD) / 2,
    /**
     * The longest list of a cell of the light grid a MOVING image draws from (X2): past it, the
     * cell's lights are summed in full. A scene of at most this many lights resolves with a light
     * array that long. A cell's list holds the lights that reach it in a pool of fixed size, its cells
     * times `lightGridMaxCulledLightsPerCell` (`hizOptions.ts`, 32): a column past it keeps the lights
     * it got, in order, and drops the rest, as the reference does.
     */
    tileLights: 64,
    /** Side in pixels of a cell of the light grid. */
    tileSize: 64,
    /** Depth slices of the light grid: the last starts at the farthest light's reach and a cell of it
     *  reaches to infinity. */
    gridSlices: 32,
    /** The grid's distribution of its slices, `slice = log2(depth · B + O) · S` (`lighting/tiles/gridMap.ts`):
     *  `S`, how many slices span a doubling of the depth the first slice's start is offset by. */
    gridDepthDistribution: 4.05,
    /** The least depth, in metres, the grid's last slice starts at, whatever the lights' reach. */
    gridFarFloor: 10,
    /** The most depth, in metres, the grid's last slice starts at: a farther light is listed in it. */
    gridFarMax: 2097.152,
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
    /** The widest half-angle a spot's cone is lit at, in radians (88.9°). */
    spotConeLimit: 88.9 * DEG2RAD,
    /** The least gap, in radians, between a spot's inner and outer cone. */
    spotConeGap: 0.001,
    /** The exponent of a lamp's fall-off by its range alone (`SceneLight.radialExponent`). */
    radialExponent: 8,
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
  }) as const)()
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
/** Light-buffer header: the count, the rank plus one of the forward directional light
 *  (`LIGHT_HEADER_FORWARD`), then two reserved words. */
export const SCENE_LIGHT_HEADER_FLOATS = 4
/** The header word that holds the rank of the directional light the forward readers take
 *  (`SceneLightStore.forwardDirectionalSlot`) plus one, 0 for none: what a program tells that light
 *  by (`DirectLights.forwardRank`). */
export const LIGHT_HEADER_FORWARD = 1
/** Rank of a light kind in the GPU buffer: the shader refers to it by this number, not by name.
 *  @property point - A bulb. @property spot - A torch. @property directional - The sun.
 *  @property rect - A glowing rectangle. */
export const LIGHT_KIND = { point: 0, spot: 1, directional: 2, rect: 3 } as const
/** The kind word's rank is under this; the flags are the bits above it. */
export const LIGHT_KIND_SPAN = 4
/** The flags a light's kind word carries above its rank (`LIGHT_KIND`): each one bit, its value
 *  added to the rank. @property castsShadow - The light casts shadows. @property shadowsFog - Its
 *  shadow also shadows the volumetric fog. @property transmission - The light shines through the
 *  subsurface-profile surfaces it shadows (`transmitsOf`). */
export const LIGHT_FLAG = /* @__PURE__ */ (() =>
  ({
    castsShadow: LIGHT_KIND_SPAN,
    shadowsFog: 2 * LIGHT_KIND_SPAN,
    transmission: 4 * LIGHT_KIND_SPAN,
  }) as const)()
/** The step of a light function table's index in a light's kind word: the word is the rank, plus the
 *  flags (`LIGHT_FLAG`), plus this times the index; 0, no light function. */
export const LIGHT_FUNCTION_STEP = /* @__PURE__ */ (() => 8 * LIGHT_KIND_SPAN)()
/** The bits the flags and the rank take below the index: `LIGHT_FUNCTION_STEP` is `1 << this`. */
export const LIGHT_FUNCTION_SHIFT = 5
