import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import { hizLevelZeroEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { preparedPipeline } from '../deferred/fullscreen.ts'
import { VSM_SUN_MASK_FORMAT as SUN_MASK_FORMAT } from '../shadows/vsm/projection/maskFormat.ts'
import { sceneLayoutEntries } from '../distanceField/sceneBindings.ts'
import { volumetricLightmapLayoutEntries } from '../volumetricLightmap/textures.ts'
import { capsuleShadowShader, type CapsuleMode } from './capsuleShadowWgsl.ts'
import { capsuleHooks } from './hooks.ts'
import {
  CAPSULE_BENT_NORMAL_FORMAT,
  CAPSULE_BINDINGS as B,
  CAPSULE_FACTORS_FORMAT,
  CAPSULE_PARAM_BYTES,
  LIGHT_DIRECTION_BINDINGS as L,
  LIGHT_DIRECTION_SKY,
  UPSAMPLE_BINDINGS as U,
  UPSAMPLE_PARAM_BYTES,
} from './layout.ts'
import { lightDirectionShader } from './lightDirectionWgsl.ts'
import { skyLightDiffuseLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { capsuleComposeShader, capsuleUpsampleShader } from './upsampleWgsl.ts'

const LABEL = 'Trillion3D capsule shadows'
const UPSAMPLE_LABEL = `${LABEL} upsample`
const COMPOSE_LABEL = `${LABEL} compose sun`
const DIRECTIONS_LABEL = `${LABEL} light directions`
/** `GPUShaderStage.VERTEX` and `FRAGMENT`, written in the clear: the entries are also read from Node. */
const VERTEX = 1
const FRAGMENT = 2

/** What decides a shadow program: its mode and whether it traces the distance-field casters. */
export interface CapsuleProgramKey {
  readonly mode: CapsuleMode
  readonly casters: boolean
}

const programId = (key: CapsuleProgramKey) => `${key.mode}${key.casters ? ' casters' : ''}`

/** The bindings of group 0 of a shadow program (`CAPSULE_BINDINGS` names them), and of group 1 where it traces the casters. */
function shadowLayoutEntries({ mode, casters }: CapsuleProgramKey) {
  const fromCapsule = mode === 'indirect' || mode === 'skylight'
  const bent = mode === 'skylight'
  return [
    [
      computeUniformEntry(B.params, { minBindingSize: CAPSULE_PARAM_BYTES }),
      computeBufferEntry(B.shapes, 'read-only-storage'),
      ...(fromCapsule ? [computeBufferEntry(B.lightData, 'read-only-storage')] : []),
      ...(casters ? [computeBufferEntry(B.casterIndices, 'read-only-storage')] : []),
      ...(bent
        ? [
            computeTextureEntry(B.receiverBentNormal, 'float'),
            computeStorageTextureEntry(B.bentNormal, CAPSULE_BENT_NORMAL_FORMAT),
          ]
        : [
            computeBufferEntry(B.tileCounts, 'storage'),
            computeStorageTextureEntry(B.factors, CAPSULE_FACTORS_FORMAT),
          ]),
      ...hizLevelZeroEntries(B.depth, COMPUTE),
      computeTextureEntry(B.flags, 'uint'),
    ],
    ...(casters ? [sceneLayoutEntries(0)] : []),
  ]
}

/** The key of an upsample draw: its targets (formats, blends, write masks) and whether it writes the second, ambient occlusion target. */
interface CapsuleUpsampleKey {
  readonly targets: readonly GPUColorTargetState[]
}

const upsampleId = (key: CapsuleUpsampleKey) => JSON.stringify(key.targets)

/** The shadow passes by mode and caster use, with the layouts of their groups. */
function shadowPrograms(device: GPUDevice) {
  return preparedPipelines((key: CapsuleProgramKey) => {
    const layouts = shadowLayoutEntries(key).map((entries, group) =>
      device.createBindGroupLayout({ label: `${LABEL} ${programId(key)} ${group}`, entries }),
    )
    const label = `${LABEL} ${programId(key)}`
    return {
      layouts,
      stage: preparedComputeStage(
        device,
        device.createPipelineLayout({ bindGroupLayouts: layouts }),
        device.createShaderModule({
          label,
          code: capsuleShadowShader(key.mode, capsuleHooks('capsuleParams.depth'), key.casters),
        }),
        'capsuleShadow',
        undefined,
        label,
      ),
    }
  }, programId)
}

/** The upsample draws by targets, over one layout, and its modules by whether the ambient occlusion target is written. */
function upsamplePrograms(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    label: `${LABEL} upsample`,
    entries: [
      computeUniformEntry(U.params, { minBindingSize: UPSAMPLE_PARAM_BYTES }, VERTEX | FRAGMENT),
      computeBufferEntry(U.tileCounts, 'read-only-storage', VERTEX),
      computeTextureEntry(U.factors, 'unfilterable-float', '2d', FRAGMENT),
      ...hizLevelZeroEntries(U.depth, FRAGMENT),
      computeTextureEntry(U.flags, 'uint', '2d', FRAGMENT),
    ],
  })
  const modules = new Map<boolean, GPUShaderModule>()
  const moduleOf = (ssao: boolean) => {
    let module = modules.get(ssao)
    if (!module)
      modules.set(
        ssao,
        (module = device.createShaderModule({
          label: UPSAMPLE_LABEL,
          code: capsuleUpsampleShader(capsuleHooks('upsampleParams.depth'), ssao),
        })),
      )
    return module
  }
  const pipelines = preparedPipelines((key: CapsuleUpsampleKey) => {
    const module = moduleOf(key.targets.length > 1)
    return preparedPipeline(device, {
      label: `${LABEL} upsample`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'capsuleUpsampleVertex' },
      fragment: {
        module,
        entryPoint: 'capsuleUpsampleFragment',
        targets: [...key.targets],
      },
      primitive: { topology: 'triangle-list' },
    })
  }, upsampleId)
  return { layout, of: (key: CapsuleUpsampleKey) => pipelines.of(key) }
}

