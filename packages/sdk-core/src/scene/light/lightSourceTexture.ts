import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import type { SceneLight } from './contracts.ts'
import { bad } from './lightFunction.ts'
import { unused } from './validateBasics.ts'

/** The fields of a rectangle light that map a texture on its face (`SceneLight`). */
export interface SceneLightSourceTexture {
  /**
   * Rect only: the id of the picture mapped on the rectangle's face, which the light's colour is multiplied by wherever it
   * lights (a window, a screen, a gobo). The picture is the one the host registered under that id
   * (`world.setRectLightTexture`). Seen from the front of the light, its left-to-right axis runs along `right` and its top edge lies
   * toward `cross(direction, right)`; it is read as a colour in the working space, its alpha ignored. The pictures of all the lights
   * are kept in one atlas (`world.rectLightAtlas`); a light whose picture is not registered yet lights as a plain rectangle.
   */
  sourceTexture?: string
  /** Beside a `sourceTexture`: the share of the picture, across and up, the rectangle shows, from 0 (excluded) to 1; absent, `[1, 1]`. */
  sourceTextureScale?: [number, number]
  /** Beside a `sourceTexture`: where in the picture the share shown starts, across and down, from 0 to 1; absent, `[0, 0]`. */
  sourceTextureOffset?: [number, number]
}

/** The scale of a light's source texture: the whole picture when it names none. */
export const sourceTextureScaleOf = (light: Pick<SceneLight, 'sourceTextureScale'>) =>
  light.sourceTextureScale ?? ([1, 1] as const)
/** The offset of a light's source texture: the picture's start when it names none. */
export const sourceTextureOffsetOf = (light: Pick<SceneLight, 'sourceTextureOffset'>) =>
  light.sourceTextureOffset ?? ([0, 0] as const)

const FIELDS = ['sourceTexture', 'sourceTextureScale', 'sourceTextureOffset'] as const

/** A pair of numbers from `low` to `high`, `low` excluded when `open`. */
function pair(
  light: SceneLight,
  field: 'sourceTextureScale' | 'sourceTextureOffset',
  open: boolean,
): [number, number] | undefined {
  const value = light[field]
  if (value === undefined) return undefined
  const fits = (v: unknown) => isFiniteNumber(v) && v <= 1 && (open ? v > 0 : v >= 0)
  if (!Array.isArray(value) || value.length !== 2 || !value.every(fits))
    throw bad(
      light.id,
      `${field} expects two numbers ${open ? 'above 0 up to 1' : 'from 0 to 1'}`,
      value,
    )
  return [value[0], value[1]]
}

/** A sun, a point and a spot have no face to map a picture on: the fields are refused, never accepted then ignored. */
export function refuseSourceTexture(light: SceneLight) {
  for (const field of FIELDS) unused(light, field, 'exists only for a rect')
}

/** The source texture of a rect, into `validated`: a picture id, and, only beside it, its scale and its offset. */
export function validateSourceTexture(light: SceneLight, validated: SceneLight) {
  const { id, sourceTexture } = light
  if (sourceTexture === undefined) {
    unused(light, 'sourceTextureScale', 'exists only beside a sourceTexture')
    unused(light, 'sourceTextureOffset', 'exists only beside a sourceTexture')
    return
  }
  if (typeof sourceTexture !== 'string' || !sourceTexture)
    throw bad(id, 'sourceTexture expects a picture id', sourceTexture)
  validated.sourceTexture = sourceTexture
  const scale = pair(light, 'sourceTextureScale', true)
  if (scale) validated.sourceTextureScale = scale
  const offset = pair(light, 'sourceTextureOffset', false)
  if (offset) validated.sourceTextureOffset = offset
}

/** Two lights with the same picture, share and offset. */
export const sameSourceTexture = (a: SceneLight, b: SceneLight) =>
  a.sourceTexture === b.sourceTexture &&
  sameValues(sourceTextureScaleOf(a), sourceTextureScaleOf(b)) &&
  sameValues(sourceTextureOffsetOf(a), sourceTextureOffsetOf(b))
