import { refusal, type Refuse } from './nameMatch.ts'
import { length3 } from '../../../math/src/vector/vector.ts'

/**
 * WHAT A VIEW CARRIES BESIDE ITS EYE (`Camera`, `../world/camera/camera.ts`): a plane that clips
 * what it draws, and the lists that say which objects it draws. Both belong to the view, never to
 * the world: a mirror, a portal or a minimap sees the same scene as the main image and differs by
 * them alone.
 *
 * THE CLIP PLANE is off by default: a view has none. Given a point of it, `base` (the origin), and
 * its `normal` (up, +z), the plane lets through what lies on the side the normal points to; the
 * normal is made a unit vector, and a zero normal names no plane. It takes effect only while the
 * run-time setting `cutClipPlane` is on (`./cutOptions.ts`), as the reference's project switch is
 * off by default; the cut culls what lies wholly behind it and the raster cuts what straddles it.
 * Shadows are not clipped: the light's views carry none.
 *
 * THE LISTS are empty by default: nothing is filtered. `hidden` names objects the view does not
 * draw; `showOnly`, when it is a list — a view with none is `null` —, names the only objects it
 * draws, an empty list drawing nothing at all. An entry stands for the object and everything under
 * it, as one object of the reference's stands for all its components; `hidden` wins over `showOnly`
 * for an object named by both. They apply while the run-time setting `cutViewFiltering` is on.
 */

/** A point or a direction, as a page writes it: `[x, y, z]` or anything with those three fields. */
export type ClipPlaneVector =
  readonly [number, number, number] | { readonly x: number; readonly y: number; readonly z: number }

/** A plane that clips a view: what a page writes (`Camera.clipPlane`). */
export interface ClipPlane {
  /** Any point of the plane. @defaultValue [0, 0, 0] */
  base?: ClipPlaneVector
  /** The direction the drawn side lies in; made a unit vector, a zero one naming no plane.
   *  @defaultValue [0, 0, 1] */
  normal?: ClipPlaneVector
}

/** A plane as the engine holds it, `[nx, ny, nz, w]` with `(nx, ny, nz)` a unit vector or zero: a
 *  point `p` is drawn when `n · p - w >= 0`. All four zero is no plane. */
export type ClipPlaneValues = readonly [number, number, number, number]

/** No plane: the value of a view that clips nothing. */
export const NO_CLIP_PLANE: ClipPlaneValues = Object.freeze([0, 0, 0, 0]) as ClipPlaneValues
/** The plane's point when the page names none. */
export const DEFAULT_CLIP_PLANE_BASE: readonly [number, number, number] = [0, 0, 0]
/** The plane's normal when the page names none. */
export const DEFAULT_CLIP_PLANE_NORMAL: readonly [number, number, number] = [0, 0, 1]

/** Three finite numbers of `value`, or the refusal `refuse` says. */
function triple(value: ClipPlaneVector, what: string, refuse: Refuse): [number, number, number] {
  const read = Array.isArray(value)
    ? [value[0], value[1], value[2]]
    : [(value as { x: number }).x, (value as { y: number }).y, (value as { z: number }).z]
  if (read.some((n) => typeof n !== 'number' || !Number.isFinite(n)))
    return refuse(`${what} must be three finite numbers, got ${JSON.stringify(value)}`)
  return read as [number, number, number]
}

/**
 * The plane a page names, as the engine holds it: `null`, `undefined` or `false` none; an object
 * `{ base, normal }`, each left out at its default, the plane through `base` with the unit
 * `normal`. One reading of the option, whoever takes it.
 * @throws TypeError naming what it takes when the option is none of them.
 */
export function resolveClipPlane(option?: ClipPlane | false | null): ClipPlaneValues {
  if (option === undefined || option === null || option === false) return NO_CLIP_PLANE
  const refuse = refusal('clipPlane')
  if (typeof option !== 'object')
    return refuse(`must be false, null or { base, normal }, got ${String(option)}`)
  const base = triple(option.base ?? DEFAULT_CLIP_PLANE_BASE, 'base', refuse),
    normal = triple(option.normal ?? DEFAULT_CLIP_PLANE_NORMAL, 'normal', refuse)
  const length = length3(normal[0], normal[1], normal[2])
  if (!(length > 0)) return NO_CLIP_PLANE
  const unit = [normal[0] / length, normal[1] / length, normal[2] / length] as const
  return [unit[0], unit[1], unit[2], unit[0] * base[0] + unit[1] * base[1] + unit[2] * base[2]]
}

/** Whether `values` names a plane: a normal that is not zero. */
export const hasClipPlane = (values: ClipPlaneValues) =>
  values[0] !== 0 || values[1] !== 0 || values[2] !== 0

/**
 * The objects of a list a page writes, as a frozen copy: what the list held when it was written
 * is what the view draws by, a later change of the page's own array reaching none.
 * @throws TypeError naming the list when it is not a collection of objects.
 */
export function resolveViewList<T extends object>(option: Iterable<T>, name: string) {
  const refuse = refusal(name)
  if (typeof option !== 'object' || option === null || !(Symbol.iterator in option))
    return refuse('must be a list of objects')
  const list = [...option]
  if (list.some((entry) => typeof entry !== 'object' || entry === null))
    return refuse('must hold objects only')
  return Object.freeze(list) as readonly T[]
}
