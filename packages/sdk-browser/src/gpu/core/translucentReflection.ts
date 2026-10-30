import { lightAtlasFormat, type LightAtlasFormat } from './lightAtlasFormat.ts'
import { blendTextureBudget } from './stageStorage.ts'

/**
 * WHETHER THE FORWARD PROGRAMS MAY REFLECT WHAT THE SCENE HOLDS (`forwardTrace`, `lighting/reflections/translucentWgsl.ts`): a blended, water or
 * transmissive fragment reads the world's radiance cache along its mirror direction and the last lit image along a march of the depth pyramid. The widest
 * fragment stage (the display-filtered blends with the rectangle lights' pictures) binds seventeen sampled textures; the reflection group adds the
 * depth pyramid's, the last lit image and the cache's four (the probes' table, the final maps, the raw distances, the sky's share): six more (`BLEND_TEXTURE_FEATURES`). The session
 * asks for them where its adapter offers them (`WEBGPU_REQUIRED_LIMITS`); a device that grants fewer keeps the forward programs reflecting the front
 * layer's trace or the environment alone, said in the options' documentation.
 */
export const grantsTranslucentReflection = (device: Pick<GPUDevice, 'limits'>) =>
  blendTextureBudget(device).granted.has('reflection')

/**
 * The format the cache's final maps are read in by the forward programs: the one the lighting data format's default stores them in on this device. A
 * session that sets another (`lightingDataFormat`) has its forward programs bind a stand-in cache, which covers no point (they reflect the front layer's
 * trace or the environment), said in the options' documentation.
 */
export const translucentReflectionLight = (device: Pick<GPUDevice, 'features'>): LightAtlasFormat =>
  lightAtlasFormat('r11g11b10', device.features)
