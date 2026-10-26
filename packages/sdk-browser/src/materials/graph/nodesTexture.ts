import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { NodeKind } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { coordinate } from './nodesInput.ts'
import { NEIGHBOURS, type State } from './state.ts'
import { coerce, constantOf, type Value } from './value.ts'

/** The code that reads the colour atlas slot held in the texture word `at` of the values. */
const slotWord = (at: number): Value => ({
  type: 'texture',
  code: `g.t[${at >> 2}].${'xyzw'[at & 3]}`,
})

/** The texture of a texture node, as the word of its slot: by the parameter's name when it has one. */
function textureValue(s: State, n: GraphNode): Value {
  const texture = s.graph.textures.get(n.id)
  if (!texture) throw graphError(`${n.kind} requires a texture`, { node: n.id })
  const name = (n.props.name as string) || undefined
  const key = name ? `parameter:${name}` : `texture:${texture.id}`
  return slotWord(s.slots.texture(key, texture, name))
}

/** The texture a sample reads: the one wired to it, else its own. */
function sampled(s: State, n: GraphNode): Value {
  const wired = s.input(n, 'texture')
  if (wired) {
    if (wired.type !== 'texture')
      throw graphError('Tex input requires a texture value', { node: n.id })
    return wired
  }
  return textureValue(s, n)
}

/** The coordinate a sample reads at the point `s` stands at: the one wired to it, else its own set's. */
function coordinateOf(s: State, n: GraphNode): Value {
  const wired = s.input(n, 'uv')
  return wired ? coerce(wired, 'f2') : coordinate(s, n.props.constCoordinate as number)
}

/** The level a sample reads: the one wired to it, else its own. */
const levelOf = (s: State, n: GraphNode) =>
  coerce(s.input(n, 'mip') ?? constantOf('flex', [n.props.constMip as number]), 'flex')

/** The footprint of one pixel on the coordinate `uv` of the sample `n`: the screen's derivatives
 *  of it, or its difference to the coordinate a pixel to the right and a pixel below
 *  (`NEIGHBOURS`), each read in the context the host fills there. A read met while the coordinate
 *  of another is read at one of those points takes the footprint it took at the centre, which that
 *  read was made first (its coordinate is read before its footprint): the quad's one derivative,
 *  never one of a neighbour's neighbours. */
function footprint(s: State, n: GraphNode, uv: Value): [string, string] {
  if (s.derivatives === 'screen') return [`dpdx(${uv.code})`, `dpdy(${uv.code})`]
  if (s.centre) {
    const held = s.footprints.get(n.id)
    if (!held) throw graphError('a texture read beside the centre has no footprint', { node: n.id })
    return [...held]
  }
  const [right, below] = NEIGHBOURS.map((context) => coordinateOf(s.at(context), n))
  const found: [string, string] = [`(${right.code}-${uv.code})`, `(${below.code}-${uv.code})`]
  s.footprints.set(n.id, found)
  return found
}

/** The footprint a sample reads at, scaled by `exp2(bias)` in a `bias` read. */
function readFootprint(s: State, n: GraphNode, uv: Value, level: Value) {
  const [dx, dy] = footprint(s, n, uv)
  return n.props.mipMode === 'bias'
    ? [`${dx}*exp2(${level.code})`, `${dy}*exp2(${level.code})`]
    : [dx, dy]
}

/** Notes that the sample `n` is read, once, as a tile request is made from the reads. */
function noteSample(s: State, n: GraphNode) {
  if (!s.samples.some((read) => read.node.id === n.id))
    s.samples.push({ node: n, output: s.output })
}

/** A read of the colour atlas at `uv`: the computed level, an absolute level, or a bias on the
 *  computed one. Its value is the four components of the colour. */
function textureSample(s: State, n: GraphNode): Value {
  s.uses.textures = true
  noteSample(s, n)
  const slot = sampled(s, n)
  const uv = coordinateOf(s, n)
  const level = levelOf(s, n)
  if (n.props.mipMode === 'level')
    return s.e.local('f4', `mgSampleLevel(${slot.code},${uv.code},${level.code})`)
  const [dx, dy] = readFootprint(s, n, uv, level)
  return s.e.local('f4', `colorSample(${slot.code},${uv.code},${dx},${dy},true)`)
}

/**
 * The expression of the tile the pixel's pick `p` asks of the read of the sample `n` (`missing`
 * says that only a tile the table does not hold is named): the request of the very texel the
 * sample reads, at the coordinate and the footprint it reads at, its lines in `s`. A read of an
 * absolute level asks the footprint of one texel of that level.
 */
export function sampleRequest(s: State, n: GraphNode): string {
  const slot = sampled(s, n)
  const uv = coordinateOf(s, n)
  const level = levelOf(s, n)
  const [dx, dy] =
    n.props.mipMode === 'level'
      ? [
          `vec2f(exp2(${level.code})/colorSlot(${slot.code}).size.x,0.0)`,
          `vec2f(0.0,exp2(${level.code})/colorSlot(${slot.code}).size.y)`,
        ]
      : readFootprint(s, n, uv, level)
  return `colorRequestIndex(${slot.code},${uv.code},${dx},${dy},p.next,p.along,true,true,missing)`
}

/** The nodes that hold or read a texture, by kind. */
export const TEXTURE_HANDLERS: Partial<Record<NodeKind, (s: State, n: GraphNode) => Value>> = {
  textureObject: textureValue,
  textureParameter: textureValue,
  textureSample,
}
