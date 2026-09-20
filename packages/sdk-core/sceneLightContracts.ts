/**
 * A scene light, version 2. Units are radiometric and linear (P1): `color` is a
 * linear colour and `intensity` a strictly positive radiometric intensity.
 *
 * Three kinds, and nothing else makes light in this engine (P6):
 * - `point`: a position and a range in metres beyond which it lights nothing;
 * - `spot`: the same plus a direction and a cone half-angle in radians;
 * - `directional`: the sun or an overcast sky — a propagation direction, no position and
 *   no range, the same irradiance everywhere, and cascade shadows that follow the camera.
 *
 * Fields a kind does not use are rejected at validation: a directional light with
 * a position would be a promise the engine would not keep.
 */
export interface SceneLight {
  id: string;
  kind: 'point' | 'spot' | 'directional';
  /** Point and spot only: the point the light comes from, in metres. */
  position?: [number, number, number];
  /** Spot: the cone axis. Directional: the propagation direction (from the sun toward the ground). */
  direction?: [number, number, number];
  color: [number, number, number];
  intensity: number;
  /** Point and spot only: the range in metres, where energy vanishes exactly. */
  range?: number;
  coneAngle?: number;
  /**
   * Point and spot only: the radius, in metres, of the envelope that holds the source.
   * A real light is always housed in something — lantern glass, reflector, shade
   * — and that envelope is geometry like any other: without this field, it enters its own
   * light's shadow map and turns it off. Declared, it becomes the near plane of that map,
   * so nothing that sits closer than this radius from the source casts a shadow there. It is a
   * property of the light, never an object name or a material type: the engine only knows
   * surfaces. Strictly positive and strictly less than the range; if absent, nothing changes.
   */
  emitterRadius?: number;
  castsShadow: boolean;
}
/**
 * Camera exposure, applied to linear radiance just before ACES (P4). This is not
 * a light: it cannot light a surface that nothing lights, it only sets
 * the conversion of radiance into an image. A scene without a light stays black whatever its value.
 */
export interface SceneEnvironment {
  exposure: number;
}
export const SCENE_LIGHT_VERSION = 2;
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
export type SceneLightingView = 'auto' | 'lit' | 'unlit' | 'bounce';
/**
 * Published settings of direct lighting. These are named product choices, not buried
 * constants: every runtime bound rereads them, and the diagnostic publishes them as-is.
 */
