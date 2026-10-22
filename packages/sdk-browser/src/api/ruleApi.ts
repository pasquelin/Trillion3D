import type { EngineContext } from '../session/engine/types.ts'
import { ANIMATION_RULES } from '../../../sdk-core/src/contracts/animationOptions.ts'
import { CUT_RULES } from '../../../sdk-core/src/contracts/cutOptions.ts'
import type { ExposureCurveOption } from '../../../sdk-core/src/contracts/exposureCurve.ts'
import { exposureCurveTable } from '../../../sdk-core/src/contracts/exposureCurveTable.ts'
import { EXPOSURE_RULES } from '../../../sdk-core/src/contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../../../sdk-core/src/contracts/temporalOptions.ts'
import { HIZ_RULES } from '../../../sdk-core/src/contracts/hizOptions.ts'
import { LIGHT_FUNCTION_RULES } from '../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import { VOLUMETRIC_LIGHTMAP_RULES } from '../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { DISTANCE_FIELD_OCCLUSION_RULES } from '../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import { SHADOW_RULES } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import { MOTION_BLUR_RULES } from '../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { BLOOM_RULES } from '../../../sdk-core/src/contracts/bloomRules.ts'
import { FILM_RULES } from '../../../sdk-core/src/contracts/filmOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { TESSELLATION_RULES } from '../../../sdk-core/src/contracts/tessellationOptions.ts'
import { RASTER_RULES } from '../../../sdk-core/src/contracts/rasterOptions.ts'
import { settingWriter } from '../../../sdk-core/src/contracts/settingRules.ts'
import { SHADING_RULES } from '../../../sdk-core/src/contracts/shadingOptions.ts'
import { STREAMING_RULES } from '../../../sdk-core/src/contracts/streamingOptions.ts'
import { WORLD_STREAMING_RULES } from '../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { SCREEN_PROBE_RULES } from '../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { REFLECTION_RULES } from '../../../sdk-core/src/contracts/reflectionOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { SKY_QUALITY_RULES } from '../../../sdk-core/src/modules/sky/quality.ts'

type Inputs = { check: () => void; context: EngineContext }

/**
 * The run-time settings a session holds in its context, written in place by their field and read
 * from the next frame — the next update for the streaming's — (each family's rules,
 * `../../../sdk-core/src/contracts/`): `undefined` or `null` gives back a setting's default, a
 * value it does not take is refused by its one resolver, naming the field and the values it
 * takes. The cut's, the animation's, the shading's, the exposure's, the temporal pass's, the depth pyramid's and the sun's shadows', the partition's streaming and the HLOD
 * warm-up's, the geometry streaming's, and the cluster raster's split.
 */
