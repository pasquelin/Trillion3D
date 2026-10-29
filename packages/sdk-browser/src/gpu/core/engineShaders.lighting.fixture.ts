// The light functions', occlusion, distance fields' and primed pyramid's WGSL texts of `ENGINE_SHADERS`.
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { LIGHT_GRID_DEBUG_WGSL } from '../../lighting/tiles/debug/gridDebugWgsl.ts'
import { sssDebugPixelWgsl } from '../../lighting/subsurface/debugPixel.ts'
import { SSS_VISUALIZE_WGSL } from '../../lighting/subsurface/visualizeWgsl.ts'
import { imageProgram } from '../../lighting/bounce/reservoirGather/imageWgsl.ts'
import { resampleProgram } from '../../lighting/bounce/reservoirGather/resampleWgsl.ts'
import {
  FIELD_OFFSETS_PROGRAM,
  GBUFFER_OFFSETS_PROGRAM,
} from '../../lighting/bounce/irradianceField/offsetsWgsl.ts'
import { MARK_HAIR_SHADER } from '../../lighting/bounce/pool/poolMarkHairWgsl.ts'
import { EYE_MARK_SHADER } from '../../lighting/surfaceCache/sceneDebug/eyeMarker.ts'
import { radianceProbeListWgsl } from '../../lighting/surfaceCache/sceneDebug/radianceProbesWgsl.ts'
import { DISTANCE_FIELD_KERNEL_WGSL } from '../../../../sdk-core/src/lighting/distanceFieldKernel.ts'
import {
  CAPTURE_COPY_CODE,
  CAPTURE_DIFFUSE_CODE,
} from '../../lighting/reflectionCapture/captureWgsl.ts'
import { VOLUMETRIC_LIGHT_WGSL } from '../../lighting/deferred/volumetricLightWgsl.ts'
import { lightFunctionRenderWgsl } from '../../lighting/lightFunction/renderWgsl.ts'
import { graphSlotWgsl, graphSlotOf } from '../../lighting/lightFunction/graphSlot.ts'
import { aoShaders } from '../../lighting/ao/shaders.fixture.ts'
import { AO_SETUP_WGSL } from '../../lighting/ao/setupWgsl.ts'
import { AO_SMOOTH_WGSL } from '../../lighting/ao/smoothWgsl.ts'
import {
  HORIZON_SPATIAL_WGSL,
  HORIZON_TEMPORAL_WGSL,
  HORIZON_UPSAMPLE_WGSL,
} from '../../lighting/ao/horizon/filterWgsl.ts'
import { DFAO_SHADERS } from '../../lighting/distanceField/ao/shaders.ts'
import { DFSH_SHADERS } from '../../lighting/distanceField/shadow/shaders.ts'
import { ALLOCATE_SHADER, LISTS_SHADER } from '../../lighting/distanceField/allocateWgsl.ts'
import { composeShader } from '../../lighting/distanceField/composeWgsl.ts'
import { coverageShader } from '../../lighting/distanceField/coverageWgsl.ts'
import {
  CULL_CLIPMAP_SHADER,
  CULL_GRID_SHADER,
  GRID_TILES_SHADER,
} from '../../lighting/distanceField/cullWgsl.ts'
import { FILL_SHADER, mipShader } from '../../lighting/distanceField/mipWgsl.ts'
import { OBJECT_GRID_SHADER } from '../../lighting/distanceField/objectGridWgsl.ts'
import { STREAMING_SHADER } from '../../lighting/distanceField/streamingWgsl.ts'
import { HIZ_PRIMED_SHADER } from '../../visibility/hiz/gpu/primedWgsl.ts'
import {
  sssArgsProgram,
  sssComputeProgram,
  sssRasterProgram,
} from '../../lighting/subsurface/programs.ts'
import type { SubsurfaceShape } from '../../lighting/subsurface/shape.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { UNLIT_LIGHTING_SHADER, litPassShaders } from './shaderTexts.fixture.ts'
import { CLASSIFY_WGSL } from '../../lighting/deferred/classifyWgsl.ts'
import { indirectPassWgsl } from '../../lighting/deferred/indirectPassWgsl.ts'
import { localPassWgsl, sunPassWgsl } from '../../lighting/deferred/lightPassWgsl.ts'
import {
  cubeAverageShader,
  cubeFilterShader,
} from '../../lighting/deferred/ambientCubemapFilterWgsl.ts'
import { perLightPassWgsl } from '../../lighting/deferred/perLightPassWgsl.ts'
import { FULL_CONTRACT } from '../../lighting/deferred/contractCuts.ts'
import { TILE_CLASS_NAMES, TILE_CLASSES } from '../../lighting/deferred/tileClass.ts'

/** A light function slot drawn from a graph: a panned, tinted texture (the atlas bound, the time
 *  read), or the sine of the time on a colour (nothing bound). */
