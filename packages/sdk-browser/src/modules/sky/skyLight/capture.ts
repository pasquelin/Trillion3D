import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import type { ResolvedAtmosphere } from '../../../../../sdk-core/src/scene/core/atmosphere.ts'
import {
  skyLightCloudWidth,
  skyLightCubemapRotation,
  skyLightCubemapScales,
  skyLightSource,
  type SkyLightPart,
} from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import type { CloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { AIR_BINDING, AIR_FOG_BINDINGS } from '../../../lighting/atmosphere/programs.ts'
import { FRAME_FLOATS, writeAirFrame } from '../../../lighting/atmosphere/frame.ts'
import { fogReadBindEntries, type FogRead } from '../../../lighting/fog/read.ts'
import {
  CLOUD_TRACE_BINDING as B,
  CLOUD_TRACE_LAYOUT,
  markCloudTraceCapture,
  writeCloudTrace,
  type CloudTraceImage,
} from '../clouds/traceLayout.ts'
import type { CloudFramePlan } from '../clouds/reconstruct.ts'
import { cloudSizes } from '../clouds/reconstructLayout.ts'
import { CLOUD_TRACE_GROUP_SIZE } from '../clouds/traceWgsl.ts'
import { COPY_LAYOUT, LUMINANCE_FORMAT } from './copyWgsl.ts'
import { createCubemapMeasure, type CubemapMeasure } from './cubemapMeasure.ts'
import { createCubemapPipelines, type CubemapPipelines } from './cubemapPipelines.ts'
import { advanceCubemap, cubemapMeasured, newCubemapState } from './cubemapSchedule.ts'
import { FACE_LAYOUT } from './faceWgsl.ts'
import { faceCamera } from './faces.ts'
import { BLOCK_STRIDE, CUBE_FACES, FILTER_GROUP_SIDE, groupsOver, irradianceMip } from './layout.ts'
import { createSkyLightPipelines } from './pipelines.ts'
import { advanceCapture, newCaptureState, workIndex, type CaptureState } from './schedule.ts'
import { createSkyLightTargets, type SkyLightTargets } from './targets.ts'

/**
 * THE SKY LIGHT'S CAPTURE, encoded a frame at a time: the sky and the clouds drawn into the faces
 * of a cube, the cube's mips, the cube filtered by roughness, and the diffuse light summed into
 * harmonics, on the steps and in the order `schedule.ts` says. Nothing is wired into a frame: the
 * owner calls `encode` once a frame, before the passes that read the light, and reads the ready
 * cube and the harmonics through `read`.
 *
 * The air's sky and the distant fog are drawn into a face by render passes, the clouds are traced
 * into a texture of the cloud divider's side by the clouds part's own tracing (`clouds/trace.ts`,
 * one dispatch a face) and laid over the face with the lower hemisphere's colour; the mips and the
 * filter are compute passes writing the cubes' slices. Each face's passes follow each other in
 * the command stream, so the one texture of clouds is shared by the faces.
 */

/** What a frame tells the capture. */
export interface SkyLightInputs {
  readonly part: SkyLightPart
  /** The cube's side (`skyLightCubeWidth`). */
  readonly width: number
  /** The frame's index (the clouds' noise) and the time in seconds. */
  readonly frame: number
  /** Where the sky light stands, in the scene, metres. */
  readonly position: readonly [number, number, number]
  /** The air: its light buffer and tables, the resolved atmosphere the frame reads; none where
   *  neither an atmosphere nor clouds are shown. */
  readonly air?: {
    readonly resolved: ResolvedAtmosphere
    readonly buffer: GPUBuffer
    readonly transmittance: GPUTextureView
    readonly multiScatter: GPUTextureView
    readonly sampler: GPUSampler
  }
  /** The host's cube, when the light's source is a specified cubemap and it captures no sky in
   *  real time (`skyLightSource`): six square faces of one side, a cube-compatible 2d array texture
   *  with `TEXTURE_BINDING` (`createSkyCubemapFromImages` makes one from six images). Its top level
   *  is read, bilinearly; a 32-bit float one needs the device's `float32-filterable`. None, the
   *  light has no sky. */
  readonly cubemap?: GPUTexture
  /** Whether the scene has an atmosphere, drawn into the faces. */
  readonly atmosphere: boolean
  /** The fog's resources, bound by the programs that read the fog (the distant fog and the clouds'
   *  tracing): its cubemap and sampler, and the stand-ins that answer no volume and no frame
   *  (`createFogStandIns`), for the capture holds no volumetric fog. */
  readonly fog?: FogRead
  /** Whether the fog shows in the sky capture: the distant height fog is then laid over the sky. */
  readonly fogShown: boolean
  /** The clouds, where the scene has them: the part, the material's seven bindings of the
   *  tracing's group (from `B.material`), the blue noise's view and the time in seconds. */
  readonly clouds?: {
    readonly part: CloudPart
    readonly material: readonly GPUBindGroupEntry[]
    readonly blueNoise: GPUTextureView
    readonly time: number
    /** What the tracing is told of the air, as for the view (`CloudTraceImage`). */
    readonly air: Pick<CloudTraceImage, 'airPresent' | 'lightScales'>
  }
}

/** Identities a bind group made of them is kept for. */
type Held = readonly unknown[]
const sameHeld = (a: Held | undefined, b: Held) => !!a && a.every((x, i) => x === b[i])

export function createSkyLightCapture(device: GPUDevice, failed: (error: unknown) => void) {
  const made = createSkyLightPipelines(device, failed)
  const { layouts, pipelines, cloudTrace } = made
  let targets: SkyLightTargets | undefined
  let state: CaptureState = newCaptureState()
  let slot = 0
  const faceWords = new ArrayBuffer(FACE_LAYOUT.words * 4)
  const faceFloats = new Float32Array(faceWords)
  const faceUints = new Uint32Array(faceWords)
  const frameFloats = new Float32Array(FRAME_FLOATS)
  const traceFloats = new Float32Array(CLOUD_TRACE_LAYOUT.words)
  const traceWords = new Uint32Array(traceFloats.buffer)
  const blockWords = new Uint32Array(4)

  let source: ReturnType<typeof skyLightSource> | undefined

  // A specified cubemap's capture (`cubemapSchedule.ts`), made when the first one is captured.
  let cubemaps: CubemapPipelines | undefined
  let cubemapKey: Held | undefined
  let cubemapState = newCubemapState(false)
  let cubemapScales = skyLightCubemapScales(0)
  let cubemapDone = false
  let cubemapRefused: GPUTexture | undefined
  let measuring: CubemapMeasure | undefined
  let copySource: { for: GPUTexture; group: GPUBindGroup } | undefined
  let copyBlock: { for: SkyLightTargets; group: GPUBindGroup } | undefined
  let cubemapSampler: GPUSampler | undefined
  const copyWords = new ArrayBuffer(COPY_LAYOUT.words * 4)
  const copyFloats = new Float32Array(copyWords)
  const copyUints = new Uint32Array(copyWords)

  let faceGroup: { for: SkyLightTargets; group: GPUBindGroup } | undefined
  let skyHeld: Held | undefined, skyGroup: GPUBindGroup | undefined
  let fogHeld: Held | undefined, fogGroup: GPUBindGroup | undefined
  let traceHeld: Held | undefined,
    traceGroups: { air: GPUBindGroup; cloud: GPUBindGroup }[] = []

  const block = (buffer: GPUBuffer, at: number, data: ArrayBufferView) =>
    device.queue.writeBuffer(buffer, at, data.buffer, data.byteOffset, data.byteLength)

  /** The face block and the groups over the air, the fog and the clouds, for this frame's inputs. */
  function groupsFor(t: SkyLightTargets, input: SkyLightInputs) {
    if (faceGroup?.for !== t)
      faceGroup = {
        for: t,
        group: device.createBindGroup({
          layout: layouts.face,
          entries: [
            { binding: 0, resource: { buffer: t.blocks.face, size: FACE_LAYOUT.words * 4 } },
          ],
        }),
      }
    const { air, fog, clouds } = input
    if (air && !sameHeld(skyHeld, [air.buffer, air.transmittance, air.multiScatter, air.sampler])) {
      skyHeld = [air.buffer, air.transmittance, air.multiScatter, air.sampler]
      skyGroup = device.createBindGroup({
        layout: layouts.skyAir,
        entries: [
          { binding: AIR_BINDING.air, resource: { buffer: air.buffer } },
          { binding: AIR_BINDING.transmittance, resource: air.transmittance },
          { binding: AIR_BINDING.multiScatter, resource: air.multiScatter },
          { binding: AIR_BINDING.sampler, resource: air.sampler },
        ],
      })
    }
    if (air && fog && !sameHeld(fogHeld, [air.buffer, fog])) {
      fogHeld = [air.buffer, fog]
      fogGroup = device.createBindGroup({
        layout: layouts.fogAir,
        entries: [
          { binding: AIR_BINDING.air, resource: { buffer: air.buffer } },
          ...fogReadBindEntries(AIR_FOG_BINDINGS, fog),
        ],
      })
    }
    const traceKey = air &&
      fog &&
      clouds && [
        t,
        air.buffer,
        air.transmittance,
        air.sampler,
        fog,
        clouds.material,
        clouds.blueNoise,
      ]
    if (traceKey && !sameHeld(traceHeld, traceKey)) {
      traceHeld = traceKey
      traceGroups = Array.from({ length: CUBE_FACES }, (_, face) => ({
        air: device.createBindGroup({
          layout: cloudTrace.air,
          entries: [
            { binding: AIR_BINDING.air, resource: { buffer: air.buffer } },
            { binding: AIR_BINDING.transmittance, resource: air.transmittance },
            { binding: AIR_BINDING.sampler, resource: air.sampler },
            {
              binding: AIR_BINDING.frame,
              resource: {
                buffer: t.blocks.frame,
                offset: face * BLOCK_STRIDE,
                size: FRAME_FLOATS * 4,
              },
            },
            ...fogReadBindEntries(AIR_FOG_BINDINGS, fog),
          ],
        }),
        cloud: device.createBindGroup({
          layout: cloudTrace.cloud,
          entries: [
            ...clouds.material,
            {
              binding: B.block,
              resource: {
                buffer: t.blocks.trace,
                offset: face * BLOCK_STRIDE,
                size: CLOUD_TRACE_LAYOUT.words * 4,
              },
            },
            { binding: B.blueNoise, resource: clouds.blueNoise },
            { binding: B.depthRange, resource: t.cloudViews.depthRange },
            { binding: B.colour, resource: t.cloudViews.colour },
            { binding: B.secondary, resource: t.cloudViews.secondary },
            { binding: B.depth, resource: t.cloudViews.depth },
          ],
        }),
      }))
    }
  }

  /** Face `face`'s block: its number, whether the lower hemisphere is replaced and whether the
   *  clouds are laid, the position, the sides, and the lower colour with a coverage of one. */
  function writeFace(t: SkyLightTargets, face: number, input: SkyLightInputs, withClouds: boolean) {
    const { at } = FACE_LAYOUT
    const { light } = input.part
    faceUints.set([face, light.lowerHemisphereIsSolidColor ? 1 : 0, withClouds ? 1 : 0, 0], at.face)
    faceFloats.set([...input.position, 0], at.eye)
    faceFloats.set([t.width, 1 / t.width, t.cloudSide, 0], at.size)
    faceFloats.set([...light.lowerHemisphereColor, 1], at.lower)
    block(t.blocks.face, face * BLOCK_STRIDE, faceFloats)
  }

  /** The clouds of face `face` traced into the cloud texture. */
  function traceFace(
    encoder: GPUCommandEncoder,
    t: SkyLightTargets,
    face: number,
    input: SkyLightInputs,
    air: NonNullable<SkyLightInputs['air']>,
    clouds: NonNullable<SkyLightInputs['clouds']>,
  ) {
    const camera = faceCamera(face, input.position)
    const side = t.cloudSide
    writeAirFrame(
      frameFloats,
      { eye: input.position, world: camera.world, perspective: 1 },
      air.resolved,
      camera.viewProj,
      camera.inverseViewProj,
      side,
      side,
    )
    block(t.blocks.frame, face * BLOCK_STRIDE, frameFloats)
    // The view that traces a quarter of its size per axis is four times the side: the image is the
    // face's own pixels, not a cycle over a view's: no jitter, the reflection's sample counts.
    const view = { width: 4 * side, height: 4 * side }
    const plan: CloudFramePlan = {
      sizes: cloudSizes(view, view),
      rank: 0,
      offset: [0, 0],
      destination: 0,
      history: null,
      tracedStale: false,
      destinationStale: false,
    }
    writeCloudTrace(
      traceFloats,
      {
        inverseView: camera.inverseViewProj,
        view,
        frameIndex: input.frame,
        time: clouds.time,
        ...clouds.air,
      },
      plan,
      clouds.part,
    )
    const { at } = CLOUD_TRACE_LAYOUT
    const { gpu } = clouds.part
    traceFloats.fill(0, at.jitter, at.jitter + 4)
    // The capture is a reflection with no late fog and no scene depth (`markCloudTraceCapture`).
    markCloudTraceCapture(traceWords, clouds.part)
    traceFloats[at.samples] = gpu.reflectionSamplesMost
    traceFloats[at.samples + 1] = gpu.reflectionShadowSamplesMost
    block(t.blocks.trace, face * BLOCK_STRIDE, traceFloats)
    const pass = encoder.beginComputePass({ label: 'Trillion3D sky light clouds' })
    pass.setPipeline(cloudTrace.pipeline.get())
    pass.setBindGroup(0, traceGroups[face].air)
    pass.setBindGroup(1, traceGroups[face].cloud)
    const groups = workgroupCount(side, CLOUD_TRACE_GROUP_SIZE)
    pass.dispatchWorkgroups(groups, groups, 1)
    pass.end()
  }

  /** The sky (`withSky`) and the clouds (`withClouds`) of faces `first` to `end`. */
  function drawFaces(
    encoder: GPUCommandEncoder,
    t: SkyLightTargets,
    first: number,
    end: number,
    withSky: boolean,
    withClouds: boolean,
    input: SkyLightInputs,
  ) {
    const { air, clouds } = input
    const atmosphereDrawn = withSky && input.atmosphere && air !== undefined
    const composing =
      withClouds && (input.part.light.lowerHemisphereIsSolidColor || clouds !== undefined)
    const clearing = withSky && !atmosphereDrawn
    if (!atmosphereDrawn && !composing && !clearing) return
    groupsFor(t, input)
    for (let face = first; face < end; face++) {
      const traced =
        withClouds &&
        air !== undefined &&
        clouds?.part.settings.inSkyCapture === true &&
        input.fog !== undefined
      writeFace(t, face, input, traced)
      if (traced) traceFace(encoder, t, face, input, air, clouds)
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D sky light face',
        colorAttachments: [
          {
            view: t.faceTargets[face],
            loadOp: clearing ? 'clear' : 'load',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            storeOp: 'store',
          },
        ],
      })
      const offset = [face * BLOCK_STRIDE]
      if (atmosphereDrawn) {
        pass.setPipeline(pipelines.sky.get())
        pass.setBindGroup(0, skyGroup!)
        pass.setBindGroup(1, faceGroup!.group, offset)
        pass.draw(3)
        if (input.fog && input.fogShown) {
          pass.setPipeline(pipelines.fog.get())
          pass.setBindGroup(0, fogGroup!)
          pass.setBindGroup(1, faceGroup!.group, offset)
          pass.draw(3)
        }
      }
      if (composing) {
        pass.setPipeline(pipelines.compose.get())
        pass.setBindGroup(0, t.groups.clouds)
        pass.setBindGroup(1, faceGroup!.group, offset)
        pass.draw(3)
      }
      pass.end()
    }
  }

  /** A filtering block's slot, written: `mip`, the cube's mips, the first face. */
  function filterSlot(t: SkyLightTargets, mip: number, faceFirst: number) {
    blockWords.set([mip, t.mips, faceFirst, 0])
    const at = slot++ * BLOCK_STRIDE
    block(t.blocks.filter, at, blockWords)
    return at
  }

  /** Mips `1` to the last of the captured cube, each from the one above. */
  function mipChain(encoder: GPUCommandEncoder, t: SkyLightTargets) {
    const pass = encoder.beginComputePass({ label: 'Trillion3D sky light mips' })
    pass.setPipeline(pipelines.downsample.get())
    for (let mip = 1; mip < t.mips; mip++) {
      pass.setBindGroup(0, t.groups.downsample[mip]!, [filterSlot(t, mip, 0)])
      const side = groupsOver(t.width >> mip, FILTER_GROUP_SIDE)
      pass.dispatchWorkgroups(side, side, CUBE_FACES)
    }
    pass.end()
  }

  /** Mips `mipFirst` to `mipLast` of filtered cube `w`, faces `faceFirst` for `faceCount`. */
  function filter(
    encoder: GPUCommandEncoder,
    t: SkyLightTargets,
    w: 0 | 1,
    mipFirst: number,
    mipLast: number,
    faceFirst: number,
    faceCount: number,
  ) {
    const pass = encoder.beginComputePass({ label: 'Trillion3D sky light filter' })
    pass.setPipeline(pipelines.convolve.get())
    for (let mip = mipFirst; mip <= mipLast; mip++) {
      pass.setBindGroup(0, t.groups.convolve[w][mip], [filterSlot(t, mip, faceFirst)])
      const side = groupsOver(t.width >> mip, FILTER_GROUP_SIDE)
      pass.dispatchWorkgroups(side, side, faceCount)
    }
    pass.end()
  }

  /** The faces of the captured cube written from the host's cube (`copyFaceMain`) — or, when
   *  `measure` is there, the faces of its 32-bit float cube, not rescaled nor held to the half
   *  float's range. */
  function copyFaces(
    encoder: GPUCommandEncoder,
    t: SkyLightTargets,
    input: SkyLightInputs,
    cubemap: GPUTexture,
    made: CubemapPipelines,
    measure?: CubemapMeasure,
  ) {
    if (copySource?.for !== cubemap) {
      cubemapSampler ??= device.createSampler({
        label: 'Trillion3D sky light cubemap',
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
      })
      copySource = {
        for: cubemap,
        group: device.createBindGroup({
          layout: made.layouts.source,
          entries: [
            {
              binding: 0,
              resource: cubemap.createView({
                dimension: 'cube',
                baseMipLevel: 0,
                mipLevelCount: 1,
              }),
            },
            { binding: 1, resource: cubemapSampler },
          ],
        }),
      }
    }
    if (copyBlock?.for !== t)
      copyBlock = {
        for: t,
        group: device.createBindGroup({
          layout: made.layouts.block,
          entries: [
            { binding: 0, resource: { buffer: t.blocks.copy, size: COPY_LAYOUT.words * 4 } },
          ],
        }),
      }
    const { at } = COPY_LAYOUT
    const { light } = input.part
    const rotation = skyLightCubemapRotation(input.part)
    const scale = measure ? 1 : cubemapScales.cube
    const pipeline = (measure ? made.pipelines.copyWide : made.pipelines.copy).get()
    const first = measure ? CUBE_FACES : 0
    for (let face = 0; face < CUBE_FACES; face++) {
      copyUints.set([face, light.lowerHemisphereIsSolidColor ? 1 : 0, measure ? 0 : 1, 0], at.face)
      copyFloats.set([Math.sin(rotation), Math.cos(rotation), 1 / t.width, 0], at.rotation)
      copyFloats.set([...light.lowerHemisphereColor, 1], at.lower)
      copyFloats.set([scale, scale, scale, 1], at.scale)
      const offset = (first + face) * BLOCK_STRIDE
      block(t.blocks.copy, offset, copyFloats)
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
      pass.setBindGroup(0, copySource.group)
      pass.setBindGroup(1, copyBlock.group, [offset])
      pass.draw(3)
      pass.end()
    }
  }

  /** The brightest value of the 32-bit float cube, found on the GPU into a buffer it is read
   *  back from. */
  function measureCube(
    encoder: GPUCommandEncoder,
    t: SkyLightTargets,
    input: SkyLightInputs,
    cubemap: GPUTexture,
    made: CubemapPipelines,
  ) {
    measuring?.destroy()
    const m = (measuring = createCubemapMeasure(device, made, t.width, t.mips, t.blocks.filter))
    copyFaces(encoder, t, input, cubemap, made, m)
    const mips = encoder.beginComputePass({ label: 'Trillion3D sky light cubemap brightness mips' })
    mips.setPipeline(made.pipelines.downsample.get())
    for (let mip = 1; mip < t.mips; mip++) {
      mips.setBindGroup(0, m.downsample[mip]!, [filterSlot(t, mip, 0)])
      const side = groupsOver(t.width >> mip, FILTER_GROUP_SIDE)
      mips.dispatchWorkgroups(side, side, CUBE_FACES)
    }
    mips.end()
    const gather = encoder.beginComputePass({ label: 'Trillion3D sky light cubemap brightness' })
    gather.setPipeline(made.pipelines.gather.get())
    gather.setBindGroup(0, m.gather, [filterSlot(t, t.mips - 1, 0)])
    gather.dispatchWorkgroups(1)
    gather.end()
    encoder.copyBufferToBuffer(m.peak, 0, m.read, 0, 4)
  }

  /** The measured buffer is mapped (the frame that wrote it was submitted): the capture follows
   *  the frame its value is known in. */
  function mapBrightest() {
    const m = measuring
    if (!m) return
    m.value().then(
      (peak) => {
        if (measuring !== m) return
        measuring = undefined
        cubemapScales = skyLightCubemapScales(peak)
        cubemapMeasured(cubemapState)
      },
      (error: unknown) => {
        if (measuring !== m) return
        measuring = undefined
        failed(error)
      },
    )
  }

  /** The host's cube taken to the filtered cube and the harmonics, whole in a frame once for a
   *  cube, an angle, a side and a lower-hemisphere flag; none without a cube. */
  function encodeCubemap(encoder: GPUCommandEncoder, t: SkyLightTargets, input: SkyLightInputs) {
    const { cubemap } = input
    if (!cubemap || cubemap === cubemapRefused) return
    const wide = cubemap.format === LUMINANCE_FORMAT
    if (wide && !device.features.has('float32-filterable')) {
      cubemapRefused = cubemap
      failed(
        new Error('A 32-bit float sky light cubemap needs the device feature float32-filterable'),
      )
      return
    }
    cubemaps ??= createCubemapPipelines(device, failed)
    if (!cubemaps.ready(wide)) return
    const key = [
      cubemap,
      skyLightCubemapRotation(input.part),
      t.width,
      input.part.light.lowerHemisphereIsSolidColor,
    ]
    if (!sameHeld(cubemapKey, key)) {
      cubemapKey = key
      measuring?.destroy()
      measuring = undefined
      cubemapState = newCubemapState(wide)
      cubemapScales = skyLightCubemapScales(0)
    }
    switch (advanceCubemap(cubemapState)) {
      case 'measure':
        measureCube(encoder, t, input, cubemap, cubemaps)
        break
      case 'map':
        mapBrightest()
        break
      case 'copy':
        copyFaces(encoder, t, input, cubemap, cubemaps)
        mipChain(encoder, t)
        filter(encoder, t, 0, 0, t.mips - 1, 0, CUBE_FACES)
        harmonics(encoder, t, 0)
        cubemapDone = true
        break
      case 'nothing':
        break
    }
  }

  /** The harmonics from filtered cube `w`. */
  function harmonics(encoder: GPUCommandEncoder, t: SkyLightTargets, w: 0 | 1) {
    blockWords.set([irradianceMip(t.width), 0, 0, 0])
    block(t.blocks.irradiance, 0, blockWords)
    const pass = encoder.beginComputePass({ label: 'Trillion3D sky light harmonics' })
    pass.setPipeline(pipelines.irradiance.get())
    pass.setBindGroup(0, t.groups.irradiance[w])
    pass.dispatchWorkgroups(1)
    pass.end()
  }

  return {
    /** Whether every pipeline is compiled: until then a frame encodes nothing. */
    get ready() {
      return Object.values(pipelines).every((p) => p.ready) && cloudTrace.pipeline.ready
    },
    /** This frame's work on `encoder`, once a frame. */
    encode(encoder: GPUCommandEncoder, input: SkyLightInputs) {
      const cloudSide = skyLightCloudWidth(input.width, input.part)
      if (!targets || targets.width !== input.width || targets.cloudSide !== cloudSide) {
        targets?.destroy()
        targets = createSkyLightTargets(
          device,
          { layouts, pipelines, cloudTrace },
          input.width,
          cloudSide,
        )
        state = newCaptureState()
        cubemapKey = undefined
        cubemapDone = false
      }
      const t = targets
      const { quality } = input.part
      slot = 0
      const now = skyLightSource(input.part)
      if (now !== source) {
        source = now
        state = newCaptureState()
        cubemapKey = undefined
        cubemapDone = false
      }
      // The scene drawn into the cube once (`'capturedScene'`) is not drawn by this engine.
      if (now === 'specifiedCubemap') return encodeCubemap(encoder, t, input)
      if (now !== 'realTime') return
      const step = advanceCapture(state, {
        timeSlice: quality.skyLightTimeSlicing,
        facesPerFrame: quality.skyLightFacesPerFrame,
        mips: t.mips,
      })
      switch (step.kind) {
        case 'whole':
          drawFaces(encoder, t, 0, CUBE_FACES, true, true, input)
          mipChain(encoder, t)
          filter(encoder, t, state.ready, 0, t.mips - 1, 0, CUBE_FACES)
          harmonics(encoder, t, state.ready)
          break
        case 'sky':
          drawFaces(encoder, t, step.faceFirst, step.faceEnd, true, false, input)
          break
        case 'clouds':
          drawFaces(encoder, t, step.faceFirst, step.faceEnd, false, true, input)
          break
        case 'mips':
          mipChain(encoder, t)
          break
        case 'filter':
          filter(
            encoder,
            t,
            workIndex(state),
            step.mipFirst,
            step.mipLast,
            step.faceFirst,
            step.faceCount,
          )
          break
        case 'harmonics':
          harmonics(encoder, t, workIndex(state))
          break
        case 'nothing':
          break
      }
    },
    /** What the lighting reads: the ready filtered cube with its mips, the harmonics' buffer and
     *  the rescale of a 32-bit float cubemap that goes into the light's colour (`skyLightColor`'s
     *  `cubemapScale`, 1 for the rest); none before the first frame, and none while a specified
     *  cubemap is not captured, or for a source the engine cannot capture. */
    read() {
      if (!targets) return undefined
      if (source === 'specifiedCubemap')
        return cubemapDone
          ? {
              cube: targets.filteredCubes[0],
              mips: targets.mips,
              harmonics: targets.harmonics,
              colorScale: cubemapScales.light,
            }
          : undefined
      if (source !== 'realTime') return undefined
      return {
        cube: targets.filteredCubes[state.ready],
        mips: targets.mips,
        harmonics: targets.harmonics,
        colorScale: 1,
      }
    },
    dispose() {
      measuring?.destroy()
      measuring = undefined
      targets?.destroy()
      targets = undefined
    },
  }
}

/** The capture (`createSkyLightCapture`). */
export type SkyLightCapture = ReturnType<typeof createSkyLightCapture>
