import type { EngineContext } from '../session/engine/types.ts'
import type { ExposureCurveOption } from '../../../sdk-core/src/contracts/exposureCurve.ts'
import {
  exposureCurveScaleTable,
  exposureCurveTable,
} from '../../../sdk-core/src/contracts/exposureCurveTable.ts'
import {
  resolveExposureMeterMask,
  type ExposureMeterMaskImage,
} from '../../../sdk-core/src/contracts/exposureMeterMask.ts'
import {
  resolveAmbientCubemap,
  type AmbientCubemapOptions,
} from '../../../sdk-core/src/contracts/ambientCubemapOptions.ts'
import { settingsWritten, settingWriter } from '../../../sdk-core/src/contracts/settingRules.ts'
import { SETTING_FAMILIES, type FamilyName } from '../../../sdk-core/src/runtime/settingFamilies.ts'
import { familyWriters } from './familyWriters.ts'
import type { HostImage } from '../../../sdk-core/src/contracts/hostImage.ts'
import { createRectLightImages } from '../lighting/rectLightAtlas/images.ts'

type Inputs = { check: () => void; context: EngineContext }

/** The writer of the family `N`'s settings by field (`settingWriter`): `setCut(field, option)`. */
type FamilyWriter<N extends FamilyName> = ReturnType<
  typeof settingWriter<(typeof SETTING_FAMILIES)[N]['rules']>
>

/** The writers of the families of `SETTING_FAMILIES` that take `(field, option)`, by their names. */
type FamilyWriters = {
  [N in Exclude<FamilyName, 'raster'> as `set${Capitalize<N>}`]: FamilyWriter<N>
}

/**
 * The run-time settings a session holds in its context, written in place by their field and read
 * from the next frame — the next update for the streaming's — (each family's rules,
 * `../../../sdk-core/src/contracts/`): `undefined` or `null` gives back a setting's default, a
 * value it does not take is refused by its one resolver, naming the field and the values it
 * takes. The cut's, the animation's, the shading's, the exposure's, the temporal pass's, the depth pyramid's and the sun's shadows', the partition's streaming and the HLOD
 * warm-up's, the geometry streaming's, and the cluster raster's split.
 */
