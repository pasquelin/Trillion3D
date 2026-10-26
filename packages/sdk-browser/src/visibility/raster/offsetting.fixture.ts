import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'

/** A session whose surface offsets its vertices along its normal by its first texture coordinates and
 *  the time, or, with `texture`, by a texture read at them: every resource an offset reads. */
export const offsetting = (texture = true) => {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  const wind = texture
    ? g.channel(g.textureSample(new Texture(), { uv: g.texCoord(0) }), 'r')
    : g.componentMask(g.texCoord(0), 'r')
  g.output('worldPositionOffset', g.multiply(g.multiply(wind, g.vertexNormal()), g.time()))
  return graphRastersOf([{ graph: g }])
}
