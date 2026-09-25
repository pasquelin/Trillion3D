// The cluster decode WGSL actually run in Chromium WebGPU: a quantized page uploaded as words
// INTO A POOL SLOT, a compute pass that decodes every vertex and every corner through the very
// accessors the engine's raster, shadow and resolve stages call — `pageHeader`, `pageCorner`,
// `pagePosition`, `pageUv` over a page-table row —, then a readback. The page sits at a non-zero
// word offset, as it does in the engine's pool: what is proved is the addressing too, not only
// the arithmetic. The Chromium harness is that of `pageWebgpu.ts`.
import { COTANGENT_FRAME_WGSL } from '../../../packages/sdk-browser/src/cluster/decodeWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageGeometryWgsl.ts';
import { PAGE_INFO_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageWgsl.ts';
import { ROW_FLAGS_WORD } from '../../../packages/sdk-browser/src/webgpu/row/pageRow.ts';
import {
  FLAG_CLUSTER_PAGE,
  PAGE_INFO_STRIDE,
} from '../../../packages/sdk-browser/src/visibility/buffer.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';

/** Word the page sits at in its slot: never zero, so an accessor that forgot the offset fails. */
const SLOT_WORDS = 13;
/** Words of a page-table row, and the two the row needs: its flags and its slot offset. */
const ROW_WORDS = PAGE_INFO_STRIDE / 4,
  ROW_OFFSET_WORD = 24;

/** Words a decoded vertex occupies in the readback: position, normal, uv, uv1, colour. */
export const VERTEX_WORDS = 14;
/** Words a triangle occupies: its three corners, then the tangent and bitangent of its frame. */
export const TRIANGLE_WORDS = 9;

/** A page ready to upload: its encoded bytes and the vertex/index counts its header carries. */
export interface ClusterPage {
  octets: Uint8Array | number[];
  vertexCount: number;
  indexCount: number;
}

/** The decode kernel. It declares the camera uniform `uni` the page geometry's screen routines
 *  read (`pageLine`, `pageSprite`), as every pass that includes it does: the decode never calls
 *  them, so the binding stays out of the kernel's interface and nothing is bound there. */
export const CLUSTER_DECODING_SHADER = `${PAGE_INFO_WGSL}
@group(0) @binding(0) var<storage, read> indices:array<u32>;
@group(0) @binding(1) var<storage, read_write> out:array<u32>;
@group(0) @binding(2) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage, read> positions:array<f32>;
@group(0) @binding(4) var<storage, read> uvs:array<f32>;
@group(0) @binding(5) var<uniform> uni:Uniforms;
${PAGE_GEOMETRY_WGSL}
${COTANGENT_FRAME_WGSL}
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
}`;

// Serialized into the page, like every page kernel of the probes: it opens the device itself.
// jscpd:ignore-start
/** Run in the page: one pipeline, every page decoded, the output words read back. */
async function executer({
  shader,
  pages,
  vertexWords,
  triangleWords,
  slot,
  row,
}: {
  shader: string;
  pages: (ClusterPage & { octets: number[] })[];
  vertexWords: number;
  triangleWords: number;
  slot: number;
  row: number[];
}) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  // jscpd:ignore-end
  const read = { type: 'read-only-storage' } as const;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: read },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: read },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: read },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: read },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'decode' },
  });
  // One row, saying the slot holds a quantized page and where in the pool it starts.
  const rowWords = new Uint32Array(row);
  const table = device.createBuffer({
    size: rowWords.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(table, 0, rowWords);
  // The source float buffers the accessors never read on a quantized row: bound, and empty.
  const vide = () =>
    device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const positions = vide(),
    uvs = vide();
  const resultats = [];
  for (const { octets, vertexCount, indexCount } of pages) {
    const words = device.createBuffer({
      size: slot * 4 + octets.length,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(words, slot * 4, new Uint8Array(octets));
    const sortieOctets = (vertexCount * vertexWords + (indexCount / 3) * triangleWords) * 4;
    const sortie = device.createBuffer({
      size: sortieOctets,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const lecture = device.createBuffer({
      size: sortieOctets,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: words } },
        { binding: 1, resource: { buffer: sortie } },
        { binding: 2, resource: { buffer: table } },
        { binding: 3, resource: { buffer: positions } },
        { binding: 4, resource: { buffer: uvs } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, group);
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(Math.ceil(Math.max(vertexCount, indexCount / 3) / 64));
    pass.end();
    encoder.copyBufferToBuffer(sortie, 0, lecture, 0, sortieOctets);
    device.queue.submit([encoder.finish()]);
    await lecture.mapAsync(GPUMapMode.READ);
    resultats.push(Array.from(new Uint32Array(lecture.getMappedRange().slice(0))));
    lecture.unmap();
    for (const buffer of [words, sortie, lecture]) buffer.destroy();
  }
  for (const buffer of [table, positions, uvs]) buffer.destroy();
  const info = await appareil.fermer();
  return { adaptateur: info.court, resultats, erreurs };
}

/** Decodes each `{ octets, vertexCount, indexCount }` page on the GPU; words per page, in order. */
export async function decodageClusterGpu(pages: ClusterPage[]) {
  const row = new Array<number>(ROW_WORDS).fill(0);
  row[ROW_FLAGS_WORD] = FLAG_CLUSTER_PAGE;
  row[ROW_OFFSET_WORD] = SLOT_WORDS;
  return await dansPageWebgpu(executer, {
    shader: CLUSTER_DECODING_SHADER,
    pages: pages.map((page) => ({ ...page, octets: Array.from(page.octets) })),
    vertexWords: VERTEX_WORDS,
    triangleWords: TRIANGLE_WORDS,
    slot: SLOT_WORDS,
    row,
  });
}
