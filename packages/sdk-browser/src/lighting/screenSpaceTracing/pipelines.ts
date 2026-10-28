import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { pipelineLayoutOf, preparedPipeline } from '../deferred/fullscreen.ts'
import { hizDepthEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { SCREEN_REFLECTION_LEVEL_CODE } from './screenSpaceQuality.ts'
import { SCREEN_SPACE_BINDINGS as B } from './rayCastWgsl.ts'
import { SCREEN_SPACE_VIEW_BYTES } from './screenSpaceView.ts'
import { screenReflectionsWgsl, screenReflectionTilesWgsl } from './reflectionsWgsl.ts'
import { PREV_FRAME_BINDINGS, prevFrameFirstWgsl, prevFrameLowerWgsl } from './prevFrameWgsl.ts'
import { COMPOSE_INPUT_BINDING, composeWgsl } from './composeWgsl.ts'
import { skyLightReadLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { REFLECTION_SKY_LIGHT } from '../reflections/viewLayout.ts'
import { HALF_RES_BINDINGS, halfResWgsl } from './halfResWgsl.ts'
import { diffuseWgsl } from './diffuseWgsl.ts'
import { TEMPORAL_HISTORY_BINDING, temporalWgsl } from './temporalWgsl.ts'
import type { ScreenReflectionQuality } from '../../../../sdk-core/src/contracts/screenSpaceTracingOptions.ts'

const FRAGMENT = 2
const VERTEX = 1
const HDR = 'rgba16float' as const

/** The inputs every pass reads (SCREEN_SPACE_INPUTS_WGSL): the view, the depth pyramid, the surface's normals, flags and lobes, the image
 *  held and its sampler, the vectors. */
export const inputEntries = (visibility: number): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(B.view, { minBindingSize: SCREEN_SPACE_VIEW_BYTES }, visibility),
  ...hizDepthEntries(B.hiz, visibility),
  computeTextureEntry(B.normals, 'unfilterable-float', '2d', visibility),
  computeTextureEntry(B.flags, 'uint', '2d', visibility),
  computeTextureEntry(B.lobes, 'uint', '2d', visibility),
  computeTextureEntry(B.color, 'float', '2d', visibility),
  computeSamplerEntry(B.colorSampler, 'filtering', visibility),
  computeTextureEntry(B.vectors, 'uint', '2d', visibility),
]

type LayoutMaker = (entries: GPUBindGroupLayoutEntry[], label: string) => GPUBindGroupLayout

/** The layouts of the reflections: the draws, the compute pass (with the denoiser's second output) and the tiles' passes. */
const reflectionLayouts = (make: LayoutMaker) => {
  const draw = COMPUTE | FRAGMENT | VERTEX
  return {
    // A draw binds no storage texture: the target it writes is attached, and one texture is not both in a pass.
    reflectionDraw: make(
      [...inputEntries(draw), computeBufferEntry(B.list, 'read-only-storage', VERTEX)],
      'reflection draw',
    ),
    reflection: make(
      [
        ...inputEntries(draw),
        computeStorageTextureEntry(B.out, HDR, 'write-only', '2d', COMPUTE),
        computeBufferEntry(B.list, 'read-only-storage', VERTEX),
      ],
      'reflection',
    ),
    reflectionDenoised: make(
      [
        ...inputEntries(draw),
        computeStorageTextureEntry(B.out, HDR, 'write-only', '2d', COMPUTE),
        computeStorageTextureEntry(B.outSecond, 'r32float', 'write-only', '2d', COMPUTE),
        computeBufferEntry(B.list, 'read-only-storage', VERTEX),
      ],
      'reflection denoised',
    ),
    tiles: make(
      [
        ...inputEntries(COMPUTE),
        computeBufferEntry(B.out, 'storage'),
        computeBufferEntry(B.outSecond, 'storage'),
        computeBufferEntry(B.list, 'storage'),
      ],
      'reflection tiles',
    ),
  }
}

/** The layouts of the last image's reduction, of the temporal filter and of the composition. */
const reductionLayouts = (make: LayoutMaker) => ({
  reduceFirst: make(
    [
      ...inputEntries(COMPUTE),
      computeTextureEntry(PREV_FRAME_BINDINGS.prevDepth, 'unfilterable-float'),
      computeStorageTextureEntry(B.out, HDR),
      computeStorageTextureEntry(B.outSecond, HDR),
    ],
    'reduction first',
  ),
  reduceLower: make(
    [
      ...inputEntries(COMPUTE),
      computeTextureEntry(PREV_FRAME_BINDINGS.higher, 'float'),
      computeStorageTextureEntry(B.out, HDR),
      computeStorageTextureEntry(B.outSecond, HDR),
      computeStorageTextureEntry(PREV_FRAME_BINDINGS.outThird, HDR),
    ],
    'reduction lower',
  ),
  temporal: make(
    [
      ...inputEntries(COMPUTE),
      computeTextureEntry(TEMPORAL_HISTORY_BINDING, 'unfilterable-float'),
      computeStorageTextureEntry(B.out, HDR),
    ],
    'temporal',
  ),
  compose: make(
    [
      ...inputEntries(COMPUTE),
      computeTextureEntry(COMPOSE_INPUT_BINDING, 'float'),
      computeStorageTextureEntry(B.out, HDR, 'write-only', '2d-array'),
    ],
    'compose',
  ),
})

/** The layouts of the half-resolution pass and of the indirect diffuse light. */
const lightLayouts = (make: LayoutMaker) => ({
  halfRes: make(
    [
      computeTextureEntry(HALF_RES_BINDINGS.source, 'float'),
      computeStorageTextureEntry(HALF_RES_BINDINGS.result, HDR),
    ],
    'half resolution',
  ),
  diffuse: make(
    [
      ...inputEntries(COMPUTE),
      computeStorageTextureEntry(B.out, HDR),
      computeStorageTextureEntry(B.outSecond, 'r32float'),
    ],
    'diffuse',
  ),
})

/** The bind group layouts of the passes, once a device. */
export const screenSpaceLayouts = oncePerDevice((device: GPUDevice) => {
  const make: LayoutMaker = (entries, label) =>
    device.createBindGroupLayout({ label: `Trillion3D screen space ${label}`, entries })
  return {
    ...reflectionLayouts(make),
    ...reductionLayouts(make),
    sky: device.createBindGroupLayout({
      label: 'Trillion3D screen space sky',
      entries: skyLightReadLayoutEntries(REFLECTION_SKY_LIGHT, COMPUTE),
    }),
    ...lightLayouts(make),
  }
})

/** The format the stencil of the reflections' pre-pass lives in, and the value it marks the pixels that do not trace with. */
export const SCREEN_REFLECTION_STENCIL_FORMAT: GPUTextureFormat = 'stencil8'
export const SCREEN_REFLECTION_STENCIL_REFERENCE = 0x80

const stencilFace = (compare: GPUCompareFunction, passOp: GPUStencilOperation) => ({
  compare,
  failOp: 'keep' as const,
  depthFailOp: 'keep' as const,
  passOp,
})

/** The compute stages and render pipelines of one reflection level, prepared off the frame, once a device and a level. */
const reflectionsOf = oncePerDevice((device: GPUDevice) => {
  const layouts = screenSpaceLayouts(device)
  const build = (code: number, denoised: boolean) => {
    const module = device.createShaderModule({
      label: 'Trillion3D screen reflections',
      code: screenReflectionsWgsl(code, denoised),
    })
    const layout = pipelineLayoutOf(device, [
      denoised ? layouts.reflectionDenoised : layouts.reflection,
    ])
    const drawLayout = pipelineLayoutOf(device, [layouts.reflectionDraw])
    const face = (stencil: 'write' | 'test') =>
      stencil === 'write' ? stencilFace('always', 'replace') : stencilFace('not-equal', 'keep')
    const raster = (
      vertex: 'fullscreenVertex' | 'tileVertex',
      fragment: string,
      stencil: 'none' | 'write' | 'test',
    ) =>
      preparedPipeline(device, {
        label: `Trillion3D screen reflections ${fragment}`,
        layout: drawLayout,
        vertex: { module, entryPoint: vertex },
        fragment: {
          module,
          entryPoint: fragment,
          targets: denoised
            ? [{ format: HDR }, { format: 'r32float' as const }]
            : [{ format: HDR }],
        },
        primitive: { topology: 'triangle-list' },
        ...(stencil !== 'none' && {
          depthStencil: {
            format: SCREEN_REFLECTION_STENCIL_FORMAT,
            depthWriteEnabled: false,
            depthCompare: 'always' as const,
            stencilFront: face(stencil),
            stencilBack: face(stencil),
            stencilReadMask: 0xff,
            stencilWriteMask: 0xff,
          },
        }),
      })
    return {
      compute: preparedComputeStage(device, layout, module, 'reflectionCompute'),
      fullscreen: raster('fullscreenVertex', 'reflectionFragment', 'none'),
      fullscreenStenciled: raster('fullscreenVertex', 'reflectionFragment', 'test'),
      tiled: raster('tileVertex', 'reflectionFragment', 'none'),
      tiledShown: raster('tileVertex', 'reflectionTilesFragment', 'none'),
      stencil: raster('fullscreenVertex', 'reflectionStencil', 'write'),
    }
  }
  const byLevel = new Map<string, ReturnType<typeof build>>()
  return (code: number, denoised: boolean) => {
    const key = `${code}:${denoised}`
    let made = byLevel.get(key)
    if (!made) byLevel.set(key, (made = build(code, denoised)))
    return made
  }
})

/** The reflections' pipelines at the level quality, for device; `denoised`: the trace that also gives the denoiser how far its rays went. */
export const screenReflectionPipelines = (
  device: GPUDevice,
  quality: ScreenReflectionQuality,
  denoised = false,
) => reflectionsOf(device)(SCREEN_REFLECTION_LEVEL_CODE[quality], denoised)

/** The tile classification's two compute stages, once a device. */
export const screenReflectionTilePipelines = oncePerDevice((device: GPUDevice) => {
  const module = device.createShaderModule({
    label: 'Trillion3D screen reflection tiles',
    code: screenReflectionTilesWgsl(),
  })
  const layout = pipelineLayoutOf(device, [screenSpaceLayouts(device).tiles])
  return {
    mark: preparedComputeStage(device, layout, module, 'reflectionTileMark'),
    list: preparedComputeStage(device, layout, module, 'reflectionTileList'),
  }
})

/** The last image's reduction, its two compute stages, once a device. */
export const prevFrameReductionPipelines = oncePerDevice((device: GPUDevice) => {
  const layouts = screenSpaceLayouts(device)
  const first = device.createShaderModule({
    label: 'Trillion3D screen space reduction first',
    code: prevFrameFirstWgsl(),
  })
  const lower = device.createShaderModule({
    label: 'Trillion3D screen space reduction lower',
    code: prevFrameLowerWgsl(),
  })
  return {
    first: preparedComputeStage(
      device,
      pipelineLayoutOf(device, [layouts.reduceFirst]),
      first,
      'reduceFirst',
    ),
    lower: preparedComputeStage(
      device,
      pipelineLayoutOf(device, [layouts.reduceLower]),
      lower,
      'reduceLower',
    ),
  }
})

/** The indirect diffuse light's compute stage at the quality level (1 to 4), once a device and a level. */
const diffuseByLevel = oncePerDevice((device: GPUDevice) => {
  const made = new Map<number, ReturnType<typeof preparedComputeStage>>()
  return (level: number) => {
    let stage = made.get(level)
    if (!stage) {
      const module = device.createShaderModule({
        label: 'Trillion3D screen space diffuse',
        code: diffuseWgsl(level),
      })
      stage = preparedComputeStage(
        device,
        pipelineLayoutOf(device, [screenSpaceLayouts(device).diffuse]),
        module,
        'diffuseCompute',
      )
      made.set(level, stage)
    }
    return stage
  }
})
export const screenDiffusePipeline = (device: GPUDevice, level: number) =>
  diffuseByLevel(device)(level)

/** The temporal filter of the reflections, its compute stage, once a device. */
export const screenReflectionTemporalPipeline = oncePerDevice((device: GPUDevice) =>
  preparedComputeStage(
    device,
    pipelineLayoutOf(device, [screenSpaceLayouts(device).temporal]),
    device.createShaderModule({
      label: 'Trillion3D screen reflection temporal',
      code: temporalWgsl(),
    }),
    'temporalCompute',
  ),
)

/** The composition of the traced reflections with the environment, its compute stage, once a device. */
export const screenReflectionComposePipeline = oncePerDevice((device: GPUDevice) => {
  const layouts = screenSpaceLayouts(device)
  return preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layouts.compose, layouts.sky] }),
    device.createShaderModule({
      label: 'Trillion3D screen reflection compose',
      code: composeWgsl(),
    }),
    'composeCompute',
  )
})

/** The half-resolution copy of the last lit image, its compute stage, once a device. */
export const screenHalfResPipeline = oncePerDevice((device: GPUDevice) =>
  preparedComputeStage(
    device,
    pipelineLayoutOf(device, [screenSpaceLayouts(device).halfRes]),
    device.createShaderModule({
      label: 'Trillion3D screen space half resolution',
      code: halfResWgsl(),
    }),
    'halfResCompute',
  ),
)
