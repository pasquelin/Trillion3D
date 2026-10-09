// The engine side of the reflection proof: a synthetic still frame — a mirror floor and an emissive
// quad standing on it, seen by an infinite reversed perspective — laid in the engine's own inputs
// (the surface flags and normals, the Hi-Z level 0, the lit image), then the engine's reflection
// kernels run on it as an image runs them (`reflections/frame.ts`): the depth's nearest levels, the
// view uniform and the opaque trace, then the radiance pyramid of the lit image. Twice:
// two consecutive still images, whose reflection targets are read back to the bit.
import {
  createReflectionPipelines,
  createScreenReflection,
  encodeRadiancePyramid,
  encodeReflectionDepth,
  encodeReflectionTrace,
  reflectionGroup,
  writeReflectionView,
} from '../../../packages/sdk-browser/src/reflections/gpu.ts'
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
    const flags = texture('r8uint', sampled)
    const normals = texture('rgba16float', sampled)
    const hdr = texture('rgba16float', sampled)
    // The Hi-Z level 0 as the visibility leaves it: the image's depth.
    const level0 = texture('r32float', sampled)
    const depth = { level0, level0View: level0.createView() }
    const write = (target: GPUTexture, data: ArrayBufferView<ArrayBuffer>, texel: number) =>
      device.queue.writeTexture({ texture: target }, data, { bytesPerRow: size * texel }, [
        size,
        size,
      ])
    write(flags, scene.flags, 1)
    write(normals, halves(scene.normals), 8)
    write(hdr, halves(scene.radiance), 8)
    write(level0, scene.depth, 4)
    const lights = createSceneLightContractBuffer(device, createSceneLightStore())
    const reflection = createScreenReflection(device, size, size)
    const inverse = new Float64Array(16)
    invertMatrix4(inverse, scene.viewProjection)
    const views = { flags: flags.createView(), normals: normals.createView() }
    const image = (radiance: boolean) => {
      writeReflectionView(reflection, {
        viewProjection: scene.viewProjection,
        inverseViewProjection: inverse,
        camera: [0, 0, 0, 1],
        size: [size, size],
        depthDrawn: true,
      })
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      encodeReflectionDepth(pass, reflection, pipelines, depth)
      const inputs = { ...views, surfaces: views, lights }
      const group = reflectionGroup(reflection, depth)
      encodeReflectionTrace(pass, reflection, pipelines, inputs, group, [size, size])
      pass.end()
      if (radiance) {
        const build = encoder.beginComputePass()
        encodeRadiancePyramid(
          build,
          reflection,
          pipelines,
          hdr.createView(),
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
    for (const made of [flags, normals, hdr, level0]) made.destroy()
  })
}