export const LIGHT_SETTINGS = {
  /** Lights the contract accepts in total; beyond that, `addLight` rejects. */
  maxLights: 64,
  /** Lights a screen tile keeps; the pixel loop is bounded by this number (X2). */
  maxLightsPerTile: 32,
  /** Side in pixels of a screen tile of the light list. */
  tileSize: 16,
  /**
   * Shadow regions at most per frame: the buffer ceiling, never a quality setting. The
   * millisecond budget almost always stops first; this ceiling is only an ultimate bound,
   * and the only limit on a device without a GPU clock.
   */
  shadowUpdatesPerFrame: 4,
  /**
   * Side of a shadow-atlas page, in texels: the invalidation cell of a face. A moving
   * object only stales the pages its projected box covers, never the whole face.
   */
  shadowPage: 128,
  /**
   * Shadows-stage budget, in GPU milliseconds per frame (X4, RX3). Pages
   * invalidated beyond wait their turn; they are never lost, and their lag is published.
   */
  shadowBudgetMs: 1,
  /** Weight of waiting in a page's priority, per frame spent in queue: against starvation. */
  shadowAgingPerFrame: 0.05,
  /** Share of a frame's sample in the average cost of a page: exponential smoothing of the timer. */
  shadowCostBlend: 0.25,
  /** Side of the depth shadow atlas, in texels. */
  shadowAtlasSize: 4096,
  /** Maximum side of a shadow slice; a point-light face occupies one sixth of its area. */
  shadowSliceMax: 1024,
  /** Minimum side of a shadow slice: below that, the light keeps its slice without refining it. */
  shadowSliceMin: 128,
  /** PCF taps per pixel and per shadow light (X2). */
  pcfTaps: 16,
  /** Width of the softened edge of a spot cone, in cosine units: against staircasing. */
  spotEdgeSoftness: 0.02,
  /** Cascades of a directional light: at least three, never more than the faces of a slice. */
  sunCascades: 4,
  /**
   * Share of the camera frustum the cascades cover, from the near plane toward the far. Beyond,
   * a surface stays lit without a cast shadow: named approximation, published in the diagnostic.
   */
  sunShadowFarFraction: 0.2,
  /**
   * Ratio between two consecutive cascade-split bounds. At a seam, texel
   * density changes by exactly this ratio: it, and nothing else, decides the visible
   * sharpness jump from one cascade to the next, and holding it constant is all that is asked of
   * a split. The near-plane floor is deduced from it — `shadow distance / ratio^cascades` —
   * instead of starting from the camera near plane, a ten-thousandth of the far, which crushed the
   * geometric sequence and forced catching it up by mixing with a uniform sequence.
   */
  sunCascadeRatioMax: 4,
  /**
   * Offset of the far-shadow ray origin along the normal, in metres. It only
   * serves to leave the lit surface's plane; the real remedy against self-shadowing is the
   * start along the ray, below.
   */
  sunFarShadowOffsetMetres: 0.05,
  /**
   * Start of the far-shadow ray along its own direction, in proxy cells. The lit
   * point comes from the fine geometry, the occluder from the coarse proxy: where the proxy
   * sits above the real surface, a ray started at zero would hit the surface it lights.
   * A proxy cell is the scale below which the proxy says nothing; starting from there
   * skips that false contact without inventing a shadow. The consequence is named: an occluder
   * closer than one cell along the ray carries no far shadow, and that one stays with the cascades.
   */
  sunFarShadowStartCells: 1,
  /**
   * Pull-back of a cascade's near plane, in radii of its sphere: what sits above the
   * cascade, between it and the sun, must enter the map to cast its shadow there. The extent
   * adds two radii on either side, the play its depth anchor leaves the sphere
   * (`sceneLightSunFaces.ts`).
   */
  sunCascadeDepthScale: 4,
  /**
   * Shadow bias in metres, never in depth units: a slice's projected depth
   * is highly non-linear, a constant in normalised depth would be metres near the
   * light and millimetres far away. The shader brings those metres back to depth at the considered point.
   */
  shadowDepthBias: 0.02,
  /** Slope bias, in metres per unit of `tan(acos(N·L))`, capped by `shadowSlopeBiasMax`. */
  shadowSlopeBias: 0.08,
  shadowSlopeBiasMax: 0.5,
  /** Near plane of a slice: a fraction of the range, never less than this floor. */
  shadowNearFraction: 1 / 200,
  shadowNearMin: 0.05,
  /**
   * Offset of the sample point along the normal, in slice texels. It is what
   * closes the seam between two faces of a point light and removes grazing acne; it is in
   * texels and not metres so it stays proportional to the resolution the light obtained.
   */
  shadowNormalOffsetTexels: 1.5,
} as const;
/** Lights a shadow slice can address in the atlas: one per declared shadow light. */
export const MAX_SHADOW_SLICES = LIGHT_SETTINGS.maxLights;
/** Faces of a slice: six for a point, one for a spot, the sun's cascades. */
export const POINT_FACES = 6;
/** Floats of a light in the GPU buffer: four `vec4f`, never reallocated. */
export const SCENE_LIGHT_FLOATS = 16;
/** Light-buffer header: count, tiles in X, tiles in Y, reserved. */
export const SCENE_LIGHT_HEADER_FLOATS = 4;
export const SCENE_LIGHT_BUFFER_FLOATS =
  SCENE_LIGHT_HEADER_FLOATS + LIGHT_SETTINGS.maxLights * SCENE_LIGHT_FLOATS;
/** Rank of a light kind in the GPU buffer: the shader refers to it by this number, not by name. */
export const LIGHT_KIND = { point: 0, spot: 1, directional: 2 } as const;
/**
 * Axis of a light that has one — spot or directional. The contract has already normalised it and
 * rejects a light of that kind without a direction: reading this field here assumes nothing more.
 */
export const lightDirection = (light: SceneLight) => light.direction as [number, number, number];
/** What the scheduler knows of the view: a camera, not a matrix, to stay without a dependency. */
export interface ShadowViewpoint {
  position: readonly [number, number, number];
  forward: readonly [number, number, number];
  halfFovY: number;
  aspect: number;
  near: number;
  far: number;
}
