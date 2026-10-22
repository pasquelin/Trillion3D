import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import type { NodeKind } from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import type { State } from './state.ts'
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

/** The footprint of the read: from the screen's derivatives of `uv` or the host's, scaled by
 *  `scale` (a level bias) when given. */
function footprint(s: State, uv: Value, scale?: string) {
  const [dx, dy] =
    s.derivatives === 'screen' ? [`dpdx(${uv.code})`, `dpdy(${uv.code})`] : ['ctx.ddx', 'ctx.ddy']
  return scale ? [`${dx}*exp2(${scale})`, `${dy}*exp2(${scale})`] : [dx, dy]
}

/** A read of the colour atlas at `uv`: the computed level, an absolute level, or a bias on the
 *  computed one. Its value is the four components of the colour. */
function textureSample(s: State, n: GraphNode): Value {
  s.uses.textures = true
  const slot = sampled(s, n)
  const index = n.props.constCoordinate as number
  const uv = s.input(n, 'uv')
    ? coerce(s.input(n, 'uv')!, 'f2')
    : { type: 'f2' as const, code: `ctx.uvs[${index}]` }
  const mode = n.props.mipMode
  const level = coerce(
    s.input(n, 'mip') ?? constantOf('flex', [n.props.constMip as number]),
    'flex',
  )
  const asked = mode === 'level' ? level.code : undefined
  if (asked) return s.e.local('f4', `mgSampleLevel(${slot.code},${uv.code},${asked})`)
  const [dx, dy] = footprint(s, uv, mode === 'bias' ? level.code : undefined)
  return s.e.local('f4', `colorSample(${slot.code},${uv.code},${dx},${dy},true)`)
}

/** The nodes that hold or read a texture, by kind. */
export const TEXTURE_HANDLERS: Partial<Record<NodeKind, (s: State, n: GraphNode) => Value>> = {
  textureObject: textureValue,
  textureParameter: textureValue,
  textureSample,
}
