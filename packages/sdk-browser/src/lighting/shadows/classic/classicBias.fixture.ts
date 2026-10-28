/**
 * THE DEPTH BIASES OF A CLASSIC SHADOW, in the distance they come to (`classicTraceWgsl.ts` computes the closed forms; this file computes each both ways, so that a test says they are one).
 * The reference gives its biases in the depth range of each map — the cascade's, the spot's, the point light's cube — and the shadow's depth is normalised by it
 * (`ShadowRendering.cpp:1957-2056` the biases, `:2062-2100` the transition, `ShadowSetup.cpp:1071-1086` the depth ranges, `ShadowDepthVertexShader.usf:97-139` where they are applied,
 * `ShadowProjectionCommon.ush:190-233` for a point light). All lengths are centimetres.
 */

/** What a bias reads of its light and its receiver. */
export interface BiasLight {
  /** The light's factor on the constant bias (`SceneLight.shadowBias`) and on the slope's (`shadowSlopeBias`). */
  readonly userBias: number
  readonly userSlope: number
}

/** The half of a cascade's depth range the reference keeps at least, either way from the light's plane (`DepthRangeClamp`). */
const CASCADE_RANGE_FLOOR = 5000
/** The nearest depth of a spot's or a point light's map (`MinLightW`). */
const LOCAL_NEAR = 0.1

/** The depth range of a cascade bounded by a sphere of `radius` (rounded up to a whole unit): the sphere's, doubled, at least the clamp's either way. */
export const cascadeDepthRange = (radius: number) =>
  2 * Math.max(Math.ceil(radius), CASCADE_RANGE_FLOOR)

/** The slope of a receiver whose normal makes the cosine `nol` with the light's axis, held to `maxSlope` (`ShadowMaxSlopeScaleDepthBias`). */
export const biasSlope = (nol: number, maxSlope: number) =>
  Math.min(
    Math.max(Math.abs(nol) > 0 ? Math.sqrt(Math.max(1 - nol * nol, 0)) / nol : maxSlope, 0),
    maxSlope,
  )

/** A cascade's biases the reference's way: through the normalised depth range, as `UpdateShaderDepthBias` and `ComputeTransitionSize` do. */
export function cascadeBiasThroughRange(
  radius: number,
  resolution: number,
  constant: number,
  slopeScale: number,
  light: BiasLight,
  slope: number,
) {
  const range = cascadeDepthRange(radius)
  const texelScale = radius / resolution
  const normalised = (constant / range) * texelScale * light.userBias
  const slopeBias = normalised * (slopeScale * light.userSlope)
  const transition = (constant / range) * texelScale * light.userBias
  return { depth: (normalised + slopeBias * slope) * range, transition: transition * range }
}

/** The same in the distance: no range left in it, which cancels. */
export function cascadeBiasInDistance(
  radius: number,
  resolution: number,
  constant: number,
  slopeScale: number,
  light: BiasLight,
  slope: number,
) {
  const base = constant * (radius / resolution) * light.userBias
  return { depth: base * (1 + slopeScale * light.userSlope * slope), transition: base }
}

/** The depth range of a spot light of range `radius`: from the near plane to its range. */
const spotDepthRange = (radius: number) => radius - LOCAL_NEAR

/** A spot's biases through its normalised depth range (`resolution` its texels a side, `transitionScale` `r.Shadow.SpotLightTransitionScale`). */
export function spotBiasThroughRange(
  radius: number,
  resolution: number,
  constant: number,
  slopeScale: number,
  transitionScale: number,
  light: BiasLight,
  slope: number,
) {
  const range = spotDepthRange(radius)
  const normalised = ((constant * 512) / (range * resolution)) * 2 * light.userBias
  const slopeBias = normalised * (slopeScale * light.userSlope)
  const transition = (1 / transitionScale) * 2 * light.userBias
  return { depth: (normalised + slopeBias * slope) * range, transition: transition * range }
}

/** The same in the distance. */
export function spotBiasInDistance(
  resolution: number,
  constant: number,
  slopeScale: number,
  transitionScale: number,
  radius: number,
  light: BiasLight,
  slope: number,
) {
  const base = ((constant * 512) / resolution) * 2 * light.userBias
  return {
    depth: base * (1 + slopeScale * light.userSlope * slope),
    transition: (spotDepthRange(radius) * 2 * light.userBias) / transitionScale,
  }
}

/** A point light's depth (the cube face's projection, reversed: 1 at the near plane, 0 at its range) at distance `z` along the face's axis. */
const pointFaceDepth = (z: number, radius: number) =>
  (LOCAL_NEAR * (radius - z)) / ((radius - LOCAL_NEAR) * z)

/** The bias a point light's receiver takes, in that depth: `(DepthBias + (1 - NoL) * SlopeDepthBias) / w`, `w` the distance along the face's axis. */
export function pointBiasInDepth(
  z: number,
  resolution: number,
  constant: number,
  slopeScale: number,
  light: BiasLight,
  nol: number,
) {
  const depth = ((constant * 512) / resolution) * 2 * light.userBias
  const slope = depth * (slopeScale * light.userSlope)
  return (depth + (1 - nol) * slope) / z
}

/** How far toward the light the point light's receiver is moved, found the reference's way: the depth of the receiver plus its bias, brought back to a distance by bisection. */
export function pointShiftThroughDepth(z: number, radius: number, bias: number) {
  const target = pointFaceDepth(z, radius) + bias
  let near = LOCAL_NEAR
  let far = z
  for (let i = 0; i < 200; i++) {
    const middle = (near + far) / 2
    if (pointFaceDepth(middle, radius) > target) near = middle
    else far = middle
  }
  return z - (near + far) / 2
}

/** The same in closed form: `z * B / (b + B)` with `B` the bias times `z` (the depth bias before the division by `w`) and `b` the projection's constant, near · range / (range − near). */
export function pointShiftInDistance(z: number, radius: number, bias: number) {
  const b = (LOCAL_NEAR * radius) / (radius - LOCAL_NEAR)
  const depthBias = bias * z
  return (z * depthBias) / (b + depthBias)
}
