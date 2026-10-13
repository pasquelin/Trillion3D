// The proxy's rays as a kernel of their own — the shipped walk (`rtScene`), one thread a ray, each hit
// written whole: its distance's bits, its placement, its triangle, whether found, and the work and the
// tests it spent — and the walk of before as its oracle: the same text, the placements' worlds read where
// the proxy's buffer once mirrored them (`OLD_WORLD_OF`), sixteen words of matrix a placement, then eight of
// exact translation a placement behind every matrix.
import { wgslProgram } from '../../../packages/math/src/wgsl/assemble.ts'
import { runtimeSceneWgsl } from '../../../packages/sdk-browser/src/bounce/runtimeSceneWgsl.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'

/** Words of a hit as the kernel writes it. */
export const HIT_WORDS = 6
/** The bindings: the proxy's buffer, the worlds' table, the rays, the hits, the mirrored worlds. */
const B = { proxy: 0, worlds: 1, rays: 2, hits: 3, oldWorlds: 4 } as const

const KERNEL = `@group(0) @binding(${B.rays}) var<storage,read> rays:array<vec4f>;
@group(0) @binding(${B.hits}) var<storage,read_write> hits:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g:vec3u){
 let i=g.x;
 if(i>=arrayLength(&rays)/2u){return;}
 rtWork=0u;rtTests=0u;rtExtra=0u;rtAnyHit=false;rtLost=false;
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

/** The walk the engine ships: the worlds read in their record table. */
export const NEW_WALK = wgslProgram(KERNEL, [
  runtimeSceneWgsl({ group: 0, proxy: B.proxy, worlds: B.worlds }),
])

/** The world a ray took a placement to before: the culling's rows mirrored in a buffer of its own. */
const OLD_WORLD_OF = `@group(0) @binding(${B.oldWorlds}) var<storage,read> oldWorlds:array<u32>;
fn oldFloat(at:u32)->f32{return bitcast<f32>(oldWorlds[at]);}
fn oldOrigin(at:u32,k:u32)->f32{return bitcast<f32>(toF32(vec2u(oldWorlds[at+2u*k],oldWorlds[at+2u*k+1u])));}
fn rtWorldOf(w:u32)->mat4x4f{
 if(w>=rtProxy.instances){
  let at=rtProxy.copyWorldsWord+(w-rtProxy.instances)*RT_WORLD_WORDS;
  return mat4x4f(rtFloat(at),rtFloat(at+1u),rtFloat(at+2u),0.0,
   rtFloat(at+4u),rtFloat(at+5u),rtFloat(at+6u),0.0,
   rtFloat(at+8u),rtFloat(at+9u),rtFloat(at+10u),0.0,
   rtFloat(at+12u),rtFloat(at+13u),rtFloat(at+14u),1.0);
 }
 let at=w*16u;
 let o=rtProxy.instances*16u+w*8u;
 return mat4x4f(oldFloat(at),oldFloat(at+1u),oldFloat(at+2u),0.0,
  oldFloat(at+4u),oldFloat(at+5u),oldFloat(at+6u),0.0,
  oldFloat(at+8u),oldFloat(at+9u),oldFloat(at+10u),0.0,
  oldOrigin(o,0u),oldOrigin(o,1u),oldOrigin(o,2u),1.0);
}`

/** The walk of before: the shipped text, its `rtWorldOf` alone replaced. */
export function oldWalk() {
  const start = NEW_WALK.indexOf('fn rtWorldOf(')
  if (start < 0) throw new Error('the shipped walk has no rtWorldOf')
  let end = NEW_WALK.indexOf('{', start)
  for (let depth = 0; end < NEW_WALK.length; end++) {
    if (NEW_WALK[end] === '{') depth++
    else if (NEW_WALK[end] === '}' && --depth === 0) break
  }
  return NEW_WALK.slice(0, start) + OLD_WORLD_OF + NEW_WALK.slice(end + 1)
}

/** What a walk binds: the proxy's buffer, and the worlds' table or the mirrored worlds. */
export type WalkInputs = { proxy: GPUBuffer; worlds?: GPUTextureView; oldWorlds?: GPUBuffer }

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
  if (inputs.oldWorlds)
    entries.push({ binding: B.oldWorlds, resource: { buffer: inputs.oldWorlds } })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }))
  pass.dispatchWorkgroups(Math.ceil(count / 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const read = (await readGpuBuffer(device, hits, bytes))!
  rayBuffer.destroy()
  hits.destroy()
  return Array.from(read)
}
