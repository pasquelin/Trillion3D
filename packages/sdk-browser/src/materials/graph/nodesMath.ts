import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { NodeKind } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { missingInput } from '../../../../sdk-core/src/world/material/graph/validate.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import {
  arctangent2,
  arithmetic,
  clamp,
  extreme,
  lerp,
  power,
  remainder,
  saturate,
  type Operator,
} from './arith.ts'
import { ifValue } from './choose.ts'
import { cameraVector, pixelNormal } from './nodesInput.ts'
import { single } from './fold.ts'
import { coerce, constantOf, type Value } from './value.ts'
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
  (fn: ComponentFunction, input = 'input'): Handler =>
  (s, n) =>
    componentwise(s.e, fn, need(s, n, input))
const twoPi = (period: number) => single((2 * single(Math.PI)) / period)

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

/** The least base a fresnel's power takes: the facing of a normal longer than 1 passes 1 and the
 *  base goes negative, which its absolute value brings back; this keeps it off zero. */
const FRESNEL_FLOOR = 1e-4

/** How much of the reflectance a surface seen edge on keeps: the facing of the normal to the camera,
 *  brought to the power `exponent`, scaled into the range from `baseReflectFraction` to 1. */
function fresnel(s: State, n: GraphNode) {
  const e = s.e
  const normal = s.input(n, 'normal') ?? pixelNormal(s, n)
  const facing = extreme(e, 'max', constantOf('flex', [0]), dot(e, normal, cameraVector(s, n)))
  const edge = arithmetic(e, '-', constantOf('flex', [1]), facing)
  const base = extreme(
    e,
    'max',
    componentwise(e, COMPONENT_FUNCTIONS.abs, edge),
    constantOf('flex', [FRESNEL_FLOOR]),
  )
  const reflect = s.inputOr(n, 'baseReflectFraction', 'constBaseReflectFraction')
  const scale = arithmetic(e, '-', constantOf('flex', [1]), reflect)
  const lit = power(e, base, s.inputOr(n, 'exponent', 'constExponent'))
  return arithmetic(e, '+', arithmetic(e, '*', lit, scale), reflect)
}

/** A colour towards the grey of its luminance by the fraction, or the grey alone (a scalar) where
 *  no fraction is wired. */
function desaturation(s: State, n: GraphNode) {
  const colour = coerce(need(s, n, 'input'), 'f3')
  const grey = dot(s.e, colour, constantOf('f3', n.props.luminance as number[]))
  const fraction = s.input(n, 'fraction')
  return fraction ? lerp(s.e, colour, grey, fraction) : grey
}

/** `input` spread from the pivot by the amount. */
function contrast(s: State, n: GraphNode) {
  const pivot = s.inputOr(n, 'pivot', 'constPivot')
  const spread = arithmetic(
    s.e,
    '*',
    arithmetic(s.e, '-', need(s, n, 'input'), pivot),
    s.inputOr(n, 'amount', 'constAmount'),
  )
  return arithmetic(s.e, '+', spread, pivot)
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
  tangent: wave(COMPONENT_FUNCTIONS.tangent),
  arctangent2: (s, n) => arctangent2(s.e, need(s, n, 'y'), need(s, n, 'x')),
  fmod: pinPair((s, a, b) => remainder(s.e, a, b)),
  sqrt: each(COMPONENT_FUNCTIONS.sqrt),
  exp: each(COMPONENT_FUNCTIONS.exp),
  exp2: each(COMPONENT_FUNCTIONS.exp2),
  log: each(COMPONENT_FUNCTIONS.log),
  log2: each(COMPONENT_FUNCTIONS.log2, 'x'),
  log10: each(COMPONENT_FUNCTIONS.log10, 'x'),
  sign: each(COMPONENT_FUNCTIONS.sign),
  round: each(COMPONENT_FUNCTIONS.round),
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
  fresnel,
  desaturation,
  contrast,
}
