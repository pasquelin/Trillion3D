import { build, type Input, type Vec3 } from './syntheticField.fixture.ts'

/** A ray from `start` along `dir`, `to` long. */
export function march(
  field: ReturnType<typeof build>,
  start: Vec3,
  dir: Vec3,
  to: number,
  edit?: (i: Input) => void,
) {
  const input = field.gdfTraceInput(start, dir, 0, to, 1, 1)
  edit?.(input)
  return field.gdfTrace(input)
}

const PLANE = 20
/** The distance above the plane y = 20: the surface a ray falls on. */
export const plane = (p: Vec3) => p[1] - PLANE
/** A downward ray that meets the plane after `t`, from 100 above it. */
export const DOWN: Vec3 = [0, -1, 0]
export const START: Vec3 = [0, 120, 0]