export interface ExplorerRuleApi {
  /** Writes the cut's setting `field` (`cutOptions.ts`). */
  setCut: FamilyWriter<'cut'>
  /** Writes the dynamic resolution's setting `field` (`dynamicResolutionOptions.ts`): the budget
   *  the render scale and the cut's edge scale are fitted to, the headrooms, the history, the
   *  change period and threshold; read by the next GPU time. */
  setDynamicResolution: FamilyWriter<'dynamicResolution'>
  /** Writes the animation's setting `field` (`animationOptions.ts`): the screen size under which
   *  an instanced skinned object is drawn in its rest pose and how the scene's animation banks
   *  play their tracks. */
  setAnimation: FamilyWriter<'animation'>
  /** Writes the shading's setting `field` (`shadingOptions.ts`): how the shading bins hold each
   *  material class's pixels. */
  setShading: FamilyWriter<'shading'>
  /** Writes the automatic exposure's setting `field` (`exposureOptions.ts`): the bias, the range
   *  of the mean, the histogram, the shares left out, the speeds, the transition, the black
   *  bucket, how a pixel's luminance is read, the method (histogram, basic or manual), the
   *  camera the manual one reads and the lens attenuation; read by the next image's meter. */
  setExposure: FamilyWriter<'exposure'>
  /** Writes the automatic exposure's compensation curve (`exposureCurve.ts`): stops added to the
   *  target by how bright the scene is, as a list of keys `[ev, compensation]` or a curve
   *  object; `undefined`, `null` or `false` gives back none. A new value replaces the curve (an
   *  edit of the old one in place is not seen); one that is not a curve is refused; read by the
   *  next image's meter. */
  setExposureCurve(option?: ExposureCurveOption): void
  /** Writes the local exposure's highlight contrast curve (`exposureCurve.ts`): a scale the highlights'
   *  contrast is multiplied by, by how bright the scene is, as a list of keys `[ev, scale]` or a curve
   *  object; `undefined`, `null` or `false` gives back none. Replaced as `setExposureCurve`'s is; read by the
   *  next image's meter. */
  setLocalExposureHighlightContrastCurve(option?: ExposureCurveOption): void
  /** The same for the shadows' contrast (`setLocalExposureHighlightContrastCurve`). */
  setLocalExposureShadowContrastCurve(option?: ExposureCurveOption): void
  /** Writes the automatic exposure's metering mask (`exposureMeterMask.ts`): a picture, an
   *  `ImageBitmap` as `loader.imageBitmap` decodes one, whose red channel weighs where the image
   *  is measured; `undefined` or `null` gives back none. One that is not a picture is refused;
   *  read by the next image's meter. */
  setExposureMeterMask(image?: ExposureMeterMaskImage | null): void
  /** Registers the picture `id` for the rectangle lights that name it (`SceneLight.sourceTexture`, `rectLightAtlasOptions.ts`): an `ImageBitmap`
   *  or any image the engine can copy to a texture, drawn into the atlas from the next image; `null` forgets it, and the lights that named it light
   *  as plain rectangles. Another image under the same id replaces it. @throws TypeError for an image with no width or height. */
  setRectLightTexture(id: string, image: HostImage | null): void
  /** The picture `id` changed in place (a canvas drawn into, a video frame): it is drawn into the atlas again at the next image. */
  refreshRectLightTexture(id: string): void
  /** Writes the temporal pass's setting `field` (`temporalOptions.ts`): whether it looks for
   *  geometry thinner than a pixel; read by the next image's pass. */
  setTemporal: FamilyWriter<'temporal'>
  /** Writes the depth pyramid's setting `field` (`hizOptions.ts`): how the reflections' trace
   *  reads it, whether its trace layers hold the transparent surfaces, how the transparent
   *  clusters are tested against it; read by the next image. */
  setHiz: FamilyWriter<'hiz'>
  /** Writes the light functions' setting `field` (`lightFunctionOptions.ts`): whether the atlas is
   *  made, its slots and their size, the most lights that read it, its format, and which
   *  consumers read it; read by the next image. */
  setLightFunction: FamilyWriter<'lightFunction'>
  /** Writes the light profiles' atlas setting `field` (`lightProfileOptions.ts`): the texels a side of a
   *  slice and the most profiles it holds; read by the next image. */
  setLightProfile: FamilyWriter<'lightProfile'>
  /** Writes the rectangle lights' source-texture atlas setting `field` (`rectLightAtlasOptions.ts`): the atlas's largest side, its filter,
   *  its format, the pictures' proportions, which passes read the pictures, and the debug switches; read by the next image. */
  setRectLightAtlas: FamilyWriter<'rectLightAtlas'>
  /** Writes the volumetric lightmap's setting `field` (`volumetricLightmapOptions.ts`): whether the
   *  precomputed light is read; read by the next image. */
  setVolumetricLightmap: FamilyWriter<'volumetricLightmap'>
  /** Writes the global distance field's setting `field` (`globalDistanceFieldOptions.ts`): whether the
   *  clipmaps are made and updated, their number, extent, resolution and update rhythm, the culling
   *  and the streaming of the meshes' distance fields into their atlas; read by the next image. */
  setGlobalDistanceField: FamilyWriter<'globalDistanceField'>
  /** Writes the surface cache's setting `field` (`surfaceCacheOptions.ts`): the atlas the cards' captured surface is
   *  kept in and its size, the resolution each card is kept at, the captures an image makes and the share that
   *  captures pages again, the sharing of captures between cards, the dilation of a page and the feedback of the rays
   *  that read it; read by the next image. */
  setSurfaceCache: FamilyWriter<'surfaceCache'>
  /** Writes the distance-field occlusion's setting `field` (`distanceFieldOcclusionOptions.ts`): whether the sky
   *  light is occluded by the distance fields and how it is traced, filtered over time and applied; read by the next
   *  image. */
  setDistanceFieldOcclusion: FamilyWriter<'distanceFieldOcclusion'>
  /** Writes the sun's shadow setting `field` (`shadowOptions.ts`): the scale of every sun's
   *  shadow distance, whether it has a near edge and the far-shadow test (which reaches no cluster
   *  geometry), and which subjects that test reaches; read by the next frame's shadow planning. */
  setShadows: FamilyWriter<'shadows'>
  /** Writes the motion blur's drawing setting `field` (`motionBlurOptions.ts`): the quality, the
   *  half-resolution gather and input, the second pass and the drawn spread; read by the next
   *  image. */
  setMotionBlur: FamilyWriter<'motionBlur'>
  /** Writes the depth of field's drawing setting `field` (`depthOfFieldRules.ts`): the quality, the
   *  gather's size, accumulator, rings, post-filter and bokeh, how the highlights are scattered and
   *  the recombine's slight out of focus; read by the next image. */
  setDepthOfField: FamilyWriter<'depthOfField'>
  /** Writes the bloom's drawing setting `field` (`bloomRules.ts`): the quality, the cross, the
   *  convolution's resolution, whether the local exposure reaches the bloom and whether the
   *  convolution keeps its kernel's transform; read by the next image. */
  setBloom: FamilyWriter<'bloom'>
  /** Writes the Gaussian blur's drawing setting `field` (`gaussianBlurRules.ts`): the radius from which
   *  a blur writes its first pass at half the width, the reach of its kernel and the most reads of a
   *  pass, for the bloom's levels and the local exposure's blur; read by the next image. */
  setGaussianBlur: FamilyWriter<'gaussianBlur'>
  /** Writes the film effects' setting `field` (`filmOptions.ts`): the film grain, the colour
   *  fringe, the vignette's look, the tonemapper's quality and sharpening, the scene's tint and
   *  the dither; read by the next image's finishing. */
  setFilm: FamilyWriter<'film'>
  /** Writes the colour grading's setting `field` (`colorGradingOptions.ts`): the film curve's
   *  own settings, the white balance, the grade of the dark, middle and bright parts, the
   *  correction, the display's gamma and the tone table's size and shaper; read by the next
   *  image's baking of the table. */
  setColorGrading: FamilyWriter<'colorGrading'>
  /** Writes the indirect light's setting `field` (`screenProbeOptions.ts`): the screen probes'
   *  level, their rays, filters, history and short-range occlusion; read by the next image's
   *  screen probes. */
  setIndirectLight: FamilyWriter<'indirectLight'>
  /** Writes the reflections' trace setting `field` (`reflectionOptions.ts`): the iterations of a
   *  reflected ray's march of the screen, the far screen trace and the denoiser; read by the next
   *  image's trace. */
  setReflections: FamilyWriter<'reflections'>
  /** Writes the screen-space traces' setting `field` (`screenSpaceTracingOptions.ts`): the method that answers the reflections and the indirect light, and the screen reflections' and screen indirect light's quality and passes; read by the next frame. */
  setScreenSpaceTracing: FamilyWriter<'screenSpaceTracing'>
  /** Writes the lighting data format's setting `field` (`lightingDataFormatOptions.ts`): the format the light is kept at between the passes of the indirect light — one `null` gives it back to its default, one left out stays —; one a setting does not take is refused. */
  setLightingDataFormat: FamilyWriter<'lightingDataFormat'>
  /** Writes the meshes' fields trace's setting `field` (`meshDistanceFieldTraceOptions.ts`): whether the rays march the meshes' own distance fields, which of them do, how far and the view grid the
   *  meshes are culled to — one `null` gives it back to it, one left out stays —; one a setting does not take is refused. */
  setMeshDistanceFieldTrace: FamilyWriter<'meshDistanceFieldTrace'>
  /** Writes the screen-space ambient occlusion's setting `field` (`ambientOcclusionOptions.ts`): the
   *  master switch, the intensity, radius, fade, power, bias, the quality and the resolutions it
   *  follows, and whether it occludes the screen probes' light; read by the next image's
   *  occlusion passes. */
  setAmbientOcclusion: FamilyWriter<'ambientOcclusion'>
  /** Writes the ambient cubemap's setting `field` (`ambientCubemapOptions.ts`): the tint of the cube's light, a linear colour of three
   *  channels, and the intensity that multiplies it; read by the next image's indirect light. The cube itself is a world option
   *  (`ambientCubemap`), given at the opening and changed by `setAmbientCubemapCube`. */
  setAmbientCubemap: FamilyWriter<'ambientCubemap'>
  /** Writes the reflection captures' setting `field` (`reflectionCaptureOptions.ts`): whether they light the surfaces, the side of their cubes, the
   *  supersampling and near plane of their faces, the light functions, and the diffuse light of their small mips. */
  setReflectionCapture: FamilyWriter<'reflectionCapture'>
  /** Writes the ambient cubemap's cube (`ambientCubemapOptions.ts`): `{ size, texels }`, the side of a face in texels (a power of two from
   *  16 to 1024) and the six faces' linear colours; `undefined` or `null` takes the light away. One that is not a cube is refused; the
   *  next image filters the new cube's mip chain over the images it takes (the images drawn meanwhile are drawn again and light nothing
   *  from the cube), and frees the old one's. A cube is told from the one held by its texels array: one edited in place is not seen,
   *  a new array is. */
  setAmbientCubemapCube(cube?: AmbientCubemapOptions['ambientCubemap']): void
  /** Writes the volumetric fog's setting `field` (`volumetricFogOptions.ts`): its quality level
   *  (`'off'`, `'low'`, `'high'`, `'ultra'`) and the filtering, temporal reprojection,
   *  jitter, history weight, depth distribution, emissive, conservative depth, distance bias,
   *  sample jitter and grid offset it is read with; read by the next frame's fog volume. */
  setVolumetricFog: FamilyWriter<'volumetricFog'>
  /** Writes the translucency lighting volume's setting `field` (`translucencyVolumeOptions.ts`): whether
   *  the field of light the see-through surfaces of the volume lighting modes read is made, the cells
   *  of its two cascades and the distances they end at, its blur or its temporal filter and the
   *  noise on the point a surface reads it at; read by the next frame's injection. */
  setTranslucencyVolume: FamilyWriter<'translucencyVolume'>
  /** Writes the translucency global illumination volume's setting `field` (`translucencyGiOptions.ts`): whether the grid of
   *  indirect light the see-through surfaces read is made, its cells' pixel size and depth distribution, the end distance, the
   *  cones a cell traces, the spatial and temporal filters and the radiance cache read; read by the next frame's volume. */
  setTranslucencyGi: FamilyWriter<'translucencyGi'>
  /** Writes the screen-space subsurface scattering's setting `field` (`subsurfaceScatteringOptions.ts`): whether it runs, the scale of every
   *  profile's radius, the half resolution, the sampled scattering's samples, cache and weighing, the separable passes' samples, the
   *  recombine's quality and the checkerboard; read by the next image's scattering. */
  setSubsurfaceScattering: FamilyWriter<'subsurfaceScattering'>
  /** Writes the single-layer water's setting `field` (`singleLayerWaterOptions.ts`): whether it is drawn, its reflection technique and refraction, the cullings and the passes; read by the next frame's water pass. */
  setSingleLayerWater: FamilyWriter<'singleLayerWater'>
  /** Writes the hair strands' setting `field` (`hairStrandsOptions.ts`): whether the strands are drawn and shadowed, their
   *  visibility buffer's samples and merging, the voxel volume's size, pages, allocation, march and shadow terms, and the rays a strand's
   *  pixel casts toward a light; read by the next frame. */
  setHairStrands: FamilyWriter<'hairStrands'>
  /** Writes the heterogeneous volumes' setting `field` (`heterogeneousVolumeOptions.ts`): whether the volumes are drawn, allowed by the device profile, cast shadows and are composited with the translucency; read by the next frame. */
  setHeterogeneousVolumeRendering: FamilyWriter<'heterogeneousVolumeRendering'>
  /** Writes the sampled lighting's setting `field` (`sampledLightsOptions.ts`): whether the view is lit by it, its draw, rays and filters; read by the next image. */
  setSampledLights: FamilyWriter<'sampledLights'>
  /** Writes the sky's quality setting `field` (`sky/quality.ts`): the atmosphere's switches,
   *  samples, caps and tables, the clouds', the light shafts' and the sky light's; read by the next
   *  image's passes. */
  setSkyQuality: FamilyWriter<'skyQuality'>
  /** Writes the tessellation's setting `field` (`tessellationOptions.ts`): whether a displaced
   *  material is tessellated, the size in pixels of the micro-triangles it is diced to, the
   *  patches a group of the dicing pass takes, and the patches the splitting queue and the
   *  visible list hold; read by the next image's tessellation. */
  setTessellation: FamilyWriter<'tessellation'>
  /** Writes the texture filtering's setting `field` (`textureFilteringOptions.ts`): the most reads
   *  anisotropic filtering takes, for the textures streamed by tile and for the clouds' textures; read
   *  by the next image. */
  setTextureFiltering: FamilyWriter<'textureFiltering'>
  /** Writes the setting `field` of how the view streams a partitioned scene's cells and of the
   *  warm-up an HLOD switch waits on (`worldStreamingOptions.ts`). */
  setWorldStreaming: FamilyWriter<'worldStreaming'>
  /** Writes the geometry streaming's setting `field` (`streamingOptions.ts`), from the
   *  streaming's next update. */
  setStreaming: FamilyWriter<'streaming'>
  /** The software raster from the next frame (`softwareRaster`, `rasterOptions.ts`): `false`
   *  hands every cluster to the hardware rasterizer. */
  setSoftwareRaster(on: boolean): void
  /** The projected edge in pixels from which a cluster goes to the hardware rasterizer, from the
   *  next frame (`hardwareRasterEdgePixels`, `rasterOptions.ts`). */
  setHardwareRasterEdgePixels(pixels: number): void
  /** Whether the software raster's cutout clusters are ordered nearest first by depth bucket, from
   *  the next frame (`depthBucketing`, `rasterOptions.ts`). */
  setDepthBucketing(on: boolean): void
  /** The depth in metres the buckets start at, from the next frame (`depthBucketsMinZ`,
   *  `rasterOptions.ts`). */
  setDepthBucketsMinZ(metres: number): void
  /** The depth in metres the buckets end at, from the next frame (`depthBucketsMaxZ`,
   *  `rasterOptions.ts`). */
  setDepthBucketsMaxZ(metres: number): void
}

