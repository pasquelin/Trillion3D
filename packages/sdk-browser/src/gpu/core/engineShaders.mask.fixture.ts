import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { cameraMasks, shadowMasks } from '../../visibility/shader/maskSets.ts'
import { diceMasks } from '../../visibility/tessellation/diceMasks.ts'

/** The graph outputs of a session whose surface cuts by a panned, tiled texture's alpha times a wave
 *  of the time: what the rasters' modules hold the functions of (`GraphRasters`). */
function maskGraphRasters() {
  const g = material.graph('surface')
  const uv = g.panner({ speed: [0.05, 0], coordinate: g.texCoord(0, 4, 4) })
  const read = g.textureSample(new Texture(), { uv })
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('opacityMask', g.multiply(g.channel(read, 'a'), g.sine(g.time(), 2)))
  const rasters = graphRastersOf([{ graph: g }])
  if (!rasters.pixelPrograms.length) throw new Error('the mask graph fixture does not compile')
  return rasters
}

/** The mask sets of each kind of pass over those outputs (`maskSets.ts`, `diceMasks.ts`). */
export function maskGraphSets() {
  const rasters = maskGraphRasters()
  return {
    camera: cameraMasks(rasters),
    shadow: shadowMasks(rasters),
    shadowVertex: shadowMasks(rasters, false),
    dice: diceMasks(rasters),
  }
}
