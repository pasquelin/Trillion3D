import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { NodeKind } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { arithmetic } from './arith.ts'
import { componentwise, COMPONENT_FUNCTIONS, append, dot, mask } from './vector.ts'
import { constantOf, type Value } from './value.ts'
import type { State } from './state.ts'

type Handler = (s: State, node: GraphNode) => Value

/** The smallest difference of two tilings the coordinate treats as different. */
const SMALL_NUMBER = 1e-8

const coordinate = (index: number): Value => ({ type: 'f2', code: `ctx.uvs[${index}]` })
const flex = (x: number) => constantOf('flex', [x])
const gameTime = (s: State): Value => {
  s.uses.time = true
  return { type: 'flex', code: 'ctx.time' }
}

/** The texture coordinate set `index` times the tiling: a product only where the tiling is not 1. */
function texCoord(s: State, n: GraphNode) {
  s.uses.coordinates = true
  const { index, uTiling, vTiling } = n.props as Record<string, number>
  const base = coordinate(index)
  if (Math.abs(uTiling - vTiling) > SMALL_NUMBER)
    return arithmetic(s.e, '*', base, constantOf('f2', [uTiling, vTiling]))
  if (Math.abs(1 - uTiling) > SMALL_NUMBER) return arithmetic(s.e, '*', base, flex(uTiling))
  return base
}

function time(s: State, n: GraphNode): Value {
  const { ignorePause, overridePeriod, period } = n.props as Record<string, number | boolean>
  s.uses.time = true
  const clock = ignorePause ? 'ctx.realTime' : 'ctx.time'
  if (!overridePeriod) return { type: 'flex', code: clock }
  if (period === 0) return flex(0)
  return s.e.local('flex', `(${clock}%${constantOf('flex', [period as number]).code})`)
}

/** `coordinate` slid by the speed times the time, along u and then v. */
function panner(s: State, n: GraphNode) {
  const t = s.input(n, 'time') ?? gameTime(s)
  const speed = s.input(n, 'speed')
  const x = speed ? mask(s.e, speed, 'r') : flex(n.props.speedX as number)
  const y = speed ? mask(s.e, speed, 'g') : flex(n.props.speedY as number)
  const slide = (v: Value) => {
    const moved = arithmetic(s.e, '*', t, v)
    return n.props.fractionalPart ? componentwise(s.e, COMPONENT_FUNCTIONS.frac, moved) : moved
  }
  const at = s.input(n, 'coordinate') ?? coordinate(n.props.constCoordinate as number)
  return arithmetic(s.e, '+', append(s.e, slide(x), slide(y)), at)
}

/** `coordinate` turned about the centre by the speed times the time. */
function rotator(s: State, n: GraphNode) {
  const t = s.input(n, 'time') ?? gameTime(s)
  const angle = arithmetic(s.e, '*', t, flex(n.props.speed as number))
  const cos = componentwise(s.e, COMPONENT_FUNCTIONS.cosine, angle)
  const sin = componentwise(s.e, COMPONENT_FUNCTIONS.sine, angle)
  const rowX = append(s.e, cos, arithmetic(s.e, '*', flex(-1), sin))
  const rowY = append(s.e, sin, cos)
  const origin = constantOf('f2', [n.props.centerX as number, n.props.centerY as number])
  const base = s.input(n, 'coordinate') ?? coordinate(n.props.constCoordinate as number)
  const flat = arithmetic(s.e, '-', mask(s.e, base, 'rg'), origin)
  const turned = append(s.e, dot(s.e, rowX, flat), dot(s.e, rowY, flat))
  if (base.type === 'f3')
    return append(s.e, arithmetic(s.e, '+', turned, origin), mask(s.e, base, 'b'))
  const around = arithmetic(s.e, '-', base, origin)
  return arithmetic(s.e, '+', append(s.e, dot(s.e, rowX, around), dot(s.e, rowY, around)), origin)
}

function parameter(s: State, n: GraphNode): Value {
  const scalar = n.kind === 'scalarParameter'
  const initial = scalar ? [n.props.value as number] : (n.props.value as number[])
  const at = s.slots.vector(n.props.name as string, scalar, initial)
  return scalar ? { type: 'flex', code: `g.v[${at}].x` } : { type: 'f4', code: `g.v[${at}]` }
}

/** What a domain has at its points: a light function's atlas slot is drawn once for every light and
 *  view, so it has no world position, camera or normal, and its light's position reads as zero. */
const WORLD_DOMAINS: Record<string, readonly string[]> = {
  lightFunction: ['objectPosition'],
  volume: ['worldPosition', 'cameraPosition', 'objectPosition'],
  surface: ['worldPosition', 'cameraPosition', 'objectPosition', 'vertexNormal', 'pixelNormal'],
}

const world =
  (field: string, kind: string, normal: boolean): Handler =>
  (s, n) => {
    if (!WORLD_DOMAINS[s.domain].includes(kind))
      throw graphError(`${kind} has no value in the ${s.domain} domain`, { node: n.id })
    if (s.domain === 'lightFunction') return constantOf('f3', [0, 0, 0])
    if (kind === 'pixelNormal' && s.output === 'normal')
      throw graphError('Invalid node pixelNormal used for the normal output.', { node: n.id })
    s.uses[normal ? 'normal' : 'position'] = true
    return n.props.cameraRelative
      ? s.e.local('f3', `(ctx.${field}-ctx.eye)`)
      : { type: 'f3', code: `ctx.${field}` }
  }

/** The nodes that bring a value in, by kind. */
export const INPUT_HANDLERS: Partial<Record<NodeKind, Handler>> = {
  constant: (s, n) => {
    const value = n.props.value as number[]
    return constantOf(value.length === 1 ? 'flex' : (`f${value.length}` as Value['type']), value)
  },
  scalarParameter: parameter,
  vectorParameter: parameter,
  texCoord,
  time,
  panner,
  rotator,
  worldPosition: world('world', 'worldPosition', false),
  cameraPosition: world('eye', 'cameraPosition', false),
  objectPosition: world('origin', 'objectPosition', false),
  vertexNormal: world('vertexNormal', 'vertexNormal', true),
  pixelNormal: world('pixelNormal', 'pixelNormal', true),
}
