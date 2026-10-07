/**
 * THE CUT'S WORLDS BROUGHT TO THE EYE ON THE GPU.
 *
 * The cut reads every placement's world in the render frame, the eye at its origin
 * (`../../camera/renderOrigin.ts`): a camera that moved used to rebase every root's translation on
 * the CPU, compare every world and send them all, each image — a frame's CPU growing with the
 * world. The host now sends a world only when a pose moves, with its exact translation as three
 * doubles behind the matrices (`worldOrigins.ts`); before each cut whose eye moved, or after any
 * world was sent, one pass rewrites each translation from those doubles and the eye's: the double
 * subtraction, then single precision (`DOUBLE_WGSL`, `toF32`), the very bits the CPU's rebase
 * (`worldToRenderOrigin`) wrote. A pose composed on the GPU (`../../placement/gpuCompose.ts`) writes
 * its doubles as it writes its world, so this pass brings it to the eye with the others.
 */
import type { GpuSelection, SelectionUniforms } from '../core/selection.ts'
import { uniformStride } from '../../residency/pools.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { COMPUTE } from '../core/computeBindings.ts'
import { WORLD_REBASE_WGSL } from './worldRebaseWgsl.ts'

type Ranges = GpuSelection['worldRanges']

/** A double's IEEE bits as the shader holds them: high word, then low word. */
const bits = new Float64Array(1),
  words = new Uint32Array(bits.buffer)
function writeDoubleWords(out: Uint32Array, at: number, value: number) {
  bits[0] = value
  out[at] = words[1]
  out[at + 1] = words[0]
}

/** The pass over every range of the cut's worlds, its pipeline compiled once. */
export async function createWorldRebase(device: GPUDevice, ranges: Ranges) {
  const module = device.createShaderModule({
    label: 'Trillion3D world rebase',
    code: WORLD_REBASE_WGSL,
  })
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const pipeline = await buildComputePipeline(device, {
    label: 'Trillion3D world rebase',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'rebaseWorlds' },
  })
  const stride = uniformStride(device.limits)
  const uniforms = device.createBuffer({
    label: 'Trillion3D world rebase eye',
    size: Math.max(1, ranges.length) * stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const groups = ranges.map(({ buffer }, r) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniforms, offset: r * stride, size: 32 } },
        { binding: 1, resource: { buffer } },
      ],
    }),
  )
  const params = new Uint32Array((Math.max(1, ranges.length) * stride) / 4)
  return {
    /** Brings every range's worlds to `eye` in `encoder`, after what it already holds. */
    encode(encoder: GPUCommandEncoder, eye: ArrayLike<number>) {
      ranges.forEach(({ count }, r) => {
        const at = (r * stride) / 4
        params[at] = count
        for (let a = 0; a < 3; a++) writeDoubleWords(params, at + 2 + 2 * a, eye[a])
      })
      device.queue.writeBuffer(uniforms, 0, params)
      const pass = encoder.beginComputePass({ label: 'Trillion3D world rebase' })
      pass.setPipeline(pipeline)
      ranges.forEach(({ count }, r) => {
        pass.setBindGroup(0, groups[r])
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(count / 64)))
      })
      pass.end()
    },
    dispose() {
      uniforms.destroy()
    },
  }
}

/**
 * `selection` whose dispatches bring its worlds to the uniforms' eye first, when that eye moved or
 * a world was sent since: the pass in the caller's encoder, or in one of its own submitted before.
 */
export function rebaseWorldsOnGpu(
  selection: GpuSelection,
  device: GPUDevice,
  rebase: Awaited<ReturnType<typeof createWorldRebase>>,
) {
  const held = new Float64Array(3).fill(NaN)
  let sent = true
  const { dispatch, updateWorlds, dispose } = selection
  selection.updateWorlds = (...args) => {
    const posted = updateWorlds(...args)
    if (posted) sent = true
    return posted
  }
  selection.dispatch = (uniforms: SelectionUniforms, shared?: GPUCommandEncoder) => {
    const eye = uniforms.cameraWorld
    if (sent || eye[0] !== held[0] || eye[1] !== held[1] || eye[2] !== held[2]) {
      const encoder = shared ?? device.createCommandEncoder()
      rebase.encode(encoder, eye)
      if (!shared) device.queue.submit([encoder.finish()])
      held.set(eye)
      sent = false
    }
    return dispatch(uniforms, shared)
  }
  selection.dispose = () => {
    rebase.dispose()
    dispose()
  }
  return selection
}
