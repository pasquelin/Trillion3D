import { SCENE_TEXTURE_NUMBERS } from '../../materials/graph/nodesScene.ts'

/**
 * THE LAYOUT OF A POST-PROCESS MATERIAL'S PASS: one bind group, written once here and read by the program's text (`postWgsl.ts`)
 * and by the code that binds it (`postMaterials.ts`).
 * - `view`: the frame's uniform, the same for every material of an image (`POST_VIEW`);
 * - `given`: the material's uniform, its clocks, its plain colour and opacity, its flags and the values its graph reads (`POST_GIVEN`);
 * - `input`: the image the material reads and draws over (the scene texture `postProcessInput0`);
 * - `sceneColor`, `sceneDepth`, `customDepth`, `customStencil`: the lit image, its depth, and the custom depth and stencil;
 * - `sampler`: the bilinear sampler of the colour images.
 */
export const POST_BINDINGS = {
  view: 0,
  given: 1,
  input: 2,
  sceneColor: 3,
  sceneDepth: 4,
  customDepth: 5,
  customStencil: 6,
  sampler: 7,
} as const

/** The words of the frame's uniform, four to a vector: the depth terms and radius of the projection (`DEPTH_WGSL`), the image's size and its
 *  texture's, the render size and the size of the lit image's textures, the custom targets' size, the scales (`head`). */
export const POST_VIEW = {
  depth: 0,
  radius: 4,
  image: 8,
  scene: 12,
  custom: 16,
  /** x: what the pixel written is multiplied by (the image's pre-exposure), y: what the images read are (one over it). */
  head: 20,
  words: 24,
} as const

/** The words of a material's uniform before its graph's values: its clocks (time, real time), its plain colour and opacity, its flags. */
export const POST_GIVEN = {
  head: 0,
  plain: 4,
  /** x: the blend (`POST_BLEND`), y: whether the stencil test is on, z: its mask (`stencilMaskOf`), w: its reference value. */
  flags: 8,
  words: 12,
} as const

/** The ways the pixel a material writes meets the pixel it replaces, in the order of the reference's blend states for a material that
 *  outputs alpha: the colour replaces it, mixes by the opacity, adds, multiplies, is laid over it premultiplied, or holds it out; and,
 *  for a material that outputs no alpha, the colour replaces the pixel's and its alpha is kept (`rgbOnly`). */
export const POST_BLEND = {
  replace: 0,
  translucent: 1,
  additive: 2,
  modulate: 3,
  alphaComposite: 4,
  alphaHoldout: 5,
  rgbOnly: 6,
} as const
/** A way a material blends. */
export type PostBlend = (typeof POST_BLEND)[keyof typeof POST_BLEND]

/** The ids of the scene textures the program reads by number, as the nodes write them (`SCENE_TEXTURE_NUMBERS`). */
export const SCENE_NUMBERS = SCENE_TEXTURE_NUMBERS