/** The explorer's writers of the run-time settings (`ExplorerRuleApi`): the families' by their
 *  field, the exposure's curve and metering mask, the ambient cubemap's cube, and the cluster raster's five. */
export function createExplorerRuleApi({ check, context }: Inputs): ExplorerRuleApi {
  const raster = settingWriter(SETTING_FAMILIES.raster.rules, context, check)
  return {
    ...(familyWriters(context, check) as FamilyWriters),
    setExposureCurve(option) {
      exposureCurveTable(option)
      check()
      context.exposureCurve = option
      settingsWritten()
    },
    setLocalExposureHighlightContrastCurve(option) {
      exposureCurveScaleTable(option)
      check()
      context.localExposureHighlightContrastCurve = option
      settingsWritten()
    },
    setLocalExposureShadowContrastCurve(option) {
      exposureCurveScaleTable(option)
      check()
      context.localExposureShadowContrastCurve = option
      settingsWritten()
    },
    setRectLightTexture(id, image) {
      check()
      const images = (context.rectLightImages ??= createRectLightImages())
      images.set(id, image)
      settingsWritten()
    },
    refreshRectLightTexture(id) {
      check()
      context.rectLightImages?.refresh(id)
      settingsWritten()
    },
    setExposureMeterMask(image) {
      const mask = resolveExposureMeterMask(image)
      check()
      context.exposureMeterMask = mask
      settingsWritten()
    },
    setAmbientCubemapCube(cube) {
      const resolved = resolveAmbientCubemap({ ambientCubemap: cube }).ambientCubemap
      check()
      context.ambientCubemap = resolved
      settingsWritten()
    },
    setSoftwareRaster: (on) => raster('softwareRaster', on),
    setHardwareRasterEdgePixels: (pixels) => raster('hardwareRasterEdgePixels', pixels),
    setDepthBucketing: (on) => raster('depthBucketing', on),
    setDepthBucketsMinZ: (metres) => raster('depthBucketsMinZ', metres),
    setDepthBucketsMaxZ: (metres) => raster('depthBucketsMaxZ', metres),
  }
}
