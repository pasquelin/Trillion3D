// The machine's kernels for the work a pass spends beside memory and launches (`machineKernels.ts`):
// texels loaded and filtered, arithmetic, workgroup memory, pixels written to four attachments,
// fragments shaded, triangles set up. Each is sized to run a millisecond or more on a desktop GPU,
// so its two timestamps weigh nothing; `machine.ts` turns the times into rates.
import { ALU, FILL_MRT4, SHARED, TEXEL_FILTER, TEXEL_LOAD, TRIANGLES } from './machineWgsl.ts'
import type { MachineParts } from './machineParts.ts'

/** The cached texture the taps read: 256², `rgba16float`, read by a 2048² grid of threads. */
export const TAP_GRID = 2048
export const TAPS = 16
/** Threads of the arithmetic and workgroup-memory kernels; each one's own work. */
export const WORK_THREADS = 2 ** 22
export const FMA_LANES = 8
export const FMA_ITERATIONS = 256
export const SHARED_READS = 256
/** The raster's target side, the overdraw the fragment kernel draws, the triangle grid's side. */
export const RASTER_SIDE = 4096
export const OVERDRAW = 8
export const TRIANGLE_SIDE = 2048

type One = (encode: (pass: GPUComputePassEncoder) => void) => Promise<number>

/** The work kernels of `device`, made of `parts` and timed as `one` times a compute pass; `fill`
 *  the full-target pipeline and `target` the attachment the fragment kernel draws into. */
export function createWorkKernels(
  device: GPUDevice,
  { parts, one }: { parts: MachineParts; one: One },
  { fill, target }: { fill: GPURenderPipeline; target: GPUTexture },
) {
  const { texture, raster, draw } = parts
  const sink = device.createBuffer({ size: WORK_THREADS * 16, usage: GPUBufferUsage.STORAGE })
  const cached = texture(256, 'rgba16float', GPUTextureUsage.TEXTURE_BINDING)
  const targets = Array.from({ length: 4 }, () =>
    texture(RASTER_SIDE, 'rgba16float', GPUTextureUsage.RENDER_ATTACHMENT),
  )
  const ranks = texture(TRIANGLE_SIDE, 'r32uint', GPUTextureUsage.RENDER_ATTACHMENT)
  /** A kernel of `code` over `resources`: its `x` × `y` workgroups, timed. */
  const compute = (code: string, ...resources: GPUBindingResource[]) => {
    const pipeline = parts.compute(code),
      group = parts.bind(pipeline, ...resources)
    return (x: number, y = 1) =>
      one((pass) => {
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, group)
        pass.dispatchWorkgroups(x, y)
      })
  }
  const linear = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const view = cached.createView()
  const load = compute(TEXEL_LOAD, view, { buffer: sink }),
    filter = compute(TEXEL_FILTER, view, { buffer: sink }, linear),
    alu = compute(ALU, { buffer: sink }),
    shared = compute(SHARED, { buffer: sink })
  const mrt4 = raster(FILL_MRT4, Array(4).fill('rgba16float')),
    triangles = raster(TRIANGLES, ['r32uint'])
  const grid = TAP_GRID / 8
  return {
    kernels: {
      texelLoad: () => load(grid, grid),
      texelFilter: () => filter(grid, grid),
      alu: () => alu(WORK_THREADS / 256),
      shared: () => shared(WORK_THREADS / 256),
      /** One full-target triangle written to four attachments. */
      attachments4: () => draw(mrt4, targets, 3),
      /** `OVERDRAW` full-target triangles, each fragment shaded and stored. */
      fragments: () => draw(fill, [target], 3, OVERDRAW),
      triangles: () => draw(triangles, [ranks], 3 * TRIANGLE_SIDE ** 2),
    },
    destroy() {
      for (const held of [sink, cached, ranks, ...targets]) held.destroy()
    },
  }
}
