import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../../sdk-core/src/modules/sky/quality.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { blendShader } from '../../blend/shader.ts'
import { transmitWgsl } from '../../blend/transmission/transmitWgsl.ts'
import { airShapeOf } from '../../lighting/atmosphere/shape.ts'
import { heightFogWgsl } from '../../lighting/fog/fogPassWgsl.ts'
import {
  SEPARATE_BLUR_CODE,
  separateComposeWgsl,
  separateUpsampleWgsl,
} from '../../lighting/fog/separateWgsl.ts'
import { NO_SCENE_MASKS } from '../../lighting/rays/sceneTrace/sceneMaskPrograms.ts'
import { fogTemporalWgsl } from '../../lighting/fog/separateTemporalWgsl.ts'
import { composeProgram } from '../../modules/sky/clouds/composeWgsl.ts'
import { cloudTraceProgram } from '../../modules/sky/clouds/traceWgsl.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { resolveFogVolume } from '../../../../sdk-core/src/scene/volume/contracts.ts'
import {
  FOG_PROGRAMS,
  fogProgramsFor,
  fogGraphProgram,
  fogProgramsWithoutLocal,
} from '../../lighting/fog/programs.ts'
import {
  LOCAL_CULL_PROGRAM,
  LOCAL_CULL_PYRAMID_PROGRAM,
  LOCAL_SKY_PROGRAM,
} from '../../lighting/fog/localPrograms.ts'
import { voxelGraphSet } from '../../lighting/fog/voxelGraph.ts'
import { sunFogRenderWgsl } from '../../lighting/fog/sunFunction/renderWgsl.ts'
import { usableGraphStandalone } from '../../lighting/lightFunction/graphSlot.ts'

/** The voxelisation of fog objects that wear a graph: a density from a parameter and the time, and one
 *  that reads a texture at the cell's position. */
function fogGraphShader(textured: boolean) {
  const g = material.graph('volume')
  const read = textured
    ? g.channel(
        g.textureSample(new Texture(), { uv: g.componentMask(g.worldPosition(), 'rg') }),
        'r',
      )
    : g.channel(g.vectorParameter('density', [1, 1, 1, 1]), 'r')
  g.output('baseColor', g.constant(0.5, 0.5, 0.5))
  g.output('subsurfaceColor', g.multiply(read, g.constant(1, 1, 1)))
  g.output('emissive', g.multiply(g.constant(1, 0.5, 0.25), g.sine(g.time(), 2)))
  const set = voxelGraphSet([resolveFogVolume({ id: 'fixture', graph: g })])
  if (!set) throw new Error('the fog graph fixture does not compile')
  return fogGraphProgram(set)
}

/** The sun's light function drawn for the fog from a graph: a panned texture, or the sine of the time on a colour. */
function sunFogGraphShader(textured: boolean) {
  const g = material.graph('lightFunction')
  const colour = textured
    ? g.channel(g.textureSample(new Texture(), { uv: g.panner({ speed: [0.05, 0] }) }), 'rgb')
    : g.constant(1, 0.5, 0.25)
  g.output('emissive', g.multiply(colour, g.sine(g.time(), 2)))
  const graph = usableGraphStandalone(material.lightFunction({ graph: g }))
  if (!graph) throw new Error('the sun light function fixture does not compile')
  return sunFogRenderWgsl({ graph, mapped: false })
}

/** The texts of the fog's passes: the volume's (`../../lighting/fog/`), the pass that traces the lights' shadows, the voxelisation of the objects
 *  that wear a graph, and the local fog volumes' — the sky light's term written into the light buffer,
 *  the culling by tile with and without the depth pyramid (`../../lighting/fog/localPrograms.ts`). */
export const FOG_SHADERS = {
  ...Object.fromEntries(
    Object.entries(FOG_PROGRAMS).map(([name, code]) => [`FOG_${name.toUpperCase()}`, code]),
  ),
  // The sky scatters with the global field's coarse mip read through the hardware's filter (`float32-filterable`).
  FOG_SCATTERSKY_FILTERED_MIP: fogProgramsFor(true, true).scatterSky,
  FOG_SCATTERSKYSAMPLED_FILTERED_MIP: fogProgramsFor(true, true).scatterSkySampled,
  FOG_TRACED: fogTracedProgram(NO_SCENE_MASKS),
  FOG_SUN_FUNCTION_PLAIN: sunFogRenderWgsl({ mapped: false }),
  FOG_SUN_FUNCTION_MAPPED: sunFogRenderWgsl({ mapped: true }),
  FOG_SUN_FUNCTION_GRAPH: sunFogGraphShader(false),
  FOG_SUN_FUNCTION_GRAPH_TEXTURED: sunFogGraphShader(true),
  FOG_VOXELIZE_GRAPH: fogGraphShader(false),
  FOG_VOXELIZE_GRAPH_TEXTURED: fogGraphShader(true),
  FOG_LOCAL_SKY: LOCAL_SKY_PROGRAM,
  FOG_LOCAL_CULL: LOCAL_CULL_PROGRAM,
  FOG_LOCAL_CULL_PYRAMID: LOCAL_CULL_PYRAMID_PROGRAM,
  FOG_SEPARATE_COMPOSE: wgslModule(separateComposeWgsl(true)),
  FOG_SEPARATE_BLUR: SEPARATE_BLUR_CODE,
  FOG_SEPARATE_UPSAMPLE: separateUpsampleWgsl,
  FOG_SEPARATE_TEMPORAL: fogTemporalWgsl('rgba16float'),
  FOG_SEPARATE_TEMPORAL_PACKED: fogTemporalWgsl('rg11b10ufloat'),
}

/** The programs that lay the fog as a session whose project switch `localFogVolumeSupport` is off makes
 *  them (`rt.setup.localFog`): the fog volume's passes, the fog pass, the blend and its
 *  transmissive stages, the clouds' composition and trace. Swept like the rest: each
 *  declares every name it uses, with none of the local fog volumes' code. */
export const NO_LOCAL_FOG_SHADERS = {
  ...Object.fromEntries(
    Object.entries(fogProgramsWithoutLocal()).map(([name, code]) => [
      `FOG_NO_LOCAL_${name.toUpperCase()}`,
      code,
    ]),
  ),
  FOG_PASS_NO_LOCAL_FOG: wgslModule(heightFogWgsl(false)),
  FOG_SEPARATE_COMPOSE_NO_LOCAL_FOG: wgslModule(separateComposeWgsl(false)),
  BLEND_NO_LOCAL_FOG: blendShader({}, { localFog: false }),
  TRANSMIT_NO_LOCAL_FOG: blendShader({}, { stage: transmitWgsl({}, false), localFog: false }),
  ...noLocalAir(),
}

/** The clouds' programs of a session without the local fog volumes. */
function noLocalAir() {
  const shape = airShapeOf(resolveSettings(SKY_QUALITY_RULES, {}), false)
  return {
    CLOUD_COMPOSE_NO_LOCAL_FOG: composeProgram(
      { upsampling: 0, minMaxDepth: false, direct: false },
      false,
    ),
    CLOUD_TRACE_NO_LOCAL_FOG: cloudTraceProgram(
      {
        depth: 'scene',
        minMaxDepth: false,
        emptySpace: false,
        opaqueShadow: false,
        localLights: false,
        skyLight: false,
        volumeShadowMap: false,
        closestDepth: false,
        debugView: 0,
      },
      shape,
    ),
  }
}
