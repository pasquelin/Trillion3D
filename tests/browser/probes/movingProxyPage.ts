/**
 * Page side of the moving-proxy probe (#27): the engine's resident proxy (`createGpuBounceProxy`)
 * and its shipped traversal (`BOUNCE_TRACE_WGSL`) on a real device. One retained plane with two
 * coincident owners is traced still, then after its second owner moved five metres along x: each
 * ray reports whether it hit, at what distance, which owner, whether the shadow query agrees, and
 * the centre and red albedo channel of the owner it hit — what the radiance of a hit reads.
 */
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/src/math/matrix/matrix4.ts';
import { ownedProxy } from '../../../packages/sdk-core/src/scene/core/proxy.fixture.ts';
import { createGpuBounceProxy } from '../../../packages/sdk-browser/src/bounce/proxy.ts';
import { residentProxyWgsl } from '../../../packages/sdk-browser/src/bounce/nodeWgsl.ts';
import { BOUNCE_TRACE_WGSL } from '../../../packages/sdk-browser/src/bounce/traceWgsl.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import { ouvrirAppareil as openDevice } from './webgpuDevice.ts';

const REACH = 10;

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

/** Straight down onto the plane: over the canonical pose, then over the moved owner's pose. */
const RAYS = new Float32Array([0.25, 0.25, 1, 0, 0, 0, -1, 0, 5.25, 0.25, 1, 0, 0, 0, -1, 0]);

/** Source node 1 translated by five metres along x; every other node at its bind pose. */
const worldOf = (source: number) => {
  const world = [...IDENTITY_MATRIX4];
  world[12] = source === 1 ? 5 : 0;
  return world;
};

type RayReading = {
  found: boolean;
  distance: number;
  owner: number;
  blocked: boolean;
  centre: number[];
  red: number;
};

export async function run() {
  const gpu = await openDevice();
  if (!gpu) return { unavailable: 'no WebGPU adapter' };
  const { device, erreurs: errors } = gpu;
  const resident = createGpuBounceProxy(device, ownedProxy());
  const { module, compilation } = await gpu.compile(SHADER);
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const rays = device.createBuffer({
    size: RAYS.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(rays, 0, RAYS);
  const hits = device.createBuffer({
    size: RAYS.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const group = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [resident.buffer, rays, hits].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  });
  const trace = async (): Promise<RayReading[]> => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(RAYS.length / 8);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const out = new Float32Array((await readGpuBuffer(device, hits, RAYS.byteLength))!.buffer);
    return Array.from({ length: RAYS.length / 8 }, (_, ray) => {
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
  };
  const still = await trace();
  const moved = resident.sync(worldOf);
  const after = await trace();
  const dynamic = resident.dynamic;
  for (const buffer of [rays, hits]) buffer.destroy();
  resident.dispose();
  const info = await gpu.fermer();
  return { adapter: info.court, errors, compilation, moved, dynamic, still, after };
}
