import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import {
  CAPSULE_PARAM_FLOATS,
  CAPSULE_PARAMS,
  CAPSULE_TILE,
  LIGHT_DIRECTION_GROUP,
  LIGHT_DIRECTION_PARAM_FLOATS,
  LIGHT_DIRECTION_PARAMS,
  UPSAMPLE_PARAMS,
} from './layout.ts'

/**
 * WHAT A CAPSULE SHADOW PASS IS GIVEN: the sizes of its textures and its dispatch, the light's numbers, and the words of its uniform
 * (`layout.ts`), worked out on the CPU.
 *
 * The shadow factors are computed at a fraction of the image, half each way unless the full resolution is asked, by tiles of
 * `CAPSULE_TILE` pixels a side; the tiles that meet a shape are drawn again at the image's resolution (`upsampleWgsl.ts`).
 */

/** The side of a pixel of the shadow factors in the image's pixels. */
export const capsuleDownsample = (fullResolution: boolean) => (fullResolution ? 1 : 2)

/** The size of the shadow factors' texture for an image of `extent` pixels: rounded up, so that the last row and column of an image of odd size are covered
 *  (the reference rounds down, `CapsuleShadowRendering.cpp:159,545`, and loses them: a bug of its, not ported). */
export const capsuleFactorsSize = (extent: readonly [number, number], downsample: number) =>
  [ceilDiv(extent[0], downsample), ceilDiv(extent[1], downsample)] as const

/** The size, in the factors' pixels, of the pass over a rectangle of `size` image pixels, and the tiles that cover it. A pass over a light's
 *  rectangle always has one tile; the pass over the whole view (`atLeastOne` off) has what the rectangle asks. */
export function capsuleGrid(
  size: readonly [number, number],
  downsample: number,
  atLeastOne: boolean,
) {
  const [width, height] = capsuleFactorsSize(size, downsample)
  const across = ceilDiv(width, CAPSULE_TILE)
  const down = ceilDiv(height, CAPSULE_TILE)
  return {
    width,
    height,
    tilesAcross: atLeastOne ? Math.max(across, 1) : across,
    tilesDown: atLeastOne ? Math.max(down, 1) : down,
  }
}

/** The groups of the pass that derives the shapes' light directions. */
export const lightDirectionGroups = (records: number) => ceilDiv(records, LIGHT_DIRECTION_GROUP)

/** A source radius of 0 would make the cone trace blind; this one, 20 centimetres, is taken instead. */
const DEFAULT_SOURCE_RADIUS = 0.2
/** The least source radius, a hundredth of a millimetre: shorter gives no penumbra. */
const LEAST_SOURCE_RADIUS = 1e-5

/** The radius of a light's source in metres as the trace reads it: 0 is 20 centimetres, else it is held between a millimetre and a quarter of the light's
 *  radius (`invRadius`, the inverse of its radius; 0 for a light with none, no upper bound then). */
function capsuleSourceRadius(sourceRadius: number, invRadius: number) {
  if (sourceRadius === 0) return DEFAULT_SOURCE_RADIUS
  const most = 1 / (4 * invRadius)
  return sourceRadius < LEAST_SOURCE_RADIUS
    ? LEAST_SOURCE_RADIUS
    : sourceRadius < most
      ? sourceRadius
      : most
}

/** The angle, in radians, of a directional light's cone: five times its source angle, held between 1 and 30 degrees. */
const capsuleSourceAngle = (sourceAngleDegrees: number) =>
  (Math.min(Math.max(sourceAngleDegrees * 5, 1), 30) * Math.PI) / 180

/** The slope of the fade after the cosine `cos`, held finite. */
const fadeSlope = (cos: number) => 1 / Math.max(1 - cos, 1e-6)

/** The cosine where the indirect shadow starts to fade and the slope of the fade after it; a fade angle of 0 makes the slope infinite,
 *  so it is held finite. */
function capsuleFade(fadeAngle: number): readonly [number, number] {
  const cos = Math.cos(fadeAngle)
  return [cos, fadeSlope(cos)]
}

