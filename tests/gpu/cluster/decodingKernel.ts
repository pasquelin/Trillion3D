// The cluster decode run on the GPU: a quantized page uploaded as words into a pool slot, a compute
// pass that decodes every vertex and every corner through the accessors the engine's raster,
// shadow and resolve stages call — `pageHeader`, `pageCorner`, `pagePosition`, `pageUv` over a
// page-table row —, then a readback. The page sits at a non-zero word offset, as in the engine's
// pool: the addressing is proved too, not only the arithmetic.
import { COTANGENT_FRAME_WGSL } from '../../../packages/sdk-browser/src/cluster/decodeWgsl.ts'
import { PAGE_GEOMETRY_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageGeometryWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageWgsl.ts'
import {
  ROW_FLAGS_WORD,
  ROW_INDEX_WORDS,
} from '../../../packages/sdk-browser/src/webgpu/row/pageRow.ts'
import {
  FLAG_CLUSTER_PAGE,
  PAGE_INFO_STRIDE,
} from '../../../packages/sdk-browser/src/visibility/buffer.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

/** Word the page sits at in its slot: never zero, so an accessor that forgot the offset fails. */
const SLOT_WORDS = 13
/** Words of a page-table row, and the two the decode reads: its flags, and its slot offset —
 *  `PageInfo.pageOffset`, the word before its index count. */
const ROW_WORDS = PAGE_INFO_STRIDE / 4,
  ROW_OFFSET_WORD = ROW_INDEX_WORDS - 1

/** Words a decoded vertex occupies in the readback: position, normal, uv, uv1, colour. */
export const VERTEX_WORDS = 14
/** Words a triangle occupies: its three corners, then the tangent and bitangent of its frame. */
export const TRIANGLE_WORDS = 9

/** A page ready to upload: its encoded bytes and the vertex and index counts its header carries. */
export interface ClusterPage {
  bytes: Uint8Array<ArrayBuffer>
  vertexCount: number
  indexCount: number
}

export const CLUSTER_DECODING_SHADER = `${PAGE_INFO_STRUCT_WGSL}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read_write> out:array<u32>;
@group(0) @binding(2) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage, read> positions:array<f32>;
@group(0) @binding(4) var<storage, read> uvs:array<f32>;
${PAGE_GEOMETRY_WGSL}
${COTANGENT_FRAME_WGSL}
fn clusterUv1(h:ClusterHeader,base:u32,vertex:u32)->vec2f{
 return vec2f(clusterGrid(base,h.uv1.x,vertex,h.uv1Bits.x,h.uv1Min.x,h.uv1Step),
  clusterGrid(base,h.uv1.y,vertex,h.uv1Bits.y,h.uv1Min.y,h.uv1Step));
}
fn put(at:u32,v:f32){out[at]=bitcast<u32>(v);}
@compute @workgroup_size(64) fn decode(@builtin(global_invocation_id) id:vec3u){
 let page=pages[0];let slot=page.pageOffset;
 let h=pageHeader(page);let i=id.x;
 if(i<h.vertexCount){
  let base=i*${VERTEX_WORDS}u;
  let p=pagePosition(page,h,i);put(base,p.x);put(base+1u,p.y);put(base+2u,p.z);
  let n=clusterNormal(h,slot,i);put(base+3u,n.x);put(base+4u,n.y);put(base+5u,n.z);
  let t=pageUv(page,h,i);put(base+6u,t.x);put(base+7u,t.y);
  let s=clusterUv1(h,slot,i);put(base+8u,s.x);put(base+9u,s.y);
  let c=clusterColor(h,slot,i);put(base+10u,c.x);put(base+11u,c.y);put(base+12u,c.z);put(base+13u,c.w);
 }
 if(i<h.indexCount/3u){
  let a=pageCorner(page,h,i*3u);let b=pageCorner(page,h,i*3u+1u);let c=pageCorner(page,h,i*3u+2u);
  let p0=pagePosition(page,h,a);let t0=pageUv(page,h,a);
  let frame=cotangentFrame(clusterNormal(h,slot,a),pagePosition(page,h,b)-p0,pagePosition(page,h,c)-p0,
   pageUv(page,h,b)-t0,pageUv(page,h,c)-t0);
  let base=h.vertexCount*${VERTEX_WORDS}u+i*${TRIANGLE_WORDS}u;
  out[base]=a;out[base+1u]=b;out[base+2u]=c;
  put(base+3u,frame.T.x);put(base+4u,frame.T.y);put(base+5u,frame.T.z);
  put(base+6u,frame.B.x);put(base+7u,frame.B.y);put(base+8u,frame.B.z);
 }
}`

/** One pipeline, every page decoded in turn, each page's output words read back. */
async function decodePages(pages: ClusterPage[]) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device } = gpu
  const { module, compilation } = await gpu.compile(CLUSTER_DECODING_SHADER)
  if (compilation.length) throw new Error(`the decode does not compile: ${compilation}`)
  const read = { type: 'read-only-storage' } as const
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: read },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: read },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: read },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: read },
    ],
  })
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'decode' },
  })
  const storage = (size: number, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST) =>
    device.createBuffer({ size, usage })
  // One row, saying the slot holds a quantized page and where in the pool it starts.
  const row = new Uint32Array(ROW_WORDS)
  row[ROW_FLAGS_WORD] = FLAG_CLUSTER_PAGE
  row[ROW_OFFSET_WORD] = SLOT_WORDS
  const table = storage(row.byteLength)
  device.queue.writeBuffer(table, 0, row)
  // The source float buffers the accessors never read on a quantized row: bound, and empty.
  const positions = storage(4),
    uvs = storage(4)
  const words = []
  for (const { bytes, vertexCount, indexCount } of pages) {
    const pool = storage(SLOT_WORDS * 4 + bytes.byteLength)
    device.queue.writeBuffer(pool, SLOT_WORDS * 4, bytes)
    const outputBytes = (vertexCount * VERTEX_WORDS + (indexCount / 3) * TRIANGLE_WORDS) * 4
    const output = storage(outputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC)
    const target = storage(outputBytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ)
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: pool } },
        { binding: 1, resource: { buffer: output } },
        { binding: 2, resource: { buffer: table } },
        { binding: 3, resource: { buffer: positions } },
        { binding: 4, resource: { buffer: uvs } },
      ],
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setBindGroup(0, group)
    pass.setPipeline(pipeline)
    pass.dispatchWorkgroups(Math.ceil(Math.max(vertexCount, indexCount / 3) / 64))
    pass.end()
    encoder.copyBufferToBuffer(output, 0, target, 0, outputBytes)
    device.queue.submit([encoder.finish()])
    await target.mapAsync(GPUMapMode.READ)
    words.push(new Uint32Array(target.getMappedRange().slice(0)))
    target.unmap()
    for (const buffer of [pool, output, target]) buffer.destroy()
  }
  for (const buffer of [table, positions, uvs]) buffer.destroy()
  const { court: adapter } = await gpu.fermer()
  return { adapter, words, errors: gpu.errors }
}

/** Decodes each page on the GPU: the adapter, and the output words of each page, in order. */
export const decodeOnGpu = (pages: ClusterPage[]) => runOnDawn(decodePages, pages)