/** The composition into a sun's mask: its layout and its compute stage. */
function composePrograms(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    label: `${LABEL} compose`,
    entries: [
      computeUniformEntry(U.params, { minBindingSize: UPSAMPLE_PARAM_BYTES }),
      computeBufferEntry(U.tileCounts, 'read-only-storage'),
      computeTextureEntry(U.factors, 'unfilterable-float'),
      computeStorageTextureEntry(U.sunMask, SUN_MASK_FORMAT, 'read-write', '2d-array'),
      ...hizLevelZeroEntries(U.depth, COMPUTE),
      computeTextureEntry(U.flags, 'uint'),
    ],
  })
  const stage = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({
      label: COMPOSE_LABEL,
      code: capsuleComposeShader(capsuleHooks('upsampleParams.depth')),
    }),
    'capsuleComposeSun',
    undefined,
    COMPOSE_LABEL,
  )
  return { layout, stage }
}

/** The light directions' layouts (the pass's own, the volumetric lightmap's — none for the program without it — and the sky light's harmonics) and its programs. */
function directionPrograms(device: GPUDevice) {
  const layouts = [
    device.createBindGroupLayout({
      label: DIRECTIONS_LABEL,
      entries: [
        computeUniformEntry(L.params),
        computeBufferEntry(L.input, 'read-only-storage'),
        computeBufferEntry(L.output, 'storage'),
      ],
    }),
    device.createBindGroupLayout({
      label: `${DIRECTIONS_LABEL} lightmap`,
      entries: volumetricLightmapLayoutEntries(0),
    }),
    device.createBindGroupLayout({
      label: `${DIRECTIONS_LABEL} sky`,
      entries: skyLightDiffuseLayoutEntries(LIGHT_DIRECTION_SKY, COMPUTE),
    }),
  ]
  const noLightmapLayout = device.createBindGroupLayout({
    label: `${DIRECTIONS_LABEL} no lightmap`,
    entries: [],
  })
  const programs = preparedPipelines((lightmap: boolean) => {
    const label = `${DIRECTIONS_LABEL}${lightmap ? ' lightmap' : ' sky'}`
    return preparedComputeStage(
      device,
      device.createPipelineLayout({
        bindGroupLayouts: [layouts[0], lightmap ? layouts[1] : noLightmapLayout, layouts[2]],
      }),
      device.createShaderModule({ label, code: lightDirectionShader(lightmap) }),
      'lightDirection',
      undefined,
      label,
    )
  })
  return { layouts, noLightmapLayout, of: (lightmap: boolean) => programs.of(lightmap) }
}

/**
 * THE CAPSULE SHADOW PROGRAMS, once a device, each prepared off the thread (`PreparedPipeline`): the shadow passes by mode and caster use
 * (`shadow`), the upsample draws by targets (`upsample`), the composition into a sun's mask and the pass that derives the light directions (`directions`),
 * with the layouts of their groups. A pipeline that is not compiled is skipped by the frame, which waits for it (`PreparedPipeline.ask`).
 */
export const capsulePrograms = oncePerDevice((device: GPUDevice) => {
  const shadows = shadowPrograms(device)
  const upsample = upsamplePrograms(device)
  const compose = composePrograms(device)
  const directions = directionPrograms(device)
  return {
    shadow: (key: CapsuleProgramKey) => shadows.of(key),
    upsampleLayout: upsample.layout,
    composeLayout: compose.layout,
    composeSun: compose.stage,
    upsample: upsample.of,
    directionLayouts: directions.layouts,
    noLightmapLayout: directions.noLightmapLayout,
    directions: directions.of,
  }
})