/** A light a pass casts the shadows of, in the world's metres. */
export interface CapsuleLight {
  readonly directional: boolean
  readonly position: readonly [number, number, number]
  /** The unit vector from the pixel toward a directional light. */
  readonly direction: readonly [number, number, number]
  readonly invRadius: number
  readonly sourceRadius: number
  /** In degrees. */
  readonly sourceAngle: number
}

/** What a pass needs to write its uniform. */
export interface CapsulePass {
  /** The matrix that takes a clip position to the view's. */
  readonly clipToView: ArrayLike<number>
  readonly viewToWorld: ArrayLike<number>
  /** The translation added to every world position: the view's, so the pass works near the origin. */
  readonly preViewTranslation: readonly [number, number, number]
  readonly perspective: boolean
  /** The view's rectangle in the image, and the pass's: first pixel and size. */
  readonly viewport: readonly [number, number, number, number]
  readonly scissor: readonly [number, number, number, number]
  readonly downsample: number
  readonly maxOcclusionDistance: number
  readonly shapeCount: number
  readonly tilesAcross: number
  readonly tilesDown: number
  readonly fadeAngle: number
  /** The meshes with a distance field that cast the indirect shadow (`casters`). */
  readonly casterCount: number
  /** The depth terms of the image (`capsuleDepthTerms`). */
  readonly depth: readonly [number, number, number]
  /** The intensity of the shadow on the surface of a caster, from 0 to 1. */
  readonly selfShadowIntensity: number
  /** The light of a direct pass; none for an indirect one. */
  readonly light?: CapsuleLight
}

/** Writes the uniform of `pass` into `out` (`CAPSULE_PARAM_FLOATS` floats). */
export function writeCapsuleParams(out: Float32Array, pass: CapsulePass) {
  const { preViewTranslation: pre } = pass
  for (let i = 0; i < 16; i++) {
    out[CAPSULE_PARAMS.clipToView + i] = pass.clipToView[i]
    out[CAPSULE_PARAMS.viewToTranslatedWorld + i] = pass.viewToWorld[i]
  }
  for (let axis = 0; axis < 3; axis++)
    out[CAPSULE_PARAMS.viewToTranslatedWorld + 12 + axis] += pre[axis]
  const { light } = pass
  if (light) {
    out.set(
      [
        light.position[0] + pre[0],
        light.position[1] + pre[1],
        light.position[2] + pre[2],
        light.invRadius,
      ],
      CAPSULE_PARAMS.lightPosition,
    )
    out.set([...light.direction, capsuleSourceAngle(light.sourceAngle)], CAPSULE_PARAMS.lightAim)
  } else {
    out.fill(0, CAPSULE_PARAMS.lightPosition, CAPSULE_PARAMS.lightPosition + 8)
  }
  out.set(pass.viewport, CAPSULE_PARAMS.viewport)
  out.set(pass.scissor, CAPSULE_PARAMS.scissor)
  out.set(
    [
      light ? capsuleSourceRadius(light.sourceRadius, light.invRadius) : 0,
      pass.maxOcclusionDistance,
      pass.downsample,
      pass.shapeCount,
    ],
    CAPSULE_PARAMS.shape,
  )
  out.set([...capsuleFade(pass.fadeAngle), pass.casterCount, 0], CAPSULE_PARAMS.fade)
  out.set([...pass.depth, 0], CAPSULE_PARAMS.depth)
  out.set([pre[0], pre[1], pre[2], 0], CAPSULE_PARAMS.translation)
  out.set(
    [pass.tilesAcross, pass.tilesDown, pass.selfShadowIntensity, pass.perspective ? 1 : 0],
    CAPSULE_PARAMS.extra,
  )
  return out
}

/** A uniform's words, zeroed. */
export const createCapsuleParams = () => new Float32Array(CAPSULE_PARAM_FLOATS)

/** How the sky light gives the indirect shadow its direction: 0 no sky light, or one whose own lighting is baked in; 1 a stationary one, the
 *  unoccluded direction its volumetric lightmap holds; 2 one that captures the scene as it is drawn, the direction its harmonics are strongest in. */
