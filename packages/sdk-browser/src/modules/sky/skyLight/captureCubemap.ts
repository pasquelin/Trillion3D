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
interface CubemapShared {
  readonly device: GPUDevice
  readonly failed: (error: unknown) => void
  readonly filters: FilterStage
  /** Made when the first cubemap is captured. */
  pipelines?: CubemapPipelines
  copyBlock?: { for: SkyLightTargets; group: GPUBindGroup }
  sampler?: GPUSampler
  readonly copyFloats: Float32Array
  readonly copyUints: Uint32Array
}

/** The capture of one cube: the source (`w` 0) or the blend's destination (`w` 1, `SetCubemapBlend`), each its own
 *  filtered cube and harmonics, captured in a frame of its own (they share the copy's block). */
interface CubemapHolds {
  readonly w: 0 | 1
  readonly shared: CubemapShared
  key?: Held
  state: ReturnType<typeof newCubemapState>
  scales: ReturnType<typeof skyLightCubemapScales>
  done: boolean
  refused?: GPUTexture
  measuring?: CubemapMeasure
  copySource?: { for: GPUTexture; group: GPUBindGroup }
}

/** The groups of the copy: the host's cube read bilinearly, and the copy's block. */
function copyGroups(
  h: CubemapHolds,
  t: SkyLightTargets,
  cubemap: GPUTexture,
  made: CubemapPipelines,
) {
  const { device } = h.shared
  if (h.copySource?.for !== cubemap) {
    h.shared.sampler ??= device.createSampler({
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
          { binding: 1, resource: h.shared.sampler },
        ],
      }),
    }
  }
  if (h.shared.copyBlock?.for !== t)
    h.shared.copyBlock = {
      for: t,
      group: device.createBindGroup({
        layout: made.layouts.block,
        entries: [{ binding: 0, resource: { buffer: t.blocks.copy, size: COPY_LAYOUT.words * 4 } }],
      }),
    }
  return { source: h.copySource.group, block: h.shared.copyBlock.group }
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
    h.shared.copyUints.set(
      [face, light.lowerHemisphereIsSolidColor ? 1 : 0, measure ? 0 : 1, 0],
      at.face,
    )
    h.shared.copyFloats.set([Math.sin(rotation), Math.cos(rotation), 1 / t.width, 0], at.rotation)
    h.shared.copyFloats.set([...light.lowerHemisphereColor, 1], at.lower)
    h.shared.copyFloats.set([scale, scale, scale, 1], at.scale)
    const offset = (first + face) * BLOCK_STRIDE
    writeBlock(h.shared.device, t.blocks.copy, offset, h.shared.copyFloats)
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
  const m = (h.measuring = createCubemapMeasure(
    h.shared.device,
    made,
    t.width,
    t.mips,
    t.blocks.filter,
  ))
  copyFaces(h, encoder, t, input, cubemap, made, m)
  downsampleMips(
    h.shared.filters,
    encoder,
    t,
    'Trillion3D sky light cubemap brightness mips',
    made.pipelines.downsample.get(),
    m.downsample,
  )
  const gather = encoder.beginComputePass({ label: 'Trillion3D sky light cubemap brightness' })
  gather.setPipeline(made.pipelines.gather.get())
  gather.setBindGroup(0, m.gather, [filterSlot(h.shared.filters, t, t.mips - 1, 0)])
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
      h.shared.failed(error)
    },
  )
}

/** Whether the cube can be captured: a 32-bit float one needs the device feature, else it is refused
 *  once. */
function acceptable(h: CubemapHolds, cubemap: GPUTexture, wide: boolean) {
  if (!wide || h.shared.device.features.has('float32-filterable')) return true
  h.refused = cubemap
  h.shared.failed(
    new Error('A 32-bit float sky light cubemap needs the device feature float32-filterable'),
  )
  return false
}

/** The cube `cubemap` taken to filtered cube `h.w` and its harmonics, whole in a frame once for a
 *  cube, an angle, a side and a lower-hemisphere flag. */
function encodeCubemap(
  h: CubemapHolds,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  input: SkyLightInputs,
  cubemap: GPUTexture,
) {
  if (cubemap === h.refused) return
  const { shared } = h
  const wide = cubemap.format === LUMINANCE_FORMAT
  if (!acceptable(h, cubemap, wide)) return
  const made = (shared.pipelines ??= createCubemapPipelines(shared.device, shared.failed))
  if (!made.ready(wide)) return
  const key = [
    cubemap,
    skyLightCubemapRotation(input.part),
    t.width,
    input.part.light.lowerHemisphereIsSolidColor,
  ]
  if (!sameHeld(h.key, key)) {
    h.key = key
    h.done = false
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
      mipChain(shared.filters, encoder, t)
      filter(shared.filters, encoder, t, h.w, 0, t.mips - 1, 0, CUBE_FACES)
      harmonics(shared.filters, encoder, t, h.w)
      h.done = true
      break
    case 'nothing':
      break
  }
}

/** A cube's capture state, none yet. */
const newHolds = (w: 0 | 1, shared: CubemapShared): CubemapHolds => ({
  w,
  shared,
  state: newCubemapState(false),
  scales: skyLightCubemapScales(0),
  done: false,
})

/**
 * The capture of a specified cubemap, and of the cube it blends to (`SkyLightInputs.blend`,
 * `SetCubemapBlend`): `encode` this frame's work — the source first, the destination in the frames
 * after the source is done —, `reset` when the targets or the source change, `done`, `scales` and
 * `blend` for what the lighting reads, and `dispose`.
 */
export function createCubemapCapture(
  device: GPUDevice,
  failed: (error: unknown) => void,
  filters: FilterStage,
) {
  const words = new ArrayBuffer(COPY_LAYOUT.words * 4)
  const shared: CubemapShared = {
    device,
    failed,
    filters,
    copyFloats: new Float32Array(words),
    copyUints: new Uint32Array(words),
  }
  const [source, destination] = [newHolds(0, shared), newHolds(1, shared)]
  /** The fraction of the destination the lighting reads, clamped to 0 .. 1: `blend` of an unfinished or absent destination is 0. */
  let fraction = 0
  return {
    encode(encoder: GPUCommandEncoder, t: SkyLightTargets, input: SkyLightInputs) {
      const { cubemap, blend } = input
      // A destination is captured once the source is, never in its frame (the copy's blocks are shared).
      const sourceDone = source.done
      if (cubemap) encodeCubemap(source, encoder, t, input, cubemap)
      const next = blend && blend.fraction > 0 && sourceDone ? blend : undefined
      if (next) encodeCubemap(destination, encoder, t, input, next.destination)
      fraction = next && destination.done ? Math.min(next.fraction, 1) : 0
    },
    reset() {
      for (const h of [source, destination]) {
        h.key = undefined
        h.done = false
      }
      fraction = 0
    },
    /** The cubemap's and the captured scene's pipelines, made at the first call. */
    pipelines: () => (shared.pipelines ??= createCubemapPipelines(device, failed)),
    get done() {
      return source.done
    },
    /** The cube the lighting reads first: the source, or, a blend whole, the destination. */
    get layer(): 0 | 1 {
      return fraction >= 1 ? 1 : 0
    },
    /** The share of the destination the lighting mixes into the source's cube (0 when none, or when
     *  the destination is the cube read). */
    get blend() {
      return fraction >= 1 ? 0 : fraction
    },
    get scales() {
      return fraction >= 1 ? destination.scales : source.scales
    },
    dispose() {
      source.measuring?.destroy()
      destination.measuring?.destroy()
      source.measuring = destination.measuring = undefined
    },
  }
}
