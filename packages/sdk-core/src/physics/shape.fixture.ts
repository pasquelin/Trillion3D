// The geometries, scales and refusal the tests of `shape.ts` and `soft.ts` share.
import { refuses } from '../contracts/cache.fixture.ts'
import { BufferAttribute } from '../world/buffer/attribute.ts'
import { Geometry } from '../world/geometry/geometry.ts'

/** A geometry of `values`, three per vertex, indexed by `index` when given. */
export function positions(values: number[], index?: number[]) {
  const value = new Geometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array(values), 3),
  )
  if (index) value.setIndex(index)
  return value
}

export const one = { x: 1, y: 1, z: 1 }
export const twice = { x: 2, y: 2, z: 2 }
export const ball = { type: 'sphere', radius: 1 } as const
/** A triangle and a stray vertex, indexed backwards or not indexed. */
export const triangle = (indexed = false) =>
  positions([1, 2, 3, -2, 4, 5, 6, -3, 2, 9, 8, 7], indexed ? [2, 1, 0] : undefined)
/** Asserts `run` refuses the shape as `PHYSICS_FAILED`, naming `name`; returns the message. */
export const refusedShape = (run: () => unknown, name: string) =>
  refuses(run, 'PHYSICS_FAILED', { name }, [`"${name}"`])
