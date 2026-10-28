import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { blendShader } from '../../blend/shader.ts'
import { blendFrontShader } from '../../blend/frontStageWgsl.ts'
import { vsmRenderRasterWgsl } from '../../lighting/shadows/vsm/render/renderRasterWgsl.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import { vsmRenderVoxelWgsl } from '../../lighting/shadows/vsm/render/renderVoxelWgsl.ts'
import { visVoxelShader } from '../../visibility/shader/visVoxelWgsl.ts'
import { shadeShader } from '../../visibility/shader/shadeWgsl.ts'
import { visShader } from '../../visibility/shader/visWgsl.ts'
import { rasterSource } from '../../visibility/raster/shader.ts'
import {
  blendWpo,
  diceWpo,
  shadeWpo,
  patchWpo,
  shadowSplitWpo,
  shadowWpo,
  tessellationWpo,
  visibilityWpo,
  voxelWpo,
} from '../../visibility/shader/wpoSets.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { graphRastersOf, type GraphRasters } from '../../materials/graph/graphRasters.ts'
import { NO_MASKS } from '../../materials/graph/maskProgram.ts'
import { seedSource } from '../../visibility/tessellation/seedWgsl.ts'
import { splitSource } from '../../visibility/tessellation/splitWgsl.ts'
import { diceSource } from '../../visibility/tessellation/diceWgsl.ts'
import { vsmTessSource } from '../../lighting/shadows/vsm/tessellation/shadowKernelsWgsl.ts'
import { vsmTessDiceWgsl } from '../../lighting/shadows/vsm/tessellation/shadowDiceWgsl.ts'
import { velocityWpo } from '../../post/taa/velocityWpo.ts'
import { velocityShader } from '../../post/taa/nearestVelocityWgsl.ts'
import { surfaceVelocityShader } from '../../post/taa/surfaceVelocityWgsl.ts'

/**
 * A graph that sways a surface: the offset leans with the normal by a parameter and swings along a
 * direction by the time, the position and the camera, weighted by the second coordinate of the
 * first texture set — every input a vertex has (`wpoGraphWgsl.ts`) —, and whose colour reads a texture.
 */
function swayGraph() {
  const g = material.graph('surface')
  // The colour reads a texture: the programs of both passes hold the colour atlas, which the modules
  // that place a vertex without it (the binning, the shadow raster) must not pull in with the offset.
  g.output('baseColor', g.channel(g.textureSample(new Texture()), 'rgb'))
  const weight = g.componentMask(g.texCoord(0), 'g')
  const where = g.add(
    g.componentMask(g.worldPosition(), 'r'),
    g.componentMask(g.cameraPosition(), 'b'),
  )
  const swing = g.multiply(g.sine(g.add(g.time(), where), 2), weight)
  const lean = g.multiply(g.vertexNormal(), g.scalarParameter('lean', 0.05))
  g.output('worldPositionOffset', g.add(g.multiply(swing, g.constant(0.2, 0, 0.1)), lean))
  return g
}

/** A graph whose offset is a texture read: the red of a map along the normal, weighted by the time. */
function texturedGraph() {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  const wind = g.channel(g.textureSample(new Texture(), { uv: g.panner({ speed: [0.1, 0] }) }), 'r')
  g.output(
    'worldPositionOffset',
    g.multiply(g.multiply(wind, g.vertexNormal()), g.sine(g.time(), 2)),
  )
  return g
}

/** A graph whose offset reads the vertex colour: the green of it along the normal. The transparent
 *  pass has no varying for the colour, so only the opaque programs hold this graph. */
function colouredGraph() {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output(
    'worldPositionOffset',
    g.multiply(g.vertexNormal(), g.componentMask(g.vertexColor(), 'g')),
  )
  return g
}

/** The modules that place a vertex, over the offset of a surface that sways (`swayGraph`), then, under
 *  a `_TEXTURED` name, those that bind the colour atlas for a vertex stage to read over the offset of
 *  `texturedGraph`: each holds the offsets known when it is made, as the engine's make them
 *  (`../../visibility/shader/wpoSets.ts`). */
