import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { NodeKind } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { missingInput } from '../../../../sdk-core/src/world/material/graph/validate.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { arithmetic, clamp, extreme, lerp, power, saturate, type Operator } from './arith.ts'
import { ifValue } from './choose.ts'
import { constantOf, type Value } from './value.ts'
import type { State } from './state.ts'
import {
  append,
  COMPONENT_FUNCTIONS,
  componentwise,
  cross,
  dot,
  length,
  mask,
  normalize,
  type ComponentFunction,
} from './vector.ts'

type Handler = (s: State, node: GraphNode) => Value

/** The input a node cannot be compiled without. */
function need(s: State, node: GraphNode, name: string): Value {
  const value = s.input(node, name)
  if (!value) throw graphError(missingInput(node.kind, name), { node: node.id })
  return value
}

const pairOp =
  (op: Operator): Handler =>
  (s, n) =>
    arithmetic(s.e, op, s.inputOr(n, 'a', 'constA'), s.inputOr(n, 'b', 'constB'))
const pick =
  (which: 'min' | 'max'): Handler =>
  (s, n) =>
    extreme(s.e, which, s.inputOr(n, 'a', 'constA'), s.inputOr(n, 'b', 'constB'))
const each =
  (fn: ComponentFunction): Handler =>
  (s, n) =>
    componentwise(s.e, fn, need(s, n, 'input'))
const twoPi = (period: number) => Math.fround((2 * Math.fround(Math.PI)) / period)

/** A sine or cosine: the input is in turns of the period when it is above 0, radians otherwise. */
const wave =
  (fn: ComponentFunction): Handler =>
  (s, n) => {
    const x = need(s, n, 'input')
    const period = n.props.period as number
    const scaled = period > 0 ? arithmetic(s.e, '*', x, constantOf('flex', [twoPi(period)])) : x
    return componentwise(s.e, fn, scaled)
  }

function clampNode(s: State, n: GraphNode) {
  const x = need(s, n, 'input')
  const low = s.inputOr(n, 'min', 'constMin')
  const high = s.inputOr(n, 'max', 'constMax')
  if (n.props.mode === 'min') return extreme(s.e, 'max', x, low)
  if (n.props.mode === 'max') return extreme(s.e, 'min', x, high)
  return clamp(s.e, x, low, high)
}

function ifNode(s: State, n: GraphNode) {
  const threshold = constantOf('flex', [n.props.equalsThreshold as number])
  return ifValue(s.e, {
    a: need(s, n, 'a'),
    b: s.inputOr(n, 'b', 'constB'),
    greater: need(s, n, 'aGreaterThanB'),
    equal: s.input(n, 'aEqualsB'),
    less: need(s, n, 'aLessThanB'),
    threshold,
  })
}

const pinPair =
  (fn: (s: State, a: Value, b: Value) => Value): Handler =>
  (s, n) =>
    fn(s, need(s, n, 'a'), need(s, n, 'b'))

/** The nodes that compute, by kind. */
export const MATH_HANDLERS: Partial<Record<NodeKind, Handler>> = {
  add: pairOp('+'),
  subtract: pairOp('-'),
  multiply: pairOp('*'),
  divide: pairOp('/'),
  min: pick('min'),
  max: pick('max'),
  power: (s, n) => power(s.e, need(s, n, 'base'), s.inputOr(n, 'exponent', 'constExponent')),
  abs: each(COMPONENT_FUNCTIONS.abs),
  floor: each(COMPONENT_FUNCTIONS.floor),
  ceil: each(COMPONENT_FUNCTIONS.ceil),
  frac: each(COMPONENT_FUNCTIONS.frac),
  sine: wave(COMPONENT_FUNCTIONS.sine),
  cosine: wave(COMPONENT_FUNCTIONS.cosine),
  saturate: (s, n) => saturate(s.e, need(s, n, 'input')),
  oneMinus: (s, n) => arithmetic(s.e, '-', constantOf('flex', [1]), need(s, n, 'input')),
  clamp: clampNode,
  lerp: (s, n) =>
    lerp(
      s.e,
      s.inputOr(n, 'a', 'constA'),
      s.inputOr(n, 'b', 'constB'),
      s.inputOr(n, 'alpha', 'constAlpha'),
    ),
  normalize: (s, n) => normalize(s.e, need(s, n, 'input')),
  length: (s, n) => length(s.e, need(s, n, 'input')),
  dot: pinPair((s, a, b) => dot(s.e, a, b)),
  cross: pinPair((s, a, b) => cross(s.e, a, b)),
  appendVector: pinPair((s, a, b) => append(s.e, a, b)),
  componentMask: (s, n) => {
    const letters = [...'rgba'].filter((c) => n.props[c]).join('')
    return mask(s.e, need(s, n, 'input'), letters)
  },
  if: ifNode,
}
