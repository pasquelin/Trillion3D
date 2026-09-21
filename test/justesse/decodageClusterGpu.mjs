// The cluster decode WGSL actually run in Chromium WebGPU: a quantized page uploaded as words,
// a compute pass that decodes every vertex and every corner with the engine's routines, then a
// readback. The Chromium harness is that of `pageWebgpu.mjs`.
import {
  COTANGENT_FRAME_WGSL,
  clusterDecodeWgsl,
} from '../../packages/sdk-browser/clusterDecodeWgsl.ts';
import { dansPageWebgpu } from './pageWebgpu.mjs';

/** Words a decoded vertex occupies in the readback: position, normal, uv, uv1, colour. */
export const VERTEX_WORDS = 14;
/** Words a triangle occupies: its three corners, then the tangent and bitangent of its frame. */
export const TRIANGLE_WORDS = 9;

const SHADER = `@group(0) @binding(0) var<storage, read> pageWords:array<u32>;
@group(0) @binding(1) var<storage, read_write> out:array<u32>;
${clusterDecodeWgsl('pageWords')}
${COTANGENT_FRAME_WGSL}
fn put(at:u32,v:f32){out[at]=bitcast<u32>(v);}
@compute @workgroup_size(64) fn decode(@builtin(global_invocation_id) id:vec3u){
 let h=clusterHeader(0u);let i=id.x;
 if(i<h.vertexCount){
  let base=i*${VERTEX_WORDS}u;
  let p=clusterPosition(h,0u,i);put(base,p.x);put(base+1u,p.y);put(base+2u,p.z);
  let n=clusterNormal(h,0u,i);put(base+3u,n.x);put(base+4u,n.y);put(base+5u,n.z);
  let t=clusterUv(h,0u,i);put(base+6u,t.x);put(base+7u,t.y);
  let s=clusterUv1(h,0u,i);put(base+8u,s.x);put(base+9u,s.y);
  let c=clusterColor(h,0u,i);put(base+10u,c.x);put(base+11u,c.y);put(base+12u,c.z);put(base+13u,c.w);
 }
 if(i<h.indexCount/3u){
  let a=clusterIndex(h,0u,i*3u);let b=clusterIndex(h,0u,i*3u+1u);let c=clusterIndex(h,0u,i*3u+2u);
  let p0=clusterPosition(h,0u,a);let t0=clusterUv(h,0u,a);
  let frame=cotangentFrame(clusterNormal(h,0u,a),clusterPosition(h,0u,b)-p0,clusterPosition(h,0u,c)-p0,
   clusterUv(h,0u,b)-t0,clusterUv(h,0u,c)-t0);
  let base=h.vertexCount*${VERTEX_WORDS}u+i*${TRIANGLE_WORDS}u;
  out[base]=a;out[base+1u]=b;out[base+2u]=c;
  put(base+3u,frame.T.x);put(base+4u,frame.T.y);put(base+5u,frame.T.z);
  put(base+6u,frame.B.x);put(base+7u,frame.B.y);put(base+8u,frame.B.z);
 }
}`;

/** Run in the page: one pipeline, every page decoded, the output words read back. */
async function executer({ shader, pages, vertexWords, triangleWords }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'decode' },
  });
  const resultats = [];
  for (const { octets, vertexCount, indexCount } of pages) {
    const words = device.createBuffer({
      size: octets.length,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(words, 0, new Uint8Array(octets));
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
  const info = await appareil.fermer();
  return { adaptateur: info.court, resultats, erreurs };
}

/** Decodes each `{ octets, vertexCount, indexCount }` page on the GPU; words per page, in order. */
export async function decodageClusterGpu(pages) {
  return await dansPageWebgpu(executer, {
    shader: SHADER,
    pages: pages.map((page) => ({ ...page, octets: Array.from(page.octets) })),
    vertexWords: VERTEX_WORDS,
    triangleWords: TRIANGLE_WORDS,
  });
}
