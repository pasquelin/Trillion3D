// The machine's kernels for the work a pass spends beside memory and launches (`machineKernels.ts`):
// texels loaded and filtered, arithmetic, workgroup memory, pixels written to four attachments,
// fragments shaded, triangles set up. Each is sized to run a millisecond or more on a desktop GPU,
// so its two timestamps weigh nothing; `machine.ts` turns the times into rates.
import { ALU, FILL_MRT4, SHARED, TEXEL_FILTER, TEXEL_LOAD, TRIANGLES } from './machineWgsl.ts'

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

type Run = (encode: (encoder: GPUCommandEncoder) => void) => Promise<number>
type One = (encode: (pass: GPUComputePassEncoder) => void) => Promise<number>

/** The work kernels of `device`, timed as `run` and `one` time theirs; `fill` the full-target
 *  pipeline and `target` the attachment the fragment kernel draws into. */
export function createWorkKernels(
  device: GPUDevice,
  { run, one, stamps }: { run: Run; one: One; stamps: GPURenderPassTimestampWrites },
  { fill, target }: { fill: GPURenderPipeline; target: GPUTexture },
) {
  const sink = device.createBuffer({ size: WORK_THREADS * 16, usage: GPUBufferUsage.STORAGE })
  const texture = (size: number, format: GPUTextureFormat, usage: number) =>
    device.createTexture({ size: [size, size], format, usage })
  const cached = texture(256, 'rgba16float', GPUTextureUsage.TEXTURE_BINDING)
  const targets = Array.from({ length: 4 }, () =>
    texture(RASTER_SIDE, 'rgba16float', GPUTextureUsage.RENDER_ATTACHMENT),
  )
  const ranks = texture(TRIANGLE_SIDE, 'r32uint', GPUTextureUsage.RENDER_ATTACHMENT)
  const compute = (code: string, ...resources: GPUBindingResource[]) => {
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
    })
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: resources.map((resource, binding) => ({ binding, resource })),
    })
    return (x: number, y = 1) =>
      one((pass) => {
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, group)
        pass.dispatchWorkgroups(x, y)
      })
  }
  const raster = (code: string, formats: GPUTextureFormat[]) => {
    const module = device.createShaderModule({ code })
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: formats.map((format) => ({ format })) },
    })
  }
  const draw = (
    pipeline: GPURenderPipeline,
    views: GPUTexture[],
    vertices: number,
    instances = 1,
  ) =>
    run((encoder) => {
      const pass = encoder.beginRenderPass({
        timestampWrites: stamps,
        colorAttachments: views.map((view) => ({
          view: view.createView(),
          loadOp: 'clear' as const,
          storeOp: 'store' as const,
          clearValue: [0, 0, 0, 0],
        })),
      })
      pass.setPipeline(pipeline)
      pass.draw(vertices, instances)
      pass.end()
    })
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
