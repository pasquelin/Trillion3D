/**
 * Page side of the moving-proxy probes (#27): the shipped traversal (`BOUNCE_TRACE_WGSL`) over
 * the engine's resident proxy, on a real device. Each ray reports whether it hit, at what
 * distance, which owner, whether the shadow query agrees, and the centre and red albedo of the
 * owner it hit — what the radiance of a hit reads. A variant replaces the step bound the proxy
 * carries by another, to compare the shipped bound with none.
 */
import { residentProxyWgsl } from '../../../packages/sdk-browser/src/bounce/nodeWgsl.ts';
import { BOUNCE_TRACE_WGSL } from '../../../packages/sdk-browser/src/bounce/traceWgsl.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import type { ouvrirAppareil as openDevice } from './webgpuDevice.ts';

/** Farther than any ray of the probes travels. */
const REACH = 200;
const SHIPPED = 'fn proxySteps()->u32{return proxy.steps;}';

const SHADER = `${residentProxyWgsl(0, false)}
@group(0) @binding(1) var<storage,read> rays:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> hits:array<vec4f>;
${BOUNCE_TRACE_WGSL}
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){
 let origin=rays[id.x*2u].xyz;
 let direction=rays[id.x*2u+1u].xyz;
 let hit=traceProxy(origin,direction,${REACH}.0);
 let blocked=proxyBlocked(origin,direction,${REACH}.0);
 hits[id.x*2u]=vec4f(select(0.0,1.0,hit.found),hit.distance,f32(hit.owner),select(0.0,1.0,blocked));
 hits[id.x*2u+1u]=vec4f(proxyOwnerCentre(hit.triangle,hit.owner),proxyOwnerAlbedo(hit.owner).r);
}`;

export type RayReading = {
  found: boolean;
  distance: number;
  owner: number;
  blocked: boolean;
  centre: number[];
  red: number;
};

type Gpu = NonNullable<Awaited<ReturnType<typeof openDevice>>>;

/** Rays are two `vec4f` each: origin, then normalized direction. */
export function createTraceRig(gpu: Gpu, proxy: GPUBuffer, data: Float32Array) {
  const { device } = gpu;
  const compilation: string[] = [];
  const usage = GPUBufferUsage;
  const rays = device.createBuffer({
    size: data.byteLength,
    usage: usage.STORAGE | usage.COPY_DST,
  });
  device.queue.writeBuffer(rays, 0, data);
  const hits = device.createBuffer({
    size: data.byteLength,
    usage: usage.STORAGE | usage.COPY_SRC,
  });
  const count = data.length / 8;
  /** `steps`: a WGSL expression replacing the proxy's bound; absent, the shipped one. */
  const pipeline = async (steps?: string) => {
    if (!SHADER.includes(SHIPPED)) throw new Error('the shipped step bound is no longer read');
    const code = steps ? SHADER.replace(SHIPPED, `fn proxySteps()->u32{return ${steps};}`) : SHADER;
    const compiled = await gpu.compile(code);
    compilation.push(...compiled.compilation);
    return device.createComputePipeline({
      layout: 'auto',
      compute: { module: compiled.module, entryPoint: 'main' },
    });
  };
  return {
    compilation,
    async trace(steps?: string): Promise<RayReading[]> {
      const compute = await pipeline(steps);
      const group = device.createBindGroup({
        layout: compute.getBindGroupLayout(0),
        entries: [proxy, rays, hits].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(compute);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(count);
      pass.end();
      device.queue.submit([encoder.finish()]);
      const out = new Float32Array((await readGpuBuffer(device, hits, data.byteLength))!.buffer);
      return Array.from({ length: count }, (_, ray) => {
        const at = ray * 8;
        return {
          found: out[at] === 1,
          distance: out[at + 1],
          owner: out[at + 2],
          blocked: out[at + 3] === 1,
          centre: [...out.subarray(at + 4, at + 7)],
          red: out[at + 7],
        };
      });
    },
    dispose() {
      for (const buffer of [rays, hits]) buffer.destroy();
    },
  };
}
