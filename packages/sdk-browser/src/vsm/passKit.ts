/**
 * What the shadow maps' compute passes share: the compute pipeline of a WGSL source described
 * once a device and compiled the engine's one way (`preparedComputePipeline`), and a group of
 * whole buffers (`vsmBufferGroup`). How sizes and dispatches round (`ceilDiv`, `nextPow2`) is
 * the maths package's (`packages/math/src/scalar`).
 */
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { preparedComputePipeline, type PreparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { preparedPipelines } from '../gpu/core/preparedPipelines.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'

/** A compute pipeline and the layouts of its groups: `prepared` compiles it off the thread (the
 *  prepare step awaits it, `prepareVsmPipelines`); `pipeline`, read where it is bound, is the one
 *  compiled — compiled at once by a frame that binds it unprepared. */
export interface VsmComputePipe {
  readonly pipeline: GPUComputePipeline
  groups: GPUBindGroupLayout[]
  prepared: PreparedPipeline<GPUComputePipeline>
}

/** What a pipe is made of: its WGSL source, the entry point it runs, its groups' layout entries
 *  and its label. */
interface VsmPipeSource {
  label: string
  code: string
  entryPoint: string
  groups: GPUBindGroupLayoutEntry[][]
}

/** The device's modules, one a source whatever its entries, and its pipes, one an entry point of
 *  a source (`preparedPipelines`), made once a device (`oncePerDevice`). */
const vsmKit = oncePerDevice((device: GPUDevice) => {
  const modules = preparedPipelines(
    ({ label, code }: VsmPipeSource) => device.createShaderModule({ label, code }),
    ({ code }) => code,
  )
  const pipes = preparedPipelines(
    (source: VsmPipeSource): VsmComputePipe => {
      const { label, entryPoint } = source
      const layouts = source.groups.map((entries, k) =>
        device.createBindGroupLayout({ label: `${label}.g${k}`, entries }),
      )
      const prepared = preparedComputePipeline(device, {
        label,
        layout: device.createPipelineLayout({ label, bindGroupLayouts: layouts }),
        compute: { module: modules.of(source), entryPoint },
      })
      return {
        groups: layouts,
        prepared,
        get pipeline() {
          return prepared.get()
        },
      }
    },
    ({ code, entryPoint }) => `${entryPoint}\n${code}`,
  )
  return pipes
})

/** The compute pipeline of `code`'s `entryPoint` over groups of `groups` layout entries, labelled
 *  `label`: its layouts and prepared pipeline made the first time `device` asks for that entry of
 *  that source, every later asker sharing them; one module a source, whatever its entries. */
export const vsmComputePipe = (
  device: GPUDevice,
  label: string,
  code: string,
  entryPoint: string,
  groups: GPUBindGroupLayoutEntry[][],
): VsmComputePipe => vsmKit(device).of({ label, code, entryPoint, groups })

/** A bind group of whole buffers in binding order, but for the entries that name their own window
 *  (a `GPUBufferBinding`, the raster's parameters). No `instanceof GPUBuffer`: the interface is no
 *  global outside a WebGPU realm. */
export function vsmBufferGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  resources: readonly (GPUBuffer | GPUBufferBinding)[],
) {
  return device.createBindGroup({
    layout,
    entries: sequentialEntries(resources.map((r) => ('buffer' in r ? r : { buffer: r }))),
  })
}
