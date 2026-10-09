// The engine side of the reflection proof: a synthetic still frame — a mirror floor and an emissive
// quad standing on it, seen by an infinite reversed perspective — laid in the engine's own inputs
// (the surface flags and normals, the Hi-Z level 0, the lit image, no bounce), then the engine's kernels run on
// it as an image runs them: the depth pyramid the trace marches (`gpu/hiz`, as the visibility builds
// it), the view uniform, the surroundings and the opaque trace (`reflections/frame.ts`), then the
// radiance pyramid of the lit image. Twice: two consecutive still images, whose reflection targets
// are read back to the bit.
import {
  createReflectionPipelines,
  createScreenReflection,
  reflectionGroup,
} from '../../../packages/sdk-browser/src/reflections/gpu.ts'
import { encodeRadiancePyramid } from '../../../packages/sdk-browser/src/reflections/radiance.ts'
import { encodeReflectionTrace } from '../../../packages/sdk-browser/src/reflections/trace.ts'
import { createGpuHiz } from '../../../packages/sdk-browser/src/gpu/hiz/hiz.ts'
import { PROBE_TEXELS, emptyAtlas } from '../../../packages/sdk-browser/src/bounce/atlas.ts'
import { PROXY_HEADER_BYTES } from '../../../packages/sdk-browser/src/bounce/sizes.ts'
import { createDeferredView } from '../../../packages/sdk-browser/src/lighting/deferred/view.ts'
import { TONE_MAPPING_RANK } from '../../../packages/sdk-core/src/scene/core/environment.ts'
import { BOUNCE_GRID_BYTES } from '../../../packages/sdk-browser/src/bounce/uniform.ts'
import { createSceneLightContractBuffer } from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { invertMatrix4 } from '../../../packages/math/src/matrix/matrix4Inverse.ts'
import { toHalf } from '../../../packages/math/src/float/half.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { readTexture } from '../kit/computeReadback.ts'
import { MIRROR, mirrorScene } from './mirrorScene.ts'

/** What the proof reads: each image's reflection target, as its raw half-float words. */
export type MirrorReading = { targets: number[][]; size: number }

const halves = (values: ArrayLike<number>) => Uint16Array.from(values, toHalf)

export function run() {
  return runOnDevice<MirrorReading>(async (device, _events, result) => {
    const scene = mirrorScene()
    const { size } = MIRROR
    const pipelines = await createReflectionPipelines(device)
    if (!pipelines) throw new Error('the reflection kernels do not build')
    const texture = (format: GPUTextureFormat, usage: number) =>
      device.createTexture({ size: [size, size], format, usage })
    const sampled = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    const base = texture('rgba16float', sampled)
    const flags = texture('r8uint', sampled)
    const normals = texture('rgba16float', sampled)
    const hdr = texture('rgba16float', sampled)
    // The engine's depth pyramid, its level 0 as the visibility leaves it: the image's depth.
    const hiz = await createGpuHiz(device, size, size, 1)
    if (!hiz) throw new Error('the Hi-Z kernels do not build')
    // The partition's tested boxes and state, which the pyramid's group names: none tested here.
    const partition = [0, 1].map(() =>
      device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE }),
    )
    hiz.attach(partition[0], partition[1])
    const depth = hiz.depth()!
    const write = (target: GPUTexture, data: ArrayBufferView<ArrayBuffer>, texel: number) =>
      device.queue.writeTexture({ texture: target }, data, { bytesPerRow: size * texel }, [
        size,
        size,
      ])
    // A polished metal floor: white, metalness one, so that the share is the lobe's own weight.
    write(base, halves(new Float32Array(size * size * 4).fill(1)), 8)
    write(flags, scene.flags, 1)
    write(normals, halves(scene.normals), 8)
    write(hdr, halves(scene.radiance), 8)
    write(hiz.level0, scene.depth, 4)
    const lights = createSceneLightContractBuffer(device, createSceneLightStore())
    const reflection = createScreenReflection(device, size, size)
    const inverse = new Float64Array(16)
    invertMatrix4(inverse, scene.viewProjection)
    // The lighting's view of the image: the eye at the origin, a black background, an exposure of
    // one, no display curve: a mirror ray that meets nothing reflects zero.
    const lightView = createDeferredView(device)
    const direct = [0, 0, 0, 1, TONE_MAPPING_RANK.none, 0, 0, 0]
    lightView.write(inverse, [0, 0, 0, 1], size, size, 0x000000, false, direct, 0)
    // No proxy, no surface cache: a header of zeros, which reads as a tree with no node.
    const proxy = device.createBuffer({
      size: PROXY_HEADER_BYTES + 16,
      usage: GPUBufferUsage.STORAGE,
    })
    const surface = device.createTexture({
      size: [1, 1],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    })
    const over = { lightView: lightView.buffer, surface: surface.createView() }
    // No pixel carries the physical lobes: their target is a texel the trace never reads.
    const lobes = device.createTexture({
      size: [1, 1],
      format: 'rgba32uint',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    })
    // No bounce: the cascades' empty grid, whose field is zero, and an atlas of one probe.
    const bounceGrid = device.createBuffer({
      size: BOUNCE_GRID_BYTES,
      usage: GPUBufferUsage.UNIFORM,
    })
    const probes = emptyAtlas(device, 'mirror proof probes', PROBE_TEXELS)
    const views = {
      base: base.createView(),
      flags: flags.createView(),
      normals: normals.createView(),
      lobes: lobes.createView(),
    }
    const field = {
      bounceGrid,
      probes: probes.createView({ dimension: '2d-array' }),
      proxy,
      lightView: lightView.buffer,
    }
    const image = (radiance: boolean) => {
      reflection.writeView(
        {
          viewProjection: scene.viewProjection,
          size: [size, size],
          depthDrawn: true,
          proxyCell: 0,
          proxyError: 0,
        },
        reflection.radiance.held,
        reflection.radiance.levels,
      )
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      // The visibility's builds once the depth is drawn: its farthest layer, then its nearest.
      hiz.encodePyramid({ pass })
      hiz.encodeNearest({ pass })
      const inputs = { ...views, ...field, lights }
      const group = reflectionGroup(reflection, depth, over)
      encodeReflectionTrace(pass, reflection, pipelines, inputs, group, [size, size])
      pass.end()
      if (radiance) {
        const build = encoder.beginComputePass()
        encodeRadiancePyramid(
          build,
          device,
          reflection.radiance,
          pipelines,
          { hdr: hdr.createView(), view: lightView.buffer, hash: reflection.settle.hash },
          [size, size],
          scene.viewProjection,
        )
        build.end()
      }
      device.queue.submit([encoder.finish()])
    }
    // The first image has no radiance pyramid yet: the environment alone, then the lit image's.
    image(true)
    result.targets = []
    for (let k = 0; k < 2; k++) {
      image(true)
      const bytes = await readTexture(device, reflection.target, 8)
      result.targets.push(Array.from(new Uint16Array(bytes.buffer)))
    }
    result.size = size
    reflection.dispose()
    lights.destroy()
    bounceGrid.destroy()
    probes.destroy()
    hiz.dispose()
    lightView.dispose()
    proxy.destroy()
    for (const made of partition) made.destroy()
    for (const made of [base, flags, normals, hdr, lobes, surface]) made.destroy()
  })
}
