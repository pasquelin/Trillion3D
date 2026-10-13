// A body launched along a closed path, gravity alone driving it, on the joint rig (`joints.fixture.ts`):
// the energy it keeps over a lap (`pathEnergy.test.ts`).
import { joint } from '../../../sdk-core/src/physics/index.ts'
import { gap, jointRig } from './joints.fixture.ts'

/** Gravity in the rigs, m/s², and their step, s. */
export const G = 9.81
const DT = 1 / 60

/**
 * A body with no damping launched at `speed` along a closed path, gravity alone driving it: its
 * energy per kilogram after each step (½v² + g·y, v the chord between two steps' points over the
 * step, y their middle's height) until it is back where it began, or a minute has gone: the
 * most it drifted from the first, J/kg, and its fastest speed.
 */
export async function energiesOverALap(path: [number, number, number][], speed: number) {
  const rig = await jointRig([0, -G, 0])
  const body = rig.cube(...path[0])
  body.physics = { type: 'dynamic', damping: { linear: 0, angular: 0 } }
  rig.wanted.add(joint.path(body, null, { path, loop: true, follow: false }))
  rig.run(1)
  const ahead = path[1].map((v, i) => v - path[0][i])
  const length = Math.hypot(...ahead)
  rig.writer.velocity(
    body.physics!._index,
    ahead.map((v) => (v / length) * speed),
  )
  let before = rig.at(body),
    travelled = 0,
    fastest = 0
  const energies: number[] = []
  const perimeter = path.reduce((sum, p, i) => sum + gap(p, path[(i + 1) % path.length]), 0)
  while (travelled < perimeter && energies.length < 60 * 60) {
    rig.run(1)
    const at = rig.at(body),
      step = gap(at, before)
    travelled += step
    fastest = Math.max(fastest, step / DT)
    energies.push(0.5 * (step / DT) ** 2 + (G * (at[1] + before[1])) / 2)
    before = at
  }
  const drift = Math.max(...energies.map((e) => Math.abs(e - energies[0])))
  return { drift, fastest, lapped: travelled >= perimeter }
}
