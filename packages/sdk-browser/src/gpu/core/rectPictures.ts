import { blendTextureBudget } from './stageStorage.ts'

/**
 * WHETHER THE BLENDS MAY READ THE RECTANGLE LIGHTS' PICTURES: the fragment stage of the widest blend program (the display-filtered
 * layers, whose mask is a group of its own) already binds the sixteen sampled textures WebGPU guarantees, and the pictures' atlas is a
 * seventeenth (`BLEND_TEXTURE_FEATURES`). The session asks for the seventeen where its adapter offers them (`WEBGPU_REQUIRED_LIMITS`); a device that grants
 * only sixteen draws the blends' rectangle lights with their plain colour, said in the option's documentation.
 */
export const grantsRectPictures = (device: Pick<GPUDevice, 'limits'>) =>
  blendTextureBudget(device).granted.has('pictures')
