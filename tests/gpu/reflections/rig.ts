// The engine side of the reflection proofs: a synthetic still frame (flags, normals, base colour,
// depth, lit image, physical lobes, the scene's proxy) laid in the engine's own inputs, then the
// engine's kernels run on it as an image runs them: the image staged as the engine stages it — its
// view and turn (`stageReflectionImage`) —, the depth pyramid (`gpu/hiz`), the opaque
// trace, then the radiance pyramid of the lit image (`encodeImageRadiance`), adopted as the next image's level 0 (`adoptRadianceImage`). Consecutive
// still images, whose reflection targets are read back to the bit.
import { rigProxy } from './rigRuntime.ts'
import { clearValueOf } from '../../../packages/sdk-core/src/world/math/packedColour.ts'
import { createSurroundings } from '../../../packages/sdk-browser/src/lighting/toneUnmap.ts'
import {
  createScreenReflection,
  reflectionsPending,
} from '../../../packages/sdk-browser/src/lighting/reflections/gpu.ts'
import { reflectionGroup } from '../../../packages/sdk-browser/src/lighting/reflections/group.ts'
import { createReflectionPipelines } from '../../../packages/sdk-browser/src/lighting/reflections/reflectionPipelines.ts'
import { adoptRadianceImage } from '../../../packages/sdk-browser/src/lighting/reflections/radiance/radiance.ts'
import {
  encodeImageRadiance,
  stageReflectionImage,
} from '../../../packages/sdk-browser/src/lighting/reflections/image.ts'
import type { ReflectionFrame } from '../../../packages/sdk-browser/src/lighting/reflections/viewWrite.ts'
import {
  HDR_FORMAT,
  hdrAttachmentView,
  hdrTargetDescriptor,
} from '../../../packages/sdk-browser/src/scene/targetFormats.ts'
import { encodeReflectionTrace } from '../../../packages/sdk-browser/src/lighting/reflections/trace/traceEncode.ts'
import { standaloneHiz } from '../../kit/device/standaloneHiz.ts'
import { createDeferredView } from '../../../packages/sdk-browser/src/lighting/deferred/view.ts'
import { createDeferredPlaceholders } from '../../../packages/sdk-browser/src/lighting/deferred/setup.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/frame/backend/state/lightBuffer.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/scene/light/store.ts'
import { TONE_MAPPING_RANK } from '../../../packages/sdk-core/src/scene/core/environment.ts'
import { invertMatrix4 } from '../../../packages/math/src/matrix/matrix4Inverse.ts'
import type { WebgpuLightState } from '../../../packages/sdk-browser/src/frame/backend/state/lights.ts'
import { readTexture } from '../../kit/device/computeReadback.ts'
import { halves, type RigFrame } from './rigFrame.ts'
import { SURFACE_FORMATS } from '../../../packages/sdk-browser/src/materials/surface/surfaceBuffer.ts'
import { PHYSICAL_LOBES_FORMAT } from '../../../packages/sdk-browser/src/materials/surface/physicalLobes.ts'
import { REFLECTION_RULES } from '../../../packages/sdk-core/src/contracts/reflectionOptions.ts'
import { texelBytesOf } from '../../../packages/sdk-browser/src/gpu/core/textureBytes.ts'

/**
 * The frame laid in the device, the engine's kernels built on it. `image` encodes one image; its
 * reflection target (`target`) is read back by `read`, its raw half-float words. `fill` writes
 * every word of the target first — the proofs that ask whether every pixel is written put a NaN
 * there. `planes` is the trace the pyramid is built for (`hizTrace`): the planes the proofs pin, or,
 * false, the reference's walk of the closest depth of each texel's centre.
 */
