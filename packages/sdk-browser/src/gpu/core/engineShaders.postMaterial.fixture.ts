// The post-process materials' WGSL text of `ENGINE_SHADERS`: the module of a material with no graph, one of a graph that reads the scene
// textures (the image so far, the depths, the custom stencil), the time and a parameter, and the copy of the display chain onto the display image.
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { POST_COPY_WGSL } from '../../post/materials/postMaterials.ts'
import { usablePostProgram } from '../../post/materials/postProgram.ts'

/** The module of `built`, a post-process material, or the failure of its compile. */
function moduleOf(built: ReturnType<typeof material.postProcess>) {
  const program = usablePostProgram(built)
  if (!program) throw new Error('the post-process material fixture does not compile')
  return program.wgsl
}

function graphModule() {
  const g = material.graph('postProcess')
  const here = g.texCoord(0)
  const colour = g.sceneTexture('postProcessInput0', here, true)
  const depth = g.channel(g.sceneTexture('sceneDepth'), 'r')
  const custom = g.channel(g.sceneTexture('customDepth'), 'r')
  const stencil = g.channel(g.sceneTexture('customStencil'), 'r')
  const size = g.sceneTextureSize('sceneColor', true)
  const tint = g.vectorParameter('tint', [1, 0.5, 0.25, 1])
  const pulse = g.sine(g.time(), 2)
  const marked = g.lerp(
    g.channel(colour, 'rgb'),
    g.channel(tint, 'rgb'),
    g.multiply(stencil, pulse),
  )
  g.output(
    'emissive',
    g.add(marked, g.multiply(g.componentMask(size, 'r'), g.subtract(depth, custom))),
  )
  g.output('opacity', g.constant(0.5))
  return moduleOf(material.postProcess({ graph: g, blendableOutputAlpha: true }))
}

export const POST_MATERIAL_SHADERS: Record<string, string> = {
  POST_MATERIAL_PLAIN: moduleOf(material.postProcess()),
  POST_MATERIAL_GRAPH: graphModule(),
  POST_MATERIAL_COPY: POST_COPY_WGSL,
}