function graphSlotShader(textured: boolean) {
  const g = material.graph('lightFunction')
  const colour = textured
    ? g.channel(g.textureSample(new Texture(), { uv: g.panner({ speed: [0.05, 0] }) }), 'rgb')
    : g.constant(1, 0.5, 0.25)
  g.output('emissive', g.multiply(colour, g.sine(g.time(), 2)))
  const slot = graphSlotOf(material.lightFunction({ graph: g }))
  if (!slot || !('compiled' in slot)) throw new Error('the graph slot fixture does not compile')
  return graphSlotWgsl(128, 'colour', slot)
}

/** The narrow lists' key, without lobe code (`contractCuts.ts`). */
const NARROW = { narrow: true, lobeless: true }

/** The passes that light an image, each its own text (`litPassShaders`): at the keys a frame asks for —
 *  the wide ones with and without bounce, the narrow, the unshadowed and rectless, the sky light
 *  under the distance fields' occlusion, the lobed ones — and for each class of tile
 *  (`../../lighting/deferred/tileClass.ts`), then the passes that need no key. */
function lightPassShaders() {
  const out: Record<string, string> = {}
  const named = (
    name: string,
    bounce: boolean,
    key: Parameters<typeof litPassShaders>[1],
    sky = false,
  ) => {
    const { sun, local, indirect } = litPassShaders(bounce, key, sky)
    Object.assign(out, {
      [`SUN_${name}`]: sun,
      [`LOCAL_${name}`]: local,
      [`INDIRECT_${name}`]: indirect,
    })
  }
  named('DIRECT', false, { lobeless: true })
  named('BOUNCE', true, { lobeless: true })
  named('DIRECT_NARROW', false, NARROW)
  named('BOUNCE_NARROW_RECTLESS', true, { ...NARROW, rectless: true })
  // With neither shadow nor rectangle code (#1249, #1369): each branch they drop names nothing left.
  named('DIRECT_UNSHADOWED_RECTLESS', false, { unshadowed: true, rectless: true, lobeless: true })
  // The lobed class (`lobesWgsl.ts`), and the sky light under the distance fields' occlusion.
  named('DIRECT_LOBES', false, {})
  named('BOUNCE_LOBES', true, {})
  named('DIRECT_SKY_SHADOWING', false, { lobeless: true }, true)
  named('DIRECT_SKY_SHADOWING_LOBES', false, {}, true)
  // Each class of tile: the code its pixels need and no more.
  for (const tileClass of TILE_CLASSES) {
    const name = TILE_CLASS_NAMES[tileClass]
    Object.assign(out, {
      [`SUN_CLASS_${name}`]: wgslModule(sunPassWgsl(FULL_CONTRACT, tileClass)),
      [`LOCAL_CLASS_${name}`]: wgslModule(localPassWgsl(FULL_CONTRACT, tileClass)),
      // The per-light path (`shadowOnePassProjection` false): the local lights' pass without the shadowed lights, and the draw of one.
      [`LOCAL_UNBATCHED_CLASS_${name}`]: wgslModule(
        localPassWgsl(FULL_CONTRACT, tileClass, { skipHeld: true }),
      ),
      [`PER_LIGHT_CLASS_${name}`]: wgslModule(perLightPassWgsl(FULL_CONTRACT, tileClass)),
      [`INDIRECT_CLASS_${name}`]: wgslModule(
        indirectPassWgsl({ bounce: true, skyShadowing: false, tileClass }),
      ),
      [`INDIRECT_SKY_SHADOWING_CLASS_${name}`]: wgslModule(
        indirectPassWgsl({ bounce: false, skyShadowing: true, tileClass }),
      ),
    })
  }
  return out
}

/** The lit image's passes: the classification of the surfaces into tiles, the first pass, the lights
 *  and the indirect light by key and by class, the fog. */
const { colour, fog } = litPassShaders(false)
export const LIT_PASS_SHADERS: Record<string, string> = {
  TILE_CLASSIFICATION_SHADER: CLASSIFY_WGSL,
  SURFACE_COLOUR_SHADER: colour,
  UNLIT_SURFACE_SHADER: UNLIT_LIGHTING_SHADER,
  ...lightPassShaders(),
  HEIGHT_FOG_SHADER: fog,
  VOLUMETRIC_LIGHT_SHADER: wgslModule(VOLUMETRIC_LIGHT_WGSL),
}

/** The subsurface pass at the settings' defaults: the sampled scattering at the full size, the high sample set. */
const SSS_SHAPE: SubsurfaceShape = {
  half: false,
  forceSeparable: false,
  cache: true,
  sampleSet: 2,
  bilateral: true,
  high: true,
  checker: false,
  filter: true,
}