export function wpoShaders(): Record<string, string> {
  const g = swayGraph()
  const resolve = programOf({ graph: g })
  const blend = programOf({ graph: g, transparent: true })
  if (!isProgram(resolve) || !isProgram(blend))
    throw new Error('the offset graph fixture does not compile')
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 })
  // The session's surfaces wear both programs: the modules hold the offsets of both.
  const rasters = graphRastersOf([{ graph: g }, { graph: g, transparent: true }])
  const offsets = blendWpo(rasters, [blend])
  return {
    VIS_WPO: visShader({ wpo: visibilityWpo(rasters) }),
    RASTER_WPO: rasterSource(undefined, visibilityWpo(rasters)),
    SHADE_GRAPH_WPO: shadeShader({ graph: resolve.compiled, wpo: shadeWpo(rasters, resolve) }),
    VSM_RENDER_RASTER_WPO: vsmRenderRasterWgsl(layout, undefined, shadowWpo(rasters)),
    VIS_VOXEL_WPO: visVoxelShader(undefined, voxelWpo(rasters)),
    VIS_VOXEL_CLIP_WPO: visVoxelShader('distance', voxelWpo(rasters)),
    VSM_RENDER_VOXEL_WPO: vsmRenderVoxelWgsl(layout, voxelWpo(rasters)),
    BLEND_WPO: blendShader({}, { graphs: [blend], offsets }),
    BLEND_WPO_LOBELESS: blendShader({ lobeless: true }, { graphs: [blend], offsets }),
    FRONT_STAGE_WPO: blendFrontShader(2, undefined, [blend], offsets),
    FRONT_STAGE_WPO_DEPTH: blendFrontShader(0, undefined, [blend], offsets),
    TAA_VELOCITY_WPO: velocityShader(velocityWpo(rasters)),
    TAA_SURFACE_VELOCITY_WPO: surfaceVelocityShader(velocityWpo(rasters)),
    ...tessellationShaders(rasters, layout, 'WPO'),
    ...texturedWpoShaders(),
    ...colouredWpoShaders(),
  }
}

/** The modules of `wpoShaders` over an offset that reads the vertex colour, the opaque passes'
 *  alone (`colouredGraph`). */
function colouredWpoShaders(): Record<string, string> {
  const g = colouredGraph()
  const resolve = programOf({ graph: g })
  if (!isProgram(resolve)) throw new Error('the coloured offset graph fixture does not compile')
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 })
  const rasters = graphRastersOf([{ graph: g }])
  return {
    VIS_WPO_COLOURED: visShader({ wpo: visibilityWpo(rasters) }),
    RASTER_WPO_COLOURED: rasterSource(undefined, visibilityWpo(rasters)),
    SHADE_GRAPH_WPO_COLOURED: shadeShader({
      graph: resolve.compiled,
      wpo: shadeWpo(rasters, resolve),
    }),
    VSM_RENDER_RASTER_WPO_COLOURED: vsmRenderRasterWgsl(layout, undefined, shadowWpo(rasters)),
  }
}

/** The modules of `wpoShaders` over an offset that reads a texture, which a vertex stage reads where
 *  the device grants the room (`grantsVertexTextures`). */
function texturedWpoShaders(): Record<string, string> {
  const g = texturedGraph()
  const resolve = programOf({ graph: g })
  const blend = programOf({ graph: g, transparent: true })
  if (!isProgram(resolve) || !isProgram(blend))
    throw new Error('the textured offset graph fixture does not compile')
  const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 127, sunMapCapacity: 35 })
  const rasters = graphRastersOf([{ graph: g }, { graph: g, transparent: true }])
  return {
    VIS_WPO_TEXTURED: visShader({ wpo: visibilityWpo(rasters) }),
    RASTER_WPO_TEXTURED: rasterSource(undefined, visibilityWpo(rasters)),
    VSM_RENDER_RASTER_WPO_TEXTURED: vsmRenderRasterWgsl(layout, undefined, shadowWpo(rasters)),
    VIS_VOXEL_WPO_TEXTURED: visVoxelShader(undefined, voxelWpo(rasters)),
    VSM_RENDER_VOXEL_WPO_TEXTURED: vsmRenderVoxelWgsl(layout, voxelWpo(rasters)),
    BLEND_WPO_TEXTURED: blendShader({}, { graphs: [blend], offsets: blendWpo(rasters, [blend]) }),
    TAA_VELOCITY_WPO_TEXTURED: velocityShader(velocityWpo(rasters)),
    ...tessellationShaders(rasters, layout, 'WPO_TEXTURED', true),
  }
}

/** The tessellation's modules over the offsets of `rasters`, named `name`: the image's seeding, splitting
 *  and dicing, the shadow maps' splitting and their dicing (offsets that read no texture alone, so none for `textured` ones). */
function tessellationShaders(
  rasters: GraphRasters,
  layout: ReturnType<typeof vsmLayout>,
  name: string,
  textured = false,
): Record<string, string> {
  return {
    [`TESSELLATION_SEED_${name}`]: seedSource(tessellationWpo(rasters)),
    [`TESSELLATION_SPLIT_${name}`]: splitSource(false, tessellationWpo(rasters)),
    [`TESSELLATION_DICE_${name}`]: diceSource(NO_MASKS, diceWpo(rasters)),
    // Offsets that read a texture reach neither the shadow maps' splitting, whose stage has no room for the colour atlas,
    // nor their dicing, which places the corners as the splitting judged them.
    ...(textured
      ? {}
      : {
          [`VSM_TESSELLATION_${name}`]: vsmTessSource(layout, shadowSplitWpo(rasters)),
          [`VSM_TESSELLATION_DICE_${name}`]: vsmTessDiceWgsl(layout, undefined, patchWpo(rasters)),
        }),
  }
}
