import {
  skyLightCubemapRotation,
  skyLightCubemapScales,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { COPY_LAYOUT, LUMINANCE_FORMAT } from './copyWgsl.ts'
import { createCubemapMeasure, type CubemapMeasure } from './cubemapMeasure.ts'
import { createCubemapPipelines, type CubemapPipelines } from './cubemapPipelines.ts'
import { advanceCubemap, cubemapMeasured, newCubemapState } from './cubemapSchedule.ts'
import { sameHeld, writeBlock, type Held, type SkyLightInputs } from './captureInputs.ts'
import {
  downsampleMips,
  filter,
  filterSlot,
  harmonics,
  mipChain,
  type FilterStage,
} from './captureFilter.ts'
import { BLOCK_STRIDE, CUBE_FACES } from './layout.ts'
import type { SkyLightTargets } from './targets.ts'

/**
 * THE CAPTURE OF A SPECIFIED CUBEMAP (`cubemapSchedule.ts`): the host's cube taken to the filtered
 * cube and the harmonics, whole in a frame once for a cube, an angle, a side and a lower-hemisphere
 * flag; first, for a 32-bit float cube, its brightest value found on the GPU and read back.
 */
interface CubemapHolds {
  readonly device: GPUDevice
  readonly failed: (error: unknown) => void
  readonly filters: FilterStage
  /** Made when the first cubemap is captured. */
  pipelines?: CubemapPipelines
  key?: Held
  state: ReturnType<typeof newCubemapState>
  scales: ReturnType<typeof skyLightCubemapScales>
  done: boolean
  refused?: GPUTexture
  measuring?: CubemapMeasure
  copySource?: { for: GPUTexture; group: GPUBindGroup }
  copyBlock?: { for: SkyLightTargets; group: GPUBindGroup }
  sampler?: GPUSampler
  readonly copyFloats: Float32Array
  readonly copyUints: Uint32Array
}

/** The groups of the copy: the host's cube read bilinearly, and the copy's block. */
function copyGroups(
  h: CubemapHolds,
  t: SkyLightTargets,
  cubemap: GPUTexture,
  made: CubemapPipelines,
) {
  const { device } = h
  if (h.copySource?.for !== cubemap) {
    h.sampler ??= device.createSampler({
      label: 'Trillion3D sky light cubemap',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    })
    h.copySource = {
      for: cubemap,
      group: device.createBindGroup({
        layout: made.layouts.source,
        entries: [
          {
            binding: 0,
            resource: cubemap.createView({ dimension: 'cube', baseMipLevel: 0, mipLevelCount: 1 }),
          },
          { binding: 1, resource: h.sampler },
        ],
      }),
    }
  }
  if (h.copyBlock?.for !== t)
    h.copyBlock = {
      for: t,
      group: device.createBindGroup({
        layout: made.layouts.block,
        entries: [{ binding: 0, resource: { buffer: t.blocks.copy, size: COPY_LAYOUT.words * 4 } }],
      }),
    }
  return { source: h.copySource.group, block: h.copyBlock.group }
}

/** The faces of the captured cube written from the host's cube (`copyFaceMain`) — or, when
 *  `measure` is there, the faces of its 32-bit float cube, not rescaled nor held to the half
 *  float's range. */
function copyFaces(
  h: CubemapHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
  cubemap: GPUTexture,
  made: CubemapPipelines,
  measure?: CubemapMeasure,
) {
  const groups = copyGroups(h, t, cubemap, made)
  const { at } = COPY_LAYOUT
  const { light } = input.part
  const rotation = skyLightCubemapRotation(input.part)
  const scale = measure ? 1 : h.scales.cube
  const pipeline = (measure ? made.pipelines.copyWide : made.pipelines.copy).get()
  const first = measure ? CUBE_FACES : 0
  for (let face = 0; face < CUBE_FACES; face++) {
    h.copyUints.set([face, light.lowerHemisphereIsSolidColor ? 1 : 0, measure ? 0 : 1, 0], at.face)
    h.copyFloats.set([Math.sin(rotation), Math.cos(rotation), 1 / t.width, 0], at.rotation)
    h.copyFloats.set([...light.lowerHemisphereColor, 1], at.lower)
    h.copyFloats.set([scale, scale, scale, 1], at.scale)
    const offset = (first + face) * BLOCK_STRIDE
    writeBlock(h.device, t.blocks.copy, offset, h.copyFloats)
    const pass = encoder.beginRenderPass({
      label: 'Trillion3D sky light cubemap copy',
      colorAttachments: [
        {
          view: measure ? measure.faceTargets[face] : t.faceTargets[face],
          loadOp: 'clear',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, groups.source)
    pass.setBindGroup(1, groups.block, [offset])
    pass.draw(3)
    pass.end()
  }
}

/** The brightest value of the 32-bit float cube, found on the GPU into a buffer it is read back
 *  from. */
function measureCube(
  h: CubemapHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
  cubemap: GPUTexture,
  made: CubemapPipelines,
) {
  h.measuring?.destroy()
  const m = (h.measuring = createCubemapMeasure(h.device, made, t.width, t.mips, t.blocks.filter))
  copyFaces(h, encoder, t, input, cubemap, made, m)
  downsampleMips(
    h.filters,
    encoder,
    t,
    'Trillion3D sky light cubemap brightness mips',
    made.pipelines.downsample.get(),
    m.downsample,
  )
  const gather = encoder.beginComputePass({ label: 'Trillion3D sky light cubemap brightness' })
  gather.setPipeline(made.pipelines.gather.get())
  gather.setBindGroup(0, m.gather, [filterSlot(h.filters, t, t.mips - 1, 0)])
  gather.dispatchWorkgroups(1)
  gather.end()
  encoder.copyBufferToBuffer(m.peak, 0, m.read, 0, 4)
}

/** The measured buffer is mapped (the frame that wrote it was submitted): the capture follows
 *  the frame its value is known in. */
function mapBrightest(h: CubemapHolds) {
  const m = h.measuring
  if (!m) return
  m.value().then(
    (peak) => {
      if (h.measuring !== m) return
      h.measuring = undefined
      h.scales = skyLightCubemapScales(peak)
      cubemapMeasured(h.state)
    },
    (error: unknown) => {
      if (h.measuring !== m) return
      h.measuring = undefined
      h.failed(error)
    },
  )
}

/** Whether the cube can be captured: a 32-bit float one needs the device feature, else it is refused
 *  once. */
function acceptable(h: CubemapHolds, cubemap: GPUTexture, wide: boolean) {
  if (!wide || h.device.features.has('float32-filterable')) return true
  h.refused = cubemap
  h.failed(
    new Error('A 32-bit float sky light cubemap needs the device feature float32-filterable'),
  )
  return false
}

/** The host's cube taken to the filtered cube and the harmonics, whole in a frame once for a
 *  cube, an angle, a side and a lower-hemisphere flag; none without a cube. */
function encodeCubemap(
  h: CubemapHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
) {
  const { cubemap } = input
  if (!cubemap || cubemap === h.refused) return
  const wide = cubemap.format === LUMINANCE_FORMAT
  if (!acceptable(h, cubemap, wide)) return
  const made = (h.pipelines ??= createCubemapPipelines(h.device, h.failed))
  if (!made.ready(wide)) return
  const key = [
    cubemap,
    skyLightCubemapRotation(input.part),
    t.width,
    input.part.light.lowerHemisphereIsSolidColor,
  ]
  if (!sameHeld(h.key, key)) {
    h.key = key
    h.measuring?.destroy()
    h.measuring = undefined
    h.state = newCubemapState(wide)
    h.scales = skyLightCubemapScales(0)
  }
  switch (advanceCubemap(h.state)) {
    case 'measure':
      measureCube(h, encoder, t, input, cubemap, made)
      break
    case 'map':
      mapBrightest(h)
      break
    case 'copy':
      copyFaces(h, encoder, t, input, cubemap, made)
      mipChain(h.filters, encoder, t)
      filter(h.filters, encoder, t, 0, 0, t.mips - 1, 0, CUBE_FACES)
      harmonics(h.filters, encoder, t, 0)
      h.done = true
      break
    case 'nothing':
      break
  }
}

/** The capture of a specified cubemap: `encode` this frame's work, `reset` when the targets or the
 *  source change, `done` and `scales` for what the lighting reads, and `dispose`. */
export function createCubemapCapture(
  device: GPUDevice,
  failed: (error: unknown) => void,
  filters: FilterStage,
) {
  const words = new ArrayBuffer(COPY_LAYOUT.words * 4)
  const h: CubemapHolds = {
    device,
    failed,
    filters,
    state: newCubemapState(false),
    scales: skyLightCubemapScales(0),
    done: false,
    copyFloats: new Float32Array(words),
    copyUints: new Uint32Array(words),
  }
  return {
    encode: (encoder: GPUCommandEncoder, t: SkyLightTargets, input: SkyLightInputs) =>
      encodeCubemap(h, encoder, t, input),
    reset() {
      h.key = undefined
      h.done = false
    },
    get done() {
      return h.done
    },
    get scales() {
      return h.scales
    },
    dispose() {
      h.measuring?.destroy()
      h.measuring = undefined
    },
  }
}
