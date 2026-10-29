import { length3 } from '../../../../math/src/vector/vector.ts'
import {
  LIGHT_FLAG,
  LIGHT_KIND,
  LIGHT_KIND_SPAN,
  LIGHT_PAYLOAD_MASK,
  LIGHT_UNDRAWN_SHIFT,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_FIELD, baseOf } from '../../../../sdk-core/src/scene/light/fields.ts'

/** The kinds of light the path tracer samples, as the shader's `PT_LIGHT_*` name them: the sky and the suns come first, at every point. */
export const PT_LIGHT = { sky: 0, directional: 1, point: 2, spot: 3, rect: 4 } as const

/** Floats of one light's record: seven `vec4f`. */
export const PT_LIGHT_FLOATS = 28

/** The most lights the path tracer picks among at a point (a light's number is kept in a table of this length per thread). */
export const PT_LIGHT_MAXIMUM = 256

/** Where each part of a light's record lies, in floats (the shader's `PtLight`): the place in the eye's frame (`position`) and the kind in the fourth float,
 *  the axis the light shines along (a sun's, the direction toward it; a spot's cone; a rectangle's normal), the colour times the strength and the range,
 *  the tangent (a rectangle's height axis) and the radius (a lamp's source, a sun's disk sine), the sizes (a rectangle's width and height, a spot's
 *  outer cosine and the reciprocal of the gap to the inner), the shares of its diffuse and specular light, the exponent of a falloff that is not the
 *  inverse square, whether it casts a shadow, and the factor on its light once the path has scattered (its indirect lighting factor). */
export const PT_LIGHT_AT = {
  position: 0,
  kind: 3,
  axis: 4,
  colour: 8,
  range: 11,
  tangent: 12,
  radius: 15,
  width: 16,
  height: 17,
  cosOuter: 18,
  invCone: 19,
  diffuse: 20,
  specular: 21,
  exponent: 22,
  shadow: 23,
  indirect: 24,
} as const

/** The lights of an image as the path tracer reads them: their records, how many there are, how many are at infinity (the sky and the suns
 *  come first), and the box that holds the spheres of influence of the others. */
export interface PathTracingLights {
  readonly data: Float32Array<ArrayBuffer>
  readonly count: number
  readonly infinite: number
  readonly boundMin: readonly [number, number, number]
  readonly boundMax: readonly [number, number, number]
}

/** The light store's table as the path tracer needs it. */
export interface LightTableView {
  readonly packed: Float32Array
  readonly count: number
}

type Vector = [number, number, number]

const lanes = (p: Float32Array, at: number): Vector => [p[at]!, p[at + 1]!, p[at + 2]!]
const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/**
 * THE LIGHTS OF AN IMAGE, in the records the path tracer's shader reads (`lightsWgsl.ts`), from the store's table: each light's place taken to the eye
 * `eye` (the scene trace works relative to it), its colour times its strength (a sun's irradiance, a lamp's intensity, a rectangle's radiance), its
 * axis, its range, the size of its source and its cones, its shares; the sky first when `sky` (the sky light's cube is ready), then the suns, then the
 * lamps and rectangles. A light the view leaves out (`LIGHT_UNDRAWN_SHIFT`) is left out. The strength is the one the table holds, without its blend with
 * the exposure's inverse (`SceneLight.inverseExposureBlend`): the path tracer holds the exposure it was started at (`PathTracingView.baseExposure`).
 * The box is that of the spheres of influence (position ± range) of the lamps and rectangles, which the light grid divides.
 */
