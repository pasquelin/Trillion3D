import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import {
  NOISE_FUNCTIONS,
  type NodeKind,
} from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { arithmetic } from './arith.ts'
import { cameraPosition, worldPosition } from './nodesInput.ts'
import type { State } from './state.ts'
import { coerce, type Value } from './value.ts'

/** The most levels a noise adds, and the fewest. */
const LEVELS = [1, 10] as const

/** The distance past which a world position repeats, so that a position far from the origin keeps the
 *  digits of its fraction. */
const POSITION_PERIOD = 65536

/** The position a noise reads: the one wired to it, in the world (a camera-relative one moved by the
 *  camera's position), else the world position repeated every `POSITION_PERIOD`. */
function positionOf(s: State, n: GraphNode): Value {
  const wired = s.input(n, 'position')
  if (!wired) {
    const at = worldPosition(s, n).code
    return s.e.local('f3', `(${POSITION_PERIOD}.0*fract(${at}/${POSITION_PERIOD}.0))`)
  }
  const position = coerce(wired, 'f3')
  if (!n.props.relativeToCamera) return position
  return arithmetic(s.e, '+', position, cameraPosition(s, n))
}

/** The sum of the levels of a noise function at a position (`mgNoise`): the node's properties are
 *  literals of the call. */
function noise(s: State, n: GraphNode): Value {
  const p = n.props as Record<string, number | boolean | string>
  const f = (name: string) => wgslF32(p[name] as number)
  const levels = clamp(Math.trunc(p.levels as number), LEVELS[0], LEVELS[1])
  const width = coerce(s.inputOr(n, 'filterWidth', 'constFilterWidth'), 'flex')
  s.uses.noise = true
  const call = [
    positionOf(s, n).code,
    f('scale'),
    `${Math.trunc(p.quality as number)}i`,
    `${NOISE_FUNCTIONS.indexOf(p.noiseFunction as (typeof NOISE_FUNCTIONS)[number])}i`,
    String(p.turbulence),
    `${levels}i`,
    f('outputMin'),
    f('outputMax'),
    f('levelScale'),
    width.code,
    String(p.tiling),
    f('repeatSize'),
  ]
  return s.e.local('flex', `mgNoise(${call.join(',')})`)
}

/** The nodes that make a noise, by kind. */
export const NOISE_HANDLERS: Partial<Record<NodeKind, (s: State, node: GraphNode) => Value>> = {
  noise,
}
