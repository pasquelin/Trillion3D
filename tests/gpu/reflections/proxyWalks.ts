// The proxy's rays as a kernel of their own — the shipped walk (`rtScene`), one thread a ray, each hit
// written whole: its distance's bits, its placement, its triangle, whether found, and the work and the
// tests it spent.
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { runtimeSceneWgsl } from '../../../packages/sdk-browser/src/bounce/runtimeSceneWgsl.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'

/** Words of a hit as the kernel writes it. */
export const HIT_WORDS = 6
/** The bindings: the proxy's buffer, the records' table — worlds and instances — and the tree's, the
 *  rays and the hits. */
const B = { proxy: 0, worlds: 1, rays: 2, hits: 3, tree: 5 } as const

const KERNEL = `@group(0) @binding(${B.rays}) var<storage,read> rays:array<vec4f>;
@group(0) @binding(${B.hits}) var<storage,read_write> hits:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
 let i=g.x;
 if(i>=arrayLength(&rays)/2u){return;}
 rtBegin();
 let o=rays[2u*i];
 let d=rays[2u*i+1u];
 let hit=rtScene(o.xyz,d.xyz,o.w);
 let at=i*${HIT_WORDS}u;
 hits[at]=bitcast<u32>(hit.distance);
 hits[at+1u]=hit.placement;
 hits[at+2u]=hit.triangle;
 hits[at+3u]=select(0u,1u,hit.found);
 hits[at+4u]=rtWork;
 hits[at+5u]=rtTests;
}`

/** The walk the engine ships: the worlds, the instances and the tree read in their record tables. */
export const NEW_WALK = wgslProgram(KERNEL, [
  runtimeSceneWgsl({ group: 0, proxy: B.proxy, worlds: B.worlds, tree: B.tree }),
])

/** What a walk binds: the proxy's buffer and the record tables. */
export type WalkInputs = {
  proxy: GPUBuffer
  worlds?: GPUTextureView
  tree?: GPUTextureView
}

/** `code`'s walk of `rays` (two vec4s each: origin and reach, direction) over `inputs` on `device`:
 *  each hit's words. */
export async function walk(
  device: GPUDevice,
  code: string,
  rays: Float32Array<ArrayBuffer>,
  inputs: WalkInputs,
) {
  const count = rays.length / 8,
    bytes = count * HIT_WORDS * 4
  const rayBuffer = device.createBuffer({
    size: rays.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(rayBuffer, 0, rays)
  const hits = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const pipeline = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  })
  const entries: GPUBindGroupEntry[] = [
    { binding: B.proxy, resource: { buffer: inputs.proxy } },
    { binding: B.rays, resource: { buffer: rayBuffer } },
    { binding: B.hits, resource: { buffer: hits } },
  ]
  if (inputs.worlds) entries.push({ binding: B.worlds, resource: inputs.worlds })
  if (inputs.tree) entries.push({ binding: B.tree, resource: inputs.tree })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }))
  pass.dispatchWorkgroups(ceilDiv(count, 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const read = (await readGpuBuffer(device, hits, bytes))!
  rayBuffer.destroy()
  hits.destroy()
  return Array.from(read)
}
