/**
 * THE CUT'S WORLDS BROUGHT TO THE EYE ON THE GPU.
 *
 * The cut reads every placement's world in the render frame, the eye at its origin
 * (`../../camera/renderOrigin.ts`). The host sends a world only when a pose moves, with its exact
 * translation as three doubles behind the matrices (`worldOrigins.ts`), so a moving eye costs the
 * CPU nothing per placement; before each cut whose eye moved, or after any world was sent, one
 * pass rewrites each translation from those doubles and the eye's: the double subtraction, then
 * single precision (`DOUBLE_WGSL`, `toF32`), the very bits `worldToRenderOrigin` writes. Its cost,
 * per frame the eye moved, is every placement's: six words read and three written, 36 B on the
 * GPU — the floor of a moving frame (`worldLinks.ts`). A pose composed on the GPU (`../../placement/gpuCompose.ts`) writes
 * its doubles as it writes its world, so this pass brings it to the eye with the others.
 */
import type { GpuSelection, SelectionUniforms } from '../core/selection.ts'
import { uniformStride } from '../../residency/pools.ts'
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { COMPUTE } from '../core/computeBindings.ts'
import { WORLD_REBASE_WGSL } from './worldRebaseWgsl.ts'
import { packDoubles } from '../../placement/composedMotion.ts'
import { dispatchRows, groupWidth } from '../dispatch/grid.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'

type Ranges = GpuSelection['worldRanges']

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
  const stride = uniformStride(device.limits),
    width = groupWidth(device.limits)
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
        packDoubles(params, at + 2, eye, 0, 3)
      })
      device.queue.writeBuffer(uniforms, 0, params)
      const pass = encoder.beginComputePass({ label: 'Trillion3D world rebase' })
      pass.setPipeline(pipeline)
      ranges.forEach(({ count }, r) => {
        pass.setBindGroup(0, groups[r])
        dispatchRows(pass, workgroupCount(count, 64), 1, width)
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
 * worlds were written since, by whatever path (`worldsWritten`): the pass in the caller's encoder,
 * or in one of its own submitted before. What the GPU holds is taken as rebased once the pass is
 * queued — at once in its own encoder, at the caller's settlement in a shared one —: a buffer the
 * caller drops, or a dispatch that throws, leaves the next cut to rebase again.
 */
export function rebaseWorldsOnGpu(
  selection: GpuSelection,
  device: GPUDevice,
  rebase: Awaited<ReturnType<typeof createWorldRebase>>,
) {
  const held = new Float64Array(3).fill(NaN)
  let rebased = -1
  const { dispatch, dispose } = selection
  const commit = (eye: ArrayLike<number>, written: number) => {
    held.set(eye)
    rebased = written
  }
  selection.dispatch = (uniforms: SelectionUniforms, shared?: GPUCommandEncoder) => {
    const eye = Float64Array.from(uniforms.cameraWorld),
      written = selection.worldsWritten
    const due =
      written !== rebased || eye[0] !== held[0] || eye[1] !== held[1] || eye[2] !== held[2]
    if (due) {
      const encoder = shared ?? device.createCommandEncoder()
      rebase.encode(encoder, eye)
      if (!shared) {
        device.queue.submit([encoder.finish()])
        commit(eye, written)
      }
    }
    const settle = dispatch(uniforms, shared)
    if (!due || !shared || !settle) return settle
    return (submitted: boolean) => {
      if (submitted) commit(eye, written)
      settle(submitted)
    }
  }
  selection.dispose = () => {
    rebase.dispose()
    dispose()
  }
  return selection
}
