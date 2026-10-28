// The heterogeneous volumes' WGSL texts of `ENGINE_SHADERS`: the lighting cache and the march over the
// graph of a volume that reads a sparse volume texture, and the composition over the lit image.
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { compileGraph } from '../../materials/graph/compile.ts'
import { colorSampleWgsl, SHADOW_TILE_POOL_WGSL } from '../../materials/virtual/wgsl.ts'
import {
  compositeProgram,
  liveShadingProgram,
} from '../../lighting/heterogeneousVolumes/liveShadingProgram.ts'
import { PACK_WGSL } from '../../lighting/heterogeneousVolumes/beerShadowMapPackWgsl.ts'

/** A volume whose extinction and emission are a read of the sparse volume texture of the scene's node 0, its albedo a read of node 1's. */
const compiled = (() => {
  const g = material.graph('volume')
  const read = g.sparseVolumeTextureSample(0)
  g.output('subsurfaceColor', g.channel(read, 'rgb'))
  g.output('baseColor', g.channel(g.sparseVolumeTextureSample(1, { attributes: 1 }), 'rgb'))
  g.output('emissive', g.channel(read, 'rgb'))
  return compileGraph(g, {
    sample: colorSampleWgsl(SHADOW_TILE_POOL_WGSL),
    derivatives: 'neighbours',
    named: true,
  })
})()

export const HETEROGENEOUS_VOLUME_SHADERS: Record<string, string> = {
  HETEROGENEOUS_VOLUME: liveShadingProgram(compiled),
  HETEROGENEOUS_VOLUME_HOLDOUT: liveShadingProgram(compiled, 'rgba16float', true),
  HETEROGENEOUS_VOLUME_COMPOSE: compositeProgram(),
  HETEROGENEOUS_VOLUME_BEER_PACK: PACK_WGSL,
}
