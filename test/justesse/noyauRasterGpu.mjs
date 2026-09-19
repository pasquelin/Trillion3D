// Rasterisation actually run in Chromium WebGPU, with the engine's face state: the
// `cullMode:'back'` of `webgpuPagesPipelines` and the `frontFace` that `pipelineFor` picks via
// `windingCw` — hence winding reversed under reflection, as Three does in WebGL
// (`frontFaceCW = matrixWorld.determinant() < 0`). The only measurement is the fragment count
// covered per case: the set of faces the engine actually draws, the only ground truth that can
// be opposed to a cut decision. The Chromium harness is that of `pageWebgpu.mjs`.
import { dansPageWebgpu } from './pageWebgpu.mjs';

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

/** Run in the page: two pipelines (forward winding, reversed winding), one counter per case. */
async function executer({ shader, sommets, bornes, viewProj, largeur, hauteur, slots }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const buffers = [
    {
      arrayStride: 16,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32' },
      ],
    },
  ];
  const pipeline = (frontFace) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vs', buffers },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace },
    });
  const pipelines = { ccw: pipeline('ccw'), cw: pipeline('cw') };
  const vertexBuffer = device.createBuffer({
    size: Math.max(16, sommets.length * 4),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, new Float32Array(sommets));
  const uniform = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniform, 0, new Float32Array(viewProj));
  const octets = Math.max(4, slots * 4);
  const compteurs = device.createBuffer({
    size: octets,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(compteurs, 0, new Uint32Array(slots));
  const lecture = device.createBuffer({
    size: octets,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const group = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: { buffer: compteurs } },
    ],
  });
  const cible = device.createTexture({
    size: [largeur, hauteur],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const encoder = device.createCommandEncoder();
  const passe = encoder.beginRenderPass({
    colorAttachments: [
      { view: cible.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    ],
  });
  passe.setBindGroup(0, group);
  passe.setVertexBuffer(0, vertexBuffer);
  for (const [sens, debut, nombre] of bornes) {
    if (nombre === 0) continue;
    passe.setPipeline(pipelines[sens]);
    passe.draw(nombre, 1, debut, 0);
  }
  passe.end();
  encoder.copyBufferToBuffer(compteurs, 0, lecture, 0, octets);
  device.queue.submit([encoder.finish()]);
  await lecture.mapAsync(GPUMapMode.READ);
  const fragments = Array.from(new Uint32Array(lecture.getMappedRange().slice(0), 0, slots));
  lecture.unmap();
  const info = await appareil.fermer();
  return { adaptateur: info.court, fragments, erreurs };
}

/** Rasterise les cas et rend le nombre de fragments couverts par cas. */
export async function rasterGpu(charge) {
  return await dansPageWebgpu(
    executer,
    { ...charge, shader: RASTER },
    { titre: 'WebGeometry rasterisation' },
  );
}
