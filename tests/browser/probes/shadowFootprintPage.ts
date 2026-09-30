/**
 * Page side of the shadow footprint probe (#1250): the shipped shadow read (`directShadowWgsl`,
 * with the light code it calls) compiled on a real device, its `shadowPageWord` run once per read
 * of `footprintReads` over the page table the pool wrote — the words it returns, the pages the
 * shipped request asked for, and those it listed as missed (#1211).
 */
import { MAX_SHADOW_SLICES, SHADOW_RECORD_FLOATS } from '../../../packages/sdk-core/src/index.ts';
import { DIRECT_LIGHT_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts';
import { directShadowWgsl } from '../../../packages/sdk-browser/src/lighting/direct/shadowWgsl.ts';
import { shadowRequestWords } from '../../../packages/sdk-browser/src/lighting/direct/shadowRequestWgsl.ts';
import { footprintReads } from '../../../packages/sdk-browser/src/lighting/direct/shadowFootprint.fixture.ts';
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts';
import { SHADOW_REQUEST_MISS } from '../../../packages/sdk-core/src/scene/light-shadow/footprint.ts';

/** The shadow read as a pass declares it; the far ray, which no page read reaches, lit. */
const SHADER = `${DIRECT_LIGHT_WGSL}
@group(0) @binding(4) var shadowAtlas:texture_depth_2d_array;
@group(0) @binding(5) var shadowSampler:sampler_comparison;
fn sunFarShadowFactor(P:vec3f,N:vec3f,L:vec3f)->f32{return 1.0;}
${directShadowWgsl(0, 1, 2)}
struct Read{map:vec4i,page:vec4i,t:vec2f,}
@group(0) @binding(6) var<storage,read> reads:array<Read>;
@group(0) @binding(7) var<storage,read_write> words:array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&reads)){return;}
 let r=reads[id.x];
 words[id.x]=shadowPageWord(ShadowMap(u32(r.map.x),u32(r.map.y),r.map.z,r.map.w,r.page.x),r.page.yz,r.t);
}`;
/** Words of a `Read`: two `vec4i`, a `vec2f`, padded to the struct's 16-byte alignment. */
const READ_WORDS = 12;
const RECORD_BYTES = MAX_SHADOW_SLICES * SHADOW_RECORD_FLOATS * 4;

const storage = (device: GPUDevice, size: number, usage = 0) =>
  device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | usage });

export async function run() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { unavailable: 'no WebGPU adapter' } as const;
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const module = device.createShaderModule({ code: SHADER });
  for (const message of (await module.getCompilationInfo()).messages)
    if (message.type === 'error') errors.push(message.message);
  const { words, reads } = footprintReads();
  const packed = new Int32Array(reads.length * READ_WORDS),
    floats = new Float32Array(packed.buffer);
  reads.forEach(({ map, p, t }, i) => {
    packed.set([map.base, map.ring, map.pages, map.ox, map.oy, p[0], p[1]], i * READ_WORDS);
    floats.set(t, i * READ_WORDS + 8);
  });
  const data = storage(device, RECORD_BYTES + words.byteLength),
    // Each read asks for its page, and may say it missed it.
    cap = 2 * reads.length,
    requests = storage(device, shadowRequestWords(cap) * 4, GPUBufferUsage.COPY_SRC),
    input = storage(device, packed.byteLength),
    output = storage(device, reads.length * 4, GPUBufferUsage.COPY_SRC);
  device.queue.writeBuffer(data, RECORD_BYTES, words);
  device.queue.writeBuffer(input, 0, packed);
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module } });
  const buffers: Array<[number, GPUBuffer]> = [
    [0, data],
    [1, requests],
    [6, input],
    [7, output],
  ];
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
    }),
  );
  pass.dispatchWorkgroups(Math.ceil(reads.length / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
  const read = [...((await readGpuBuffer(device, output, reads.length * 4)) ?? [])];
  const listed = (await readGpuBuffer(device, requests, (1 + cap) * 4)) ?? [];
  const entries = [...listed.slice(1, 1 + Math.min(listed[0] ?? 0, cap))];
  const asked = entries.filter((entry) => entry < SHADOW_REQUEST_MISS),
    missed = entries.filter((e) => e >= SHADOW_REQUEST_MISS).map((e) => e - SHADOW_REQUEST_MISS);
  device.destroy();
  return { errors, reads, read, asked, missed };
}
