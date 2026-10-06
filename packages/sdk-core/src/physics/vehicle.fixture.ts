// The vehicles the tests build: a body and its wheels, placed as a page places them.
import { box, cylinder } from '../world/geometry/basic.ts'
import { Material } from '../world/material/material.ts'
import { Mesh } from '../world/object/mesh.ts'
import { WHEEL_WORDS } from './wire.fixture.ts'

const stuff = () => new Material('meshStandard')
/** A body with a wheel of radius 0.3 and width 0.2 at each `[x, z]`, 0.3 below its centre. */
export function rig(at: readonly (readonly number[])[]) {
  const body = new Mesh(box(2, 0.5, 4), stuff())
  const wheels = at.map(([x, z]) => {
    const wheel = new Mesh(cylinder(0.3, 0.3, 0.2), stuff())
    wheel.position.set(x, -0.3, z)
    wheel.rotation.z = Math.PI / 2
    body.add(wheel)
    return wheel
  })
  return { body, wheels }
}
/** A car's four wheels, front pair first. */
export const FOUR = [-1.25, 1.25].flatMap((z) => [-0.8, 0.8].map((x) => [x, z]))
/** A motorcycle's two wheels in line, and a hull's three a side. */
export const BIKE = [
  [0, -0.7],
  [0, 0.7],
]
export const HULL = [-1, 0, 1].flatMap((z) => [-1, 1].map((x) => [x, z]))
/** Each wheel's role, from the VEHICLE words. */
export const roles = (words: readonly number[]) => words.filter((_, i) => i % WHEEL_WORDS === 5)