export function createExplorerRuleApi({ check, context }: Inputs) {
  const raster = settingWriter(RASTER_RULES, context, check)
  return {
    /** Writes the cut's setting `field` (`cutOptions.ts`). */
    setCut: settingWriter(CUT_RULES, context, check),
    /** Writes the animation's setting `field` (`animationOptions.ts`): the screen size under which
     *  an instanced skinned object is drawn in its rest pose and how the scene's animation banks
     *  play their tracks. */
    setAnimation: settingWriter(ANIMATION_RULES, context, check),
    /** Writes the shading's setting `field` (`shadingOptions.ts`): how the shading bins hold each
     *  material class's pixels. */
    setShading: settingWriter(SHADING_RULES, context, check),
    /** Writes the automatic exposure's setting `field` (`exposureOptions.ts`): the bias, the range
     *  of the mean, the histogram, the shares left out, the speeds, the transition, the black
     *  bucket and how a pixel's luminance is read; read by the next image's meter. */
    setExposure: settingWriter(EXPOSURE_RULES, context, check),
    /** Writes the automatic exposure's compensation curve (`exposureCurve.ts`): stops added to the
     *  target by how bright the scene is, as a list of keys `[ev, compensation]` or a curve
     *  object; `undefined`, `null` or `false` gives back none. A new value replaces the curve (an
     *  edit of the old one in place is not seen); one that is not a curve is refused; read by the
     *  next image's meter. */
    setExposureCurve(option?: ExposureCurveOption) {
      exposureCurveTable(option)
      check()
      context.exposureCurve = option
    },
    /** Writes the temporal pass's setting `field` (`temporalOptions.ts`): whether it looks for
     *  geometry thinner than a pixel; read by the next image's pass. */
    setTemporal: settingWriter(TEMPORAL_RULES, context, check),
    /** Writes the depth pyramid's setting `field` (`hizOptions.ts`): how the reflections' trace
     *  reads it, whether its trace layers hold the transparent surfaces, how the transparent
     *  clusters are tested against it; read by the next image. */
    setHiz: settingWriter(HIZ_RULES, context, check),
    /** Writes the light functions' setting `field` (`lightFunctionOptions.ts`): whether the atlas is
     *  made, its slots and their size, the most lights that read it, its format, and which
     *  consumers read it; read by the next image. */
    setLightFunction: settingWriter(LIGHT_FUNCTION_RULES, context, check),
    /** Writes the volumetric lightmap's setting `field` (`volumetricLightmapOptions.ts`): whether the
     *  precomputed light is read; read by the next image. */
    setVolumetricLightmap: settingWriter(VOLUMETRIC_LIGHTMAP_RULES, context, check),
    /** Writes the global distance field's setting `field` (`globalDistanceFieldOptions.ts`): whether the
     *  clipmaps are made and updated, their number, extent, resolution and update rhythm, the culling
     *  and the streaming of the meshes' distance fields into their atlas; read by the next image. */
    setGlobalDistanceField: settingWriter(GLOBAL_DISTANCE_FIELD_RULES, context, check),
    /** Writes the distance-field occlusion's setting `field` (`distanceFieldOcclusionOptions.ts`): whether the sky
     *  light is occluded by the distance fields and how it is traced, filtered over time and applied; read by the next
     *  image. */
    setDistanceFieldOcclusion: settingWriter(DISTANCE_FIELD_OCCLUSION_RULES, context, check),
    /** Writes the sun's shadow setting `field` (`shadowOptions.ts`): the scale of every sun's
     *  shadow distance, whether its shadow maps leave out the casters past it, and which casters
     *  that test reaches; read by the next frame's shadow planning. */
    setShadows: settingWriter(SHADOW_RULES, context, check),
    /** Writes the motion blur's drawing setting `field` (`motionBlurOptions.ts`): the quality, the
     *  half-resolution gather and input, the second pass and the drawn spread; read by the next
     *  image. */
    setMotionBlur: settingWriter(MOTION_BLUR_RULES, context, check),
    /** Writes the depth of field's drawing setting `field` (`depthOfFieldRules.ts`): the quality, the
     *  gather's size, accumulator, rings, post-filter and bokeh, how the highlights are scattered and
     *  the recombine's slight out of focus; read by the next image. */
    setDepthOfField: settingWriter(DEPTH_OF_FIELD_RULES, context, check),
    /** Writes the bloom's drawing setting `field` (`bloomRules.ts`): the quality, the cross, the
     *  convolution's resolution, whether the local exposure reaches the bloom and whether the
     *  convolution keeps its kernel's transform; read by the next image. */
    setBloom: settingWriter(BLOOM_RULES, context, check),
    /** Writes the film effects' setting `field` (`filmOptions.ts`): the film grain, the colour
     *  fringe, the vignette's look, the tonemapper's quality and sharpening, the scene's tint and
     *  the dither; read by the next image's finishing. */
    setFilm: settingWriter(FILM_RULES, context, check),
    /** Writes the indirect light's setting `field` (`screenProbeOptions.ts`): the screen probes'
     *  level, their rays, filters, history and short-range occlusion; read by the next image's
     *  screen probes. */
    setIndirectLight: settingWriter(SCREEN_PROBE_RULES, context, check),
    /** Writes the reflections' trace setting `field` (`reflectionOptions.ts`): the iterations of a
     *  reflected ray's march of the screen and the steps it may take in each ring of the scene; read
     *  by the next image's trace. */
    setReflections: settingWriter(REFLECTION_RULES, context, check),
    /** Writes the screen-space ambient occlusion's setting `field` (`ambientOcclusionOptions.ts`): the
     *  master switch, the intensity, radius, fade, power, bias, the quality and the resolutions it
     *  follows, and whether it occludes the screen probes' light; read by the next image's
     *  occlusion passes. */
    setAmbientOcclusion: settingWriter(AMBIENT_OCCLUSION_RULES, context, check),
    /** Writes the volumetric fog's setting `field` (`volumetricFogOptions.ts`): its quality level
     *  (`'off'`, `'low'`, `'high'`, `'ultra'`) and the filtering, temporal reprojection,
     *  jitter, history weight, depth distribution, emissive, conservative depth, distance bias,
     *  sample jitter and grid offset it is read with; read by the next frame's fog volume. */
    setVolumetricFog: settingWriter(VOLUMETRIC_FOG_RULES, context, check),
    /** Writes the sky's quality setting `field` (`sky/quality.ts`): the atmosphere's switches,
     *  samples, caps and tables, the clouds', the light shafts' and the sky light's; read by the next
     *  image's passes. */
    setSkyQuality: settingWriter(SKY_QUALITY_RULES, context, check),
    /** Writes the tessellation's setting `field` (`tessellationOptions.ts`): whether a displaced
     *  material is tessellated, the size in pixels of the micro-triangles it is diced to, the
     *  patches a group of the dicing pass takes, and the patches the splitting queue and the
     *  visible list hold; read by the next image's tessellation. */
    setTessellation: settingWriter(TESSELLATION_RULES, context, check),
    /** Writes the setting `field` of how the view streams a partitioned scene's cells and of the
     *  warm-up an HLOD switch waits on (`worldStreamingOptions.ts`). */
    setWorldStreaming: settingWriter(WORLD_STREAMING_RULES, context, check),
    /** Writes the geometry streaming's setting `field` (`streamingOptions.ts`), from the
     *  streaming's next update. */
    setStreaming: settingWriter(STREAMING_RULES, context, check),
    /** The software raster from the next frame (`softwareRaster`, `rasterOptions.ts`): `false`
     *  hands every cluster to the hardware rasterizer. */
    setSoftwareRaster: (on: boolean) => raster('softwareRaster', on),
    /** The projected edge in pixels from which a cluster goes to the hardware rasterizer, from the
     *  next frame (`hardwareRasterEdgePixels`, `rasterOptions.ts`). */
    setHardwareRasterEdgePixels: (pixels: number) => raster('hardwareRasterEdgePixels', pixels),
  }
}