export async function openRig(device: GPUDevice, frame: RigFrame, planes = true) {
  const [width, height] = frame.size
  const pipelines = await createReflectionPipelines(device)
  if (!pipelines) throw new Error('the reflection kernels do not build')
  const texture = (format: GPUTextureFormat, usage: number, size = [width, height]) =>
    device.createTexture({ size, format, usage })
  const sampled = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  const base = texture(SURFACE_FORMATS[0], sampled)
  const flags = texture(SURFACE_FORMATS[3], sampled)
  const normals = texture(SURFACE_FORMATS[1], sampled)
  // The HDR target of the image's turn (the radiance pyramid's levels in its mips), lit each image.
  const hdr = device.createTexture(hdrTargetDescriptor(width, height))
  // No pixel carries the physical lobes: their target is a texel the trace never reads.
  const lobes = texture(PHYSICAL_LOBES_FORMAT, sampled, frame.lobes ? [width, height] : [1, 1])
  // The engine's depth pyramid, its level 0 as the visibility leaves it: the image's depth.
  const { hiz } = await standaloneHiz(device, width, height)
  const depth = hiz.depth()!
  const write = (target: GPUTexture, data: ArrayBufferView<ArrayBuffer>, size = [width, height]) =>
    device.queue.writeTexture(
      { texture: target },
      data,
      { bytesPerRow: size[0] * texelBytesOf(target.format) },
      size,
    )
  write(base, halves(frame.base))
  write(flags, frame.flags)
  write(normals, halves(frame.normals))
  write(hiz.level0, frame.depth)
  if (frame.lobes) write(lobes, frame.lobes)
  const store = createSceneLightStore()
  if (frame.environment) store.setEnvironment({ exposure: 1, irradiance: frame.environment })
  const lights = createSceneLightContractBuffer(device, store)
  uploadSceneLights(device, { store, buffer: lights, uploadedEpoch: -1 } as WebgpuLightState)
  const reflection = createScreenReflection(device, width, height, true)
  const targets = { hdrTexture: hdr, hdrView: hdrAttachmentView(hdr), reflection }
  let lit = frame.radiance
  const inverse = new Float64Array(16)
  invertMatrix4(inverse, frame.viewProjection)
  // The lighting's view of the image: the eye, the background, an exposure of one, no display
  // curve: a ray that meets nothing reflects the background as it is.
  const lightView = createDeferredView(device)
  const direct = [0, 0, 0, 1, TONE_MAPPING_RANK.none, 0, 0, 0]
  lightView.write(
    inverse,
    [...frame.eye, 1],
    width,
    height,
    clearValueOf(frame.background ?? 0),
    false,
    direct,
  )
  const over = { lightView: lightView.buffer }
  const surroundings = createSurroundings()(frame.background ?? 0, 1, TONE_MAPPING_RANK.none)
  // What each image tells its view: the frame's, no transparent; the lights' epoch moves with `light`.
  const told: ReflectionFrame = {
    viewProjection: frame.viewProjection,
    eye: frame.eye,
    size: frame.size,
    depthDrawn: true,
    relativeThickness: REFLECTION_RULES.reflectionRelativeDepthThickness.default,
    front: false,
    surroundings,
  }
  // No bounce probes, no light grid: the engine's stand-ins, as an image without them binds them.
  const standIns = createDeferredPlaceholders(device)
  // The scene's proxy the scene stage walks, and the radiance its faces give; else no proxy, a header
  // of zeros, which reads as no placement.
  const { proxy, proxyWorlds, proxyTree } = rigProxy(device, standIns, frame.proxy?.faces)
  const scene = { buffer: proxy, worlds: proxyWorlds, tree: proxyTree }
  const inputs = {
    proxy: scene,
    base: base.createView(),
    flags: flags.createView(),
    normals: normals.createView(),
    lobes: lobes.createView(),
    lights,
    bounceGrid: standIns.bounceGrid,
    probes: standIns.probes,
    lightLists: standIns.tiles,
  }
  return {
    reflection,
    /** One image: staged, the depth pyramid built, the trace; then, when `radiance`, the pyramid of
     *  the lit image the next image reflects. */
    image(radiance = true) {
      stageReflectionImage(reflection, told)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      // The visibility's builds once the depth is drawn: its culling layer, then its nearest and
      // the finished depth's farthest.
      hiz.encodePyramid({ pass })
      hiz.planes(planes)
      hiz.encodeNearest({ pass })
      pass.end()
      const group = reflectionGroup(reflection, depth, over.lightView)
      encodeReflectionTrace(encoder, reflection, pipelines, inputs, group, frame.size, !!told.front)
      if (radiance) {
        write(targets.hdrTexture, halves(lit))
        encodeImageRadiance(
          encoder,
          reflection,
          pipelines,
          { texture: targets.hdrTexture, view: lightView.buffer },
          told,
        )
      }
      device.queue.submit([encoder.finish()])
      adoptRadianceImage(targets)
    },
    /** The lit image is another from now on: a light changed. */
    light(radiance: Float32Array) {
      lit = radiance
    },
    /** Whether the view's radiance pyramid holds an image of it (`reflectionsPending`). */
    settled: () => !reflectionsPending(reflection),
    /** Every word of the reflection target set to `word`. */
    fill(word: number) {
      device.queue.writeTexture(
        { texture: reflection.target },
        new Uint16Array(width * height * 4).fill(word),
        { bytesPerRow: width * texelBytesOf(HDR_FORMAT) },
        [width, height],
      )
    },
    /** The reflection target, its raw half-float words. */
    async read() {
      const bytes = await readTexture(device, reflection.target, texelBytesOf(HDR_FORMAT))
      return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
    },
    dispose() {
      reflection.dispose()
      lights.destroy()
      standIns.dispose()
      hiz.dispose()
      lightView.dispose()
      // The HDR target of the next turn: the rig's own, or the one the pyramid gave back.
      for (const made of [base, flags, normals, targets.hdrTexture, lobes]) made.destroy()
    },
  }
}
