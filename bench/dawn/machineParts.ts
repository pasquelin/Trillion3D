// The parts every machine kernel is made of (`machineKernels.ts`, `machineWork.ts`): square
// textures, compute pipelines and their bind groups, render pipelines, and a timed draw into a set
// of attachments. One set for every kernel.

/** Runs `encode` on a fresh encoder: the ms between the pass's two timestamps. */
export type TimedRun = (encode: (encoder: GPUCommandEncoder) => void) => Promise<number>

/** The parts of `device`, a draw timed by `run` through the pass timestamps `stamps`. */
export function machineParts(
  device: GPUDevice,
  { run, stamps }: { run: TimedRun; stamps: GPURenderPassTimestampWrites },
) {
  return {
    /** A `size` × `size` texture of `format`, used as `usage`. */
    texture: (size: number, format: GPUTextureFormat, usage: number) =>
      device.createTexture({ size: [size, size], format, usage }),
    /** A compute pipeline of `code`'s `main`, its layout the shader's own. */
    compute: (code: string) =>
      device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
      }),
    /** `pipeline`'s group 0, `resources` at bindings 0, 1, …. */
    bind: (pipeline: GPUComputePipeline, ...resources: GPUBindingResource[]) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: resources.map((resource, binding) => ({ binding, resource })),
      }),
    /** A render pipeline of `code`'s `vs` and `fs`, drawing into attachments of `formats`. */
    raster: (code: string, formats: GPUTextureFormat[]) => {
      const module = device.createShaderModule({ code })
      return device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: formats.map((format) => ({ format })) },
      })
    },
    /** `vertices` × `instances` drawn by `pipeline` into `views`, cleared then stored, timed. */
    draw: (pipeline: GPURenderPipeline, views: GPUTexture[], vertices: number, instances = 1) =>
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
      }),
  }
}

export type MachineParts = ReturnType<typeof machineParts>
