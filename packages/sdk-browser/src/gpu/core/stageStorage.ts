/** The shader stages whose storage buffer count a device limits on its own, besides the limit every stage shares. */
export type StorageStage = 'vertex' | 'fragment' | 'compute'

type StageLimits = GPUSupportedLimits & {
  maxStorageBuffersInVertexStage?: number
  maxStorageBuffersInFragmentStage?: number
}

/**
 * Whether `device` grants a `stage` `count` storage buffers: the fewer of the stage's own limit (none on a device that lists none: the
 * compute stage has none) and the shader stages' (8, WebGPU's guarantee, where the device lists none). The one answer every program that
 * binds more than the guarantee asks (the colour atlas read by a vertex stage, the page management's counters, the sorted translucency's buffer).
 */
export function grantsStageStorage(
  device: Pick<GPUDevice, 'limits'>,
  stage: StorageStage,
  count: number,
) {
  const limits = device.limits as StageLimits | undefined
  const own =
    stage === 'vertex'
      ? limits?.maxStorageBuffersInVertexStage
      : stage === 'fragment'
        ? limits?.maxStorageBuffersInFragmentStage
        : undefined
  return Math.min(limits?.maxStorageBuffersPerShaderStage ?? 8, own ?? Infinity) >= count
}

/** An optional feature of a stage's sampled textures: its `count` past the WebGPU guarantee, and whether the programs bind them whatever the device grants (`required`). */
export type StageTextureFeature<Name extends string = string> = {
  readonly name: Name
  readonly count: number
  readonly required?: boolean
}

/** The sampled textures a fragment stage is guaranteed on every device. */
export const GUARANTEED_SAMPLED_TEXTURES = 16

/**
 * How a device's sampled textures a stage are spent, over the ordered optional `features`: each is granted where the textures bound so far, the guarantee and the features
 * granted before it, leave `count` within the device's limit (a feature that does not fit is skipped, the next tried); a `required` one is counted whether it fits or not.
 * `spare` is what the limit leaves past what is bound: the textures an optional read still has (negative where a required feature does not fit). The one answer the programs
 * that bind more than the guarantee ask (the rectangle lights' pictures, the reflection group, the sorted translucency's depth, the object shadow's read).
 */
export function stageTextureBudget<Name extends string>(
  device: Pick<GPUDevice, 'limits'>,
  features: readonly StageTextureFeature<Name>[],
) {
  const limit = device.limits?.maxSampledTexturesPerShaderStage ?? GUARANTEED_SAMPLED_TEXTURES
  const granted = new Set<Name>()
  let bound = GUARANTEED_SAMPLED_TEXTURES
  for (const { name, count, required } of features) {
    const fits = limit >= bound + count
    if (fits) granted.add(name)
    if (fits || required) bound += count
  }
  return { granted, bound, spare: limit - bound }
}

/**
 * THE ORDERED OPTIONAL SAMPLED TEXTURES OF THE BLENDS' WIDEST FRAGMENT STAGE (past the sixteen WebGPU guarantees), the one list every grant, layout and asked limit derives from: the rectangle lights'
 * pictures' atlas (`grantsRectPictures`), the reflection group's six (the depth pyramid's, the last lit image and the cache's four: `grantsTranslucentReflection`), the sorted translucency's collect
 * depth texture (bound by the programs that sort whatever the device grants, so `required`), then the blends' own object shadow (the packed table and the subjects' atlas, `objectShadowAtlasRead`).
 */
export const BLEND_TEXTURE_FEATURES = [
  { name: 'pictures', count: 1 },
  { name: 'reflection', count: 6 },
  { name: 'collect', count: 1, required: true },
  { name: 'objectShadow', count: 2 },
] as const satisfies readonly StageTextureFeature[]

const WITHOUT_COLLECT = BLEND_TEXTURE_FEATURES.filter((feature) => feature.name !== 'collect')

/** The sampled textures the engine asks a fragment stage of, where its adapter offers them: the guarantee and every feature of the list (`WEBGPU_REQUIRED_LIMITS`). */
export const BLEND_SAMPLED_TEXTURES_ASKED =
  GUARANTEED_SAMPLED_TEXTURES + BLEND_TEXTURE_FEATURES.reduce((sum, { count }) => sum + count, 0)

/** How `device`'s sampled textures are spent by the blends' list; `sorts`: the programs bind the sorted translucency's collect texture too. */
export const blendTextureBudget = (device: Pick<GPUDevice, 'limits'>, sorts = false) =>
  stageTextureBudget(device, sorts ? BLEND_TEXTURE_FEATURES : WITHOUT_COLLECT)
