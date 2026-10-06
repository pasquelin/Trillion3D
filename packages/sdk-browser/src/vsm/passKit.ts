/**
 * What the shadow maps' compute passes share: a buffer binding's layout entries, the compute
 * pipeline of a WGSL source described once a device and compiled the engine's one way
 * (`preparedComputePipeline`). How sizes and dispatches round (`ceilDiv`, `roundUpPow2`) is
 * `layout.ts`'s.
 */
import { preparedComputePipeline, type PreparedPipeline } from '../lighting/deferred/fullscreen.ts';

/** A buffer binding of `type` at `binding`, seen by `visibility`. */
export const vsmBufferEntry = (
  binding: number,
  visibility: GPUShaderStageFlags,
  type: GPUBufferBindingType,
): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type } });

/** A compute uniform binding at `binding` read at a dynamic offset: one slot of `minBindingSize`
 *  bytes of a buffer of slots. */
export const vsmDynamicUniformEntry = (
  binding: number,
  minBindingSize: number,
): GPUBindGroupLayoutEntry => ({
  binding,
  visibility: GPUShaderStage.COMPUTE,
  buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize },
});

/** A compute pipeline and the layouts of its groups: `prepared` compiles it off the thread (the
 *  prepare step awaits it, `prepareVsmPipelines`); `pipeline`, read where it is bound, is the one
 *  compiled — compiled at once by a frame that binds it unprepared. */
export interface VsmComputePipe {
  readonly pipeline: GPUComputePipeline;
  groups: GPUBindGroupLayout[];
  prepared: PreparedPipeline<GPUComputePipeline>;
}
const PIPES = new WeakMap<GPUDevice, Map<string, VsmComputePipe>>();

/** The compute pipeline of `code`'s `entryPoint` over groups of `groups` layout entries, labelled
 *  `label`: its layouts, module and prepared pipeline made the first time `device` asks for that
 *  source, every later asker sharing them. */
export function vsmComputePipe(
  device: GPUDevice,
  label: string,
  code: string,
  entryPoint: string,
  groups: GPUBindGroupLayoutEntry[][],
): VsmComputePipe {
  let cache = PIPES.get(device);
  if (!cache) PIPES.set(device, (cache = new Map()));
  const key = `${entryPoint}\n${code}`;
  let p = cache.get(key);
  if (!p) {
    const layouts = groups.map((entries, k) =>
      device.createBindGroupLayout({ label: `${label}.g${k}`, entries }),
    );
    const prepared = preparedComputePipeline(device, {
      label,
      layout: device.createPipelineLayout({ label, bindGroupLayouts: layouts }),
      compute: { module: device.createShaderModule({ label, code }), entryPoint },
    });
    p = {
      groups: layouts,
      prepared,
      get pipeline() {
        return prepared.get();
      },
    };
    cache.set(key, p);
  }
  return p;
}
