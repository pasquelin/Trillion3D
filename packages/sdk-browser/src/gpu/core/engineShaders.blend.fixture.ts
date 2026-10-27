// The blend passes' shaders of the engine's shader fixture (`engineShaders.fixture.ts`): the transparent pass's graphs, its transmissive stages, the clipped and the per-vertex
// variants.

import { blendFrontShader } from '../../blend/frontStageWgsl.ts'
import { DIAGNOSTIC_BLEND_WGSL } from '../../diagnostic/gpuVariant.ts'
import { transmitWgsl } from '../../blend/transmission/transmitWgsl.ts'
import { blendShader, DEFAULT_TRANSLUCENT_SCENE } from '../../blend/shader.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'

const CLOUDS = { clouds: true, fog: false }
const FOG = { clouds: false, fog: true }
const CLOUDS_AND_FOG = { clouds: true, fog: true }

/** The program of a translucent surface's graph for the transparent pass: a tinted, panned texture
 *  at a set past the first, its opacity from the time, a normal, a thin transmission, the lobes, the
 *  specular and a refraction wired. */
function blendGraphPrograms() {
  const g = material.graph('surface')
  const uv = g.panner({ speed: [0.05, 0], coordinate: g.texCoord(2, 2, 2) })
  const read = g.textureSample(new Texture(), { uv })
  g.output('baseColor', g.channel(read, 'rgb'))
  g.output('opacity', g.multiply(g.channel(read, 'a'), g.sine(g.time(), 2)))
  g.output('normal', g.constant(0, 0, 1))
  g.output('subsurfaceColor', g.constant(0.5, 0.5, 0.5))
  g.output('anisotropy', g.constant(0.4))
  g.output('clearCoat', g.constant(0.5))
  g.output('specular', g.constant(0.7))
  g.output(
    'refraction',
    g.multiply(g.constant(1.33), g.add(g.constant(1), g.componentMask(g.cameraVector(), 'b'))),
  )
  const program = programOf({ graph: g, transparent: true })
  if (!isProgram(program)) throw new Error('the blend graph fixture does not compile')
  return [program]
}

export const BLEND_SHADERS: Record<string, string> = {
  // The transmissive stages (`../../blend/transmission/transmitWgsl.ts`), the dual blend where
  // the device grants it.
  BLEND_GRAPH: blendShader({}, { graphs: blendGraphPrograms() }),
  BLEND_GRAPH_LOBELESS: blendShader({ lobeless: true }, { graphs: blendGraphPrograms() }),
  BLEND_GRAPH_TRANSMIT: blendShader(
    {},
    { stage: transmitWgsl({}, false, blendGraphPrograms()), graphs: blendGraphPrograms() },
  ),
  FRONT_STAGE_GRAPH: blendFrontShader(2, undefined, blendGraphPrograms()),
  FRONT_STAGE_GRAPH_DEPTH: blendFrontShader(0, undefined, blendGraphPrograms()),
  BLEND_TRANSMIT: blendShader({}, { stage: transmitWgsl({}, false) }),
  BLEND_TRANSMIT_DUAL: blendShader({}, { stage: transmitWgsl({}, true), dual: true }),
  BLEND_TRANSMIT_LOBELESS: blendShader(
    { lobeless: true },
    { stage: transmitWgsl({ lobeless: true }, false) },
  ),
  BLEND_DIAGNOSTIC: blendShader({}, { diagnostic: DIAGNOSTIC_BLEND_WGSL }),
  // The forward passes' light loops without shadow or rectangle code (`createForwardVariants`).
  BLEND_UNSHADOWED_RECTLESS: blendShader({ unshadowed: true, rectless: true }),
  BLEND_RECTLESS: blendShader({ rectless: true }),
  BLEND_SUNLESS: blendShader({ sunless: true }),
  BLEND_LOCALLESS: blendShader({ localless: true }),
  // A scene whose blends carry no anisotropic or clear-coat lobe (`../../blend/physicalWgsl.ts`).
  BLEND_LOBELESS: blendShader({ lobeless: true }),
  BLEND_CLIP: blendShader({}, { clipping: 'distance' }),
  BLEND_CLIP_PIXEL: blendShader({}, { clipping: 'pixel' }),
  BLEND_TRANSMIT_CLIP: blendShader({}, { stage: transmitWgsl({}, false), clipping: 'distance' }),
  BLEND_TRANSMIT_CLIP_PIXEL: blendShader({}, { stage: transmitWgsl({}, false), clipping: 'pixel' }),
  // The programs that read the clouds per vertex (the project switch `cloudShadowOnTranslucent`, or
  // a scene with a surface whose material has `cloudFog`): the clouds' shade and the cloud image.
  BLEND_CLOUD_VERTEX: blendShader({}, { reads: CLOUDS }),
  BLEND_TRANSMIT_CLOUD_VERTEX: blendShader(
    {},
    { stage: transmitWgsl({}, true, undefined, CLOUDS), dual: true, reads: CLOUDS },
  ),
  // The programs of a scene with a surface whose material has contact shadows (`contactShadows`): their rays read the
  // opaque depth and flags, and the transmissive stages over them hold the same lights.
  BLEND_CONTACT: blendShader({}, { scene: { ...DEFAULT_TRANSLUCENT_SCENE, contact: true } }),
  BLEND_TRANSMIT_CONTACT: blendShader(
    {},
    {
      stage: transmitWgsl({}, true, undefined, undefined, false, {
        ...DEFAULT_TRANSLUCENT_SCENE,
        contact: true,
      }),
      dual: true,
      scene: { ...DEFAULT_TRANSLUCENT_SCENE, contact: true },
    },
  ),
  // The programs that lay the fog per vertex (a scene with a surface whose fog is not per pixel), with and
  // without the clouds, and the transmissive stages over them.
  BLEND_FOG_VERTEX: blendShader({}, { reads: FOG }),
  BLEND_CLOUD_FOG_VERTEX: blendShader({}, { reads: CLOUDS_AND_FOG }),
  BLEND_TRANSMIT_FOG_VERTEX: blendShader(
    {},
    {
      stage: transmitWgsl({}, true, undefined, CLOUDS_AND_FOG),
      dual: true,
      reads: CLOUDS_AND_FOG,
    },
  ),
  FRONT_STAGE_CLIP: blendFrontShader(2, 'distance'),
  FRONT_STAGE_CLIP_PIXEL: blendFrontShader(2, 'pixel'),
}
