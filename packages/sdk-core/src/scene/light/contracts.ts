/**
 * A scene light, version 2. Units are radiometric and linear (P1): `color` is a linear colour and
 * `intensity` a strictly positive radiometric intensity — a radiance for a `rect`. Four kinds,
 * and nothing else makes light in this engine (P6):
 * - `point`: a position and a range in metres beyond which it lights nothing;
 * - `spot`: the same plus a direction and a cone half-angle in radians;
 * - `directional`: the sun or an overcast sky — a propagation direction, no position and
 *   no range, the same irradiance everywhere, and cascade shadows that follow the camera;
 * - `rect`: a one-sided rectangle of `size` metres centred on `position`, emitting along
 *   `direction`, its width along `right`; no cast shadow (`directRectLightWgsl.ts`).
 *
 * Fields a kind does not use are rejected at validation: a directional light with
 * a position would be a promise the engine would not keep.
 */
export interface SceneLight {
  id: string;
  kind: 'point' | 'spot' | 'directional' | 'rect';
  /** Point and spot only: the point the light comes from, in metres. */
  position?: [number, number, number];
  /** Spot: the cone axis. Directional: the propagation direction (from the sun toward the
   *  ground). Rect: the normal of its emitting face. */
  direction?: [number, number, number];
  color: [number, number, number];
  intensity: number;
  /** Point, spot and rect: the range in metres, where energy vanishes exactly. */
  range?: number;
  coneAngle?: number;
  /** Spot only: the share of the cone, from its edge inward, over which the light fades in
   *  `[0, 1]`; without it the edge softens over `spotEdgeSoftness`. */
  penumbra?: number;
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
  /** Rect only: the unit axis its width runs along, perpendicular to `direction`. */
  right?: [number, number, number];
  /** Rect only: its width and height, in metres. */
  size?: [number, number];
  castsShadow: boolean;
}
/** Exposure, display curve and the irradiance from every direction (`../core/environment.ts`). */
export type { SceneEnvironment } from '../core/environment.ts';
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
   * Lights shaded in full — shadow read included — per pixel of a MOVING image (X2): the
   * others are weighed without their shadow, and the shaded ones are drawn in proportion, so
   * the estimate is unbiased and temporal antialiasing averages it. A still image shades
   * every light of its tile and converges to the exact sum; there, this number plays no part.
   */
  samplesPerPixel: 4,
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
   * (`../light-shadow/sunFaces.ts`).
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
/** Floats of a light in the GPU buffer: five `vec4f`, never reallocated. */
export const SCENE_LIGHT_FLOATS = 20;
/** Light-buffer header: count, tiles in X, tiles in Y, reserved. */
export const SCENE_LIGHT_HEADER_FLOATS = 4;
export const SCENE_LIGHT_BUFFER_FLOATS =
  SCENE_LIGHT_HEADER_FLOATS + LIGHT_SETTINGS.maxLights * SCENE_LIGHT_FLOATS;
/** Rank of a light kind in the GPU buffer: the shader refers to it by this number, not by name. */
export const LIGHT_KIND = { point: 0, spot: 1, directional: 2, rect: 3 } as const;
/** Axis of a light that has one — spot, directional, rect —, normalised by the contract, which
 *  rejects a light of those kinds without one: reading it here assumes nothing more. */
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
/** The ten numbers of a view, in order: position, axis, half-field, aspect, near, far. */
export const VIEW_NUMBERS = 10;
export function writeView(view: ShadowViewpoint, out: Float64Array) {
  out.set(view.position);
  out.set(view.forward, 3);
  out[6] = view.halfFovY;
  out[7] = view.aspect;
  out[8] = view.near;
  out[9] = view.far;
  return out;
}