export const skyLightMode = (
  sky: { wantsStaticShadowing: boolean; realTimeCapture: boolean } | undefined,
) => (sky?.realTimeCapture ? 2 : sky?.wantsStaticShadowing ? 1 : 0)

/** The uniform of the pass that derives light directions: `records` records, the sky light's `mode` (`skyLightMode`) and the settings. */
export function writeLightDirectionParams(
  out: Float32Array,
  records: number,
  mode: number,
  settings: {
    capsuleIndirectConeAngle: number
    capsuleSkyAngleScale: number
    capsuleMinSkyAngle: number
  },
) {
  const words = new Uint32Array(out.buffer, out.byteOffset, LIGHT_DIRECTION_PARAM_FLOATS)
  words[LIGHT_DIRECTION_PARAMS.counts] = records
  words[LIGHT_DIRECTION_PARAMS.counts + 1] = mode
  out[LIGHT_DIRECTION_PARAMS.angles] = settings.capsuleIndirectConeAngle
  out[LIGHT_DIRECTION_PARAMS.angles + 1] = settings.capsuleSkyAngleScale
  out[LIGHT_DIRECTION_PARAMS.angles + 2] = settings.capsuleMinSkyAngle
  return out
}

/** How a device depth turns into a distance in metres along the view's axis: for a perspective view the near plane and 1 (the depth is the near plane over the
 *  device depth), for an orthographic one the far less the near and the near, and 0. */
export const capsuleDepthTerms = (image: {
  perspective: boolean
  near: number
  far: number
}): readonly [number, number, number] =>
  image.perspective ? [image.near, 0, 1] : [image.far - image.near, image.near, 0]

/** The camera of an image as the pass reads it: the matrix that takes a clip position to the view's (the projection's inverse) and the one that takes
 *  the view's to the world's (the camera's world matrix). */
export function capsuleCamera(image: { projection: ArrayLike<number>; world: ArrayLike<number> }) {
  return {
    clipToView: invertMatrix4(new Float64Array(16), image.projection),
    viewToWorld: image.world,
  }
}

/** What the upsample draw needs to write its uniform. */
interface CapsuleUpsample {
  /** The pass's rectangle in the image: first pixel and size. */
  readonly scissor: readonly [number, number, number, number]
  readonly viewport: readonly [number, number, number, number]
  /** The image's size in pixels. */
  readonly extent: readonly [number, number]
  readonly downsample: number
  /** The factors' rectangle the pass wrote, in the factors' pixels. */
  readonly grid: {
    readonly width: number
    readonly height: number
    readonly tilesAcross: number
    readonly tilesDown: number
  }
  /** Whether the output is a light's attenuation. */
  readonly attenuation: boolean
  readonly selfShadowIntensity: number
  /** The layer of the suns' mask a composition writes. */
  readonly layer?: number
  readonly depth: readonly [number, number, number]
}

/** Writes the uniform of the upsample draw into `out` (`UPSAMPLE_PARAM_FLOATS` floats). */
export function writeUpsampleParams(out: Float32Array, upsample: CapsuleUpsample) {
  const [width, height] = upsample.extent
  const low = capsuleFactorsSize(upsample.extent, upsample.downsample)
  out.set(upsample.scissor, UPSAMPLE_PARAMS.scissor)
  out.set([width, height, 1 / width, 1 / height], UPSAMPLE_PARAMS.buffer)
  out.set([low[0], low[1], low[0] - 1, low[1] - 1], UPSAMPLE_PARAMS.low)
  out.set(
    [
      upsample.grid.tilesAcross,
      upsample.grid.tilesDown,
      CAPSULE_TILE * upsample.downsample,
      upsample.attenuation ? 1 : 0,
    ],
    UPSAMPLE_PARAMS.tile,
  )
  out.set(upsample.viewport, UPSAMPLE_PARAMS.viewport)
  out.set(
    [upsample.selfShadowIntensity, upsample.downsample, upsample.layer ?? 0, 0],
    UPSAMPLE_PARAMS.shading,
  )
  out.set([...upsample.depth, 0], UPSAMPLE_PARAMS.depth)
  return out
}