export function buildPathTracingLights(
  table: LightTableView,
  eye: readonly [number, number, number],
  sky: boolean,
): PathTracingLights {
  const { packed: p } = table
  const words = new Uint32Array(p.buffer, p.byteOffset, p.length)
  const suns: number[] = []
  const lamps: number[] = []
  for (let slot = 0; slot < table.count; slot++) {
    const bits = words[baseOf(slot) + LIGHT_FIELD.kind]! & LIGHT_PAYLOAD_MASK
    if ((bits >>> LIGHT_UNDRAWN_SHIFT) & 1) continue
    ;(bits % LIGHT_KIND_SPAN === LIGHT_KIND.directional ? suns : lamps).push(slot)
  }
  const first = sky ? 1 : 0
  // The buffer and the shader's table hold `PT_LIGHT_MAXIMUM` lights at most (the sky included): the suns first, then the lamps in the store's order.
  const slots = [...suns, ...lamps].slice(0, PT_LIGHT_MAXIMUM - (sky ? 1 : 0))
  const total = slots.length + first
  const data = new Float32Array(Math.max(total, 1) * PT_LIGHT_FLOATS)
  const boundMin: Vector = [Infinity, Infinity, Infinity]
  const boundMax: Vector = [-Infinity, -Infinity, -Infinity]
  if (sky) data[PT_LIGHT_AT.kind] = PT_LIGHT.sky
  slots.forEach((slot, rank) => {
    const at = (rank + first) * PT_LIGHT_FLOATS
    const base = baseOf(slot)
    const bits = words[base + LIGHT_FIELD.kind]! & LIGHT_PAYLOAD_MASK
    const kind = bits % LIGHT_KIND_SPAN
    const strength = p[base + LIGHT_FIELD.intensity]!
    const colour = lanes(p, base + LIGHT_FIELD.color).map((c) => c * strength)
    const direction = lanes(p, base + LIGHT_FIELD.direction)
    const place = lanes(p, base + LIGHT_FIELD.position)
    const range = p[base + LIGHT_FIELD.range]!
    const shares = kind === LIGHT_KIND.rect ? LIGHT_FIELD.rectShares : LIGHT_FIELD.shares
    data.set(colour, at + PT_LIGHT_AT.colour)
    data[at + PT_LIGHT_AT.diffuse] = p[base + shares]!
    data[at + PT_LIGHT_AT.specular] = p[base + shares + 1]!
    data[at + PT_LIGHT_AT.shadow] = bits & LIGHT_FLAG.castsShadow ? 1 : 0
    data[at + PT_LIGHT_AT.indirect] = p[base + LIGHT_FIELD.contactGi + 3]!
    if (kind === LIGHT_KIND.directional) {
      data[at + PT_LIGHT_AT.kind] = PT_LIGHT.directional
      data.set(
        direction.map((c) => -c),
        at + PT_LIGHT_AT.axis,
      )
      data[at + PT_LIGHT_AT.radius] = p[base + LIGHT_FIELD.sourceTerm]!
      return
    }
    const position = place.map((c, axis) => c - eye[axis]!) as Vector
    data.set(position, at + PT_LIGHT_AT.position)
    data.set(direction, at + PT_LIGHT_AT.axis)
    data[at + PT_LIGHT_AT.range] = range
    data[at + PT_LIGHT_AT.exponent] = p[base + LIGHT_FIELD.radialExponent]!
    if (kind === LIGHT_KIND.rect) {
      data[at + PT_LIGHT_AT.kind] = PT_LIGHT.rect
      const right = lanes(p, base + LIGHT_FIELD.halfWidth)
      const width = 2 * length3(right[0], right[1], right[2])
      data.set(
        cross(direction, right.map((c) => c / Math.max(width / 2, 1e-12)) as Vector),
        at + PT_LIGHT_AT.tangent,
      )
      data[at + PT_LIGHT_AT.width] = width
      data[at + PT_LIGHT_AT.height] = 2 * p[base + LIGHT_FIELD.halfHeight]!
    } else {
      data[at + PT_LIGHT_AT.kind] = kind === LIGHT_KIND.spot ? PT_LIGHT.spot : PT_LIGHT.point
      data[at + PT_LIGHT_AT.radius] = p[base + LIGHT_FIELD.emitterRadius]!
      if (kind === LIGHT_KIND.spot) {
        const outer = p[base + LIGHT_FIELD.cosCone]!
        data[at + PT_LIGHT_AT.cosOuter] = outer
        data[at + PT_LIGHT_AT.invCone] = 1 / Math.max(p[base + LIGHT_FIELD.cosInner]! - outer, 1e-6)
      }
    }
    for (let c = 0; c < 3; c++) {
      boundMin[c] = Math.min(boundMin[c]!, position[c]! - range)
      boundMax[c] = Math.max(boundMax[c]!, position[c]! + range)
    }
  })
  return {
    data,
    count: total,
    infinite: suns.length + first,
    boundMin,
    boundMax,
  }
}