export const LIGHTING_SHADERS: Record<string, string> = {
  // The subsurface scattering's three modules (`../../lighting/subsurface/`).
  SSS_COMPUTE: sssComputeProgram(SSS_SHAPE, false),
  SSS_ARGS: sssArgsProgram(SSS_SHAPE),
  SSS_RASTER: sssRasterProgram(SSS_SHAPE),
  SSS_DEBUG_PIXEL: sssDebugPixelWgsl(SSS_SHAPE),
  SSS_VISUALIZE: SSS_VISUALIZE_WGSL,
  // The reservoirs' resampling and pixels, the field's probe offsets, the marks of the eye and of the strands, the probes' list of the scene view.
  RESERVOIR_RESAMPLE: resampleProgram(),
  RESERVOIR_IMAGE: imageProgram(),
  FIELD_OFFSETS_BY_PIXELS: GBUFFER_OFFSETS_PROGRAM,
  FIELD_OFFSETS_BY_FIELD: FIELD_OFFSETS_PROGRAM,
  BOUNCE_MARK_HAIR: MARK_HAIR_SHADER,
  BOUNCE_MARK_EYE: EYE_MARK_SHADER,
  RADIANCE_PROBE_LIST: radianceProbeListWgsl,
  DISTANCE_FIELD_VOXEL_KERNEL: DISTANCE_FIELD_KERNEL_WGSL,
  REFLECTION_CAPTURE_COPY: CAPTURE_COPY_CODE,
  REFLECTION_CAPTURE_DIFFUSE: CAPTURE_DIFFUSE_CODE,
  // The light functions' atlas slot, in each format (`../../lighting/lightFunction/`).
  LIGHT_FUNCTION_SLOT_GREY: lightFunctionRenderWgsl(128, 'grey', false),
  LIGHT_FUNCTION_SLOT_COLOUR: lightFunctionRenderWgsl(128, 'colour', false),
  LIGHT_FUNCTION_SLOT_MAPPED: lightFunctionRenderWgsl(128, 'grey', true),
  LIGHT_FUNCTION_SLOT_GRAPH: graphSlotShader(true),
  LIGHT_FUNCTION_SLOT_GRAPH_PLAIN: graphSlotShader(false),
  // The screen-space ambient occlusion's setup and every shape of its two methods' search (`../../lighting/ao/`).
  AO_SETUP_WGSL,
  AO_SMOOTH_WGSL,
  HORIZON_SPATIAL_WGSL,
  HORIZON_TEMPORAL_WGSL,
  HORIZON_UPSAMPLE_WGSL,
  ...Object.fromEntries(Object.entries(aoShaders()).map(([name, code]) => [`AO_${name}`, code])),
  // The distance-field occlusion's passes (`../../lighting/distanceField/ao/`).
  ...Object.fromEntries(
    Object.entries(DFAO_SHADERS).map(([name, code]) => [`DFAO_${name.toUpperCase()}`, code]),
  ),
  // The suns' mesh lists' passes (`../../lighting/distanceField/shadow/`).
  ...Object.fromEntries(
    Object.entries(DFSH_SHADERS).map(([name, code]) => [`DFSH_${name.toUpperCase()}`, code]),
  ),
  // The global distance field's passes (`../../lighting/distanceField/globalPipelines.ts`) and the
  // meshes' fields' streaming (`streaming.ts`).
  GDF_CULL_CLIPMAP: CULL_CLIPMAP_SHADER,
  GDF_GRID_TILES: GRID_TILES_SHADER,
  GDF_CULL_GRID: CULL_GRID_SHADER,
  GDF_ALLOCATE: ALLOCATE_SHADER,
  GDF_LISTS: LISTS_SHADER,
  // The page atlas a buffer, and a texture where the device allows (`../../gpu/core/textureFormatsTier.ts`).
  GDF_COMPOSE: composeShader(false),
  GDF_COMPOSE_TEXTURE: composeShader(true),
  GDF_COVERAGE: coverageShader(false),
  GDF_COVERAGE_TEXTURE: coverageShader(true),
  GDF_OBJECT_GRID: OBJECT_GRID_SHADER,
  GDF_MIP: mipShader(false),
  GDF_MIP_TEXTURE: mipShader(true),
  GDF_FILL: FILL_SHADER,
  STREAMING_SHADER,
  // The ambient cubemap's mip chain: the box filter and the angular filter (`../../lighting/deferred/ambientCubemapBuild.ts`).
  AMBIENT_CUBEMAP_AVERAGE: cubeAverageShader(),
  AMBIENT_CUBEMAP_FILTER: cubeFilterShader(),
  // The primed depth pyramid's kernel (`../../visibility/hiz/gpu/pipelines.ts`).
  HIZ_PRIMED_SHADER,
  LIGHT_GRID_DEBUG_WGSL,
}
