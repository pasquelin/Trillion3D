// The engine side of the reflection proofs: a synthetic still frame — the surface flags and normals,
// the base colour, the depth, the lit image, the physical lobes and the proxy of the scene
// where it has them — laid in the engine's inputs, its kernels run on it as an image runs them: the
// depth pyramid, the view, the surroundings and the trace (`reflections/frame.ts`), then the radiance
// pyramid. Consecutive still images, whose reflection targets are read back to the bit.
import { rigProxy } from './rigRuntime.ts'
import { clearValueOf } from '../../../packages/sdk-core/src/world/math/packedColour.ts'
import {
  createReflectionPipelines,
  createScreenReflection,
  reflectionGroup,
  reflectionsSettled,
} from '../../../packages/sdk-browser/src/reflections/gpu.ts'
import { encodeRadiancePyramid } from '../../../packages/sdk-browser/src/reflections/radiance.ts'
import { encodeReflectionTrace } from '../../../packages/sdk-browser/src/reflections/trace.ts'
import { createGpuHiz } from '../../../packages/sdk-browser/src/gpu/hiz/hiz.ts'
import { PROBE_TEXELS, emptyAtlas } from '../../../packages/sdk-browser/src/bounce/atlas.ts'
import { BOUNCE_GRID_BYTES } from '../../../packages/sdk-browser/src/bounce/uniform.ts'
import { createDeferredView } from '../../../packages/sdk-browser/src/lighting/deferred/view.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { TONE_MAPPING_RANK } from '../../../packages/sdk-core/src/scene/core/environment.ts'
import { invertMatrix4 } from '../../../packages/math/src/matrix/matrix4Inverse.ts'
import type { WebgpuLightState } from '../../../packages/sdk-browser/src/webgpu/pages/state/lights.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { halves, type RigFrame } from './rigFrame.ts'

/**
 * The frame laid in the device, the engine's kernels built on it. `image` encodes one image; its
 * reflection target (`target`) is read back by `read`, its raw half-float words. `fill` writes
 * every word of the target first — the proofs that ask whether every pixel is written put a NaN
 * there.
 */
export async function openRig(device: GPUDevice, frame: RigFrame) {
  const [width, height] = frame.size
  const pipelines = await createReflectionPipelines(device)
  if (!pipelines) throw new Error('the reflection kernels do not build')
  const texture = (format: GPUTextureFormat, usage: number, size = [width, height]) =>
    device.createTexture({ size, format, usage })
  const sampled = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  const base = texture('rgba16float', sampled)
  const flags = texture('r8uint', sampled)
  const normals = texture('rgba16float', sampled)
  const hdr = texture('rgba16float', sampled)
  // No pixel carries the physical lobes: their target is a texel the trace never reads.
  const lobes = texture('rgba32uint', sampled, frame.lobes ? [width, height] : [1, 1])
  // The engine's depth pyramid, its level 0 as the visibility leaves it: the image's depth.
  const hiz = await createGpuHiz(device, width, height, 1)
  if (!hiz) throw new Error('the Hi-Z kernels do not build')
  // The partition's tested boxes and state, which the pyramid's group names: none tested here.
  const partition = [0, 1].map(() =>
    device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
  )
  hiz.attach(partition[0], partition[1])
  const depth = hiz.depth()!
  const write = (
    target: GPUTexture,
    data: ArrayBufferView<ArrayBuffer>,
    texel: number,
    size = [width, height],
  ) => device.queue.writeTexture({ texture: target }, data, { bytesPerRow: size[0] * texel }, size)
  write(base, halves(frame.base), 8)
  write(flags, frame.flags, 1)
  write(normals, halves(frame.normals), 8)
  write(hdr, halves(frame.radiance), 8)
  write(hiz.level0, frame.depth, 4)
  if (frame.lobes) write(lobes, frame.lobes, 16)
  const store = createSceneLightStore()
  if (frame.environment) store.setEnvironment({ exposure: 1, irradiance: frame.environment })
  const lights = createSceneLightContractBuffer(device, store)
  uploadSceneLights(device, { store, buffer: lights, uploadedEpoch: -1 } as WebgpuLightState)
  const reflection = createScreenReflection(device, width, height, true, !!frame.proxy)
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
    0,
  )
  // The scene's proxy and the radiance its faces give; else no proxy, a header of zeros, which reads as
  // no placement.
  const over = { lightView: lightView.buffer }
  // No bounce probes: the cascades' empty grid, whose field is zero, and an atlas of one probe.
  const bounceGrid = device.createBuffer({
    size: BOUNCE_GRID_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const probes = emptyAtlas(device, 'reflection proof probes', PROBE_TEXELS)
  const inputs = {
    base: base.createView(),
    flags: flags.createView(),
    normals: normals.createView(),
    lobes: lobes.createView(),
    lights,
    bounceGrid,
    probes: probes.createView({ dimension: '2d-array' }),
    ...rigProxy(device, reflection, frame.proxy?.faces),
    lightView: lightView.buffer,
  }
  return {
    reflection,
    /** One image: the view written, the depth pyramid built, the trace; then, when `radiance`, the
     *  pyramid of the lit image the next image reflects. */
    image(radiance = true) {
      reflection.writeView(
        {
          viewProjection: frame.viewProjection,
          size: frame.size,
          depthDrawn: true,
          proxyError: 0,
        },
        reflection.radiance.held,
        reflection.radiance.levels,
      )
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      // The visibility's builds once the depth is drawn: its culling layer, then its nearest and
      // the finished depth's farthest.
      hiz.encodePyramid({ pass })
      hiz.encodeNearest({ pass })
      const group = reflectionGroup(reflection, depth, over)
      encodeReflectionTrace(pass, reflection, pipelines, inputs, group, frame.size)
      pass.end()
      if (radiance) {
        const build = encoder.beginComputePass()
        encodeRadiancePyramid(
          build,
          device,
          reflection.radiance,
          pipelines,
          { hdr: hdr.createView(), view: lightView.buffer, hash: reflection.settle.hash },
          frame.size,
          frame.viewProjection,
        )
        build.end()
        reflection.settle.image(encoder, reflection.tiles.args, reflection.tiles.list)
      }
      device.queue.submit([encoder.finish()])
      reflection.settle.submitted()
    },
    /** The lit image is another from now on (a light changed): the image about to be drawn is drawn
     *  for it, as the engine draws one for any pending change (`unsettledMask`). */
    light(radiance: Float32Array) {
      write(hdr, halves(radiance), 8)
      reflection.settle.busy()
    },
    /** Whether the view's reflections are what a still view shows (`reflectionsSettled`). */
    settled: () => reflectionsSettled(reflection, false),
    /** Every word of the reflection target set to `word`. */
    fill(word: number) {
      device.queue.writeTexture(
        { texture: reflection.target },
        new Uint16Array(width * height * 4).fill(word),
        { bytesPerRow: width * 8 },
        [width, height],
      )
    },
    /** The reflection target, its raw half-float words. */
    async read() {
      const bytes = await readTexture(device, reflection.target, 8)
      return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
    },
    dispose() {
      reflection.dispose()
      lights.destroy()
      bounceGrid.destroy()
      probes.destroy()
      hiz.dispose()
      lightView.dispose()
      for (const made of partition) made.destroy()
      for (const made of [base, flags, normals, hdr, lobes]) made.destroy()
    },
  }
}
