// The hardware raster under the engine's face state: the `cullMode: 'back'` of the pages
// pipelines and the `frontFace` that `windingCw` picks (`webgpu/pages/render/winding.ts`) —
// winding reversed under a reflection. One fragment counter per case: the faces the engine draws,
// the ground truth a cut decision is held against.
import assert from 'node:assert/strict';
import { runOnDawn } from '../kit/onDawn.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';

const RASTER = `struct Uni{viewProj:mat4x4f,}
@group(0) @binding(0) var<uniform> uni:Uni;
@group(0) @binding(1) var<storage, read_write> counts:array<atomic<u32>>;
struct VsOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) slot:u32,}
@vertex fn vs(@location(0) world:vec3f,@location(1) slot:f32)->VsOut{
 var out:VsOut;out.position=uni.viewProj*vec4f(world,1.0);out.slot=u32(slot);return out;
}
@fragment fn fs(in:VsOut)->@location(0) vec4f{
 atomicAdd(&counts[in.slot],1u);return vec4f(1.0,0.0,0.0,1.0);
}`;

/** What to rasterise: world vertices as `x, y, z, slot`, the vertex ranges drawn under each
 *  front face, the view-projection, the target's size, and one counter slot per case. */
export interface WindingRasterLoad {
  vertices: number[];
  ranges: Array<['ccw' | 'cw', number, number]>;
  viewProj: number[];
  width: number;
  height: number;
  slots: number;
}

async function rasterise({ vertices, ranges, viewProj, width, height, slots }: WindingRasterLoad) {
  const gpu = await openGpuDevice();
  assert.ok(gpu, 'WebGPU must be available');
  const { device } = gpu;
  const { module, compilation } = await gpu.compile(RASTER);
  assert.deepEqual(compilation, [], 'the raster shader compiles');
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
    ],
  });
  const attributes: GPUVertexAttribute[] = [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32' },
  ];
  const pipeline = (frontFace: GPUFrontFace) =>
    device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 16, attributes }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace },
    });
  const pipelines = { ccw: pipeline('ccw'), cw: pipeline('cw') };
  const buffer = (
    data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
    usage: GPUBufferUsageFlags,
  ) => {
    const made = device.createBuffer({ size: Math.max(16, data.byteLength), usage });
    device.queue.writeBuffer(made, 0, data);
    return made;
  };
  const vertexBuffer = buffer(
    new Float32Array(vertices),
    GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  );
  const uniform = buffer(
    new Float32Array(viewProj),
    GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  );
  const bytes = Math.max(4, slots * 4);
  const counts = buffer(
    new Uint32Array(Math.max(1, slots)),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  );
  const readback = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const target = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    ],
  });
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: counts } },
      ],
    }),
  );
  pass.setVertexBuffer(0, vertexBuffer);
  for (const [frontFace, first, count] of ranges) {
    if (count === 0) continue;
    pass.setPipeline(pipelines[frontFace]);
    pass.draw(count, 1, first, 0);
  }
  pass.end();
  encoder.copyBufferToBuffer(counts, 0, readback, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const fragments = Array.from(new Uint32Array(readback.getMappedRange().slice(0), 0, slots));
  readback.unmap();
  const { court: adapter } = await gpu.fermer();
  assert.deepEqual(gpu.errors, [], 'the device reports no error');
  return { adapter, fragments };
}

/** Rasterises `load` and returns the adapter and the fragments each case's slot covered. A
 *  missing device, a shader that does not compile or a GPU error fails the call. */
export function runWindingRaster(load: WindingRasterLoad) {
  return runOnDawn(rasterise, load);
}
