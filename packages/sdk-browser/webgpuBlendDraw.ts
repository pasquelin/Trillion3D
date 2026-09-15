import * as THREE from 'three';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { blendBindEntries } from './webgpuBindEntries.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The bind group of one transparent item: its own attributes, the shared cluster lists, the atlas. */
function blendBindGroup(rt: WebgpuPagesRuntime, device: GPUDevice, item: BlendGpuItem) {
  const { gpu, vis, blendState } = rt,
    compaction = blendState.compaction,
    zero = gpu.zeroUv!;
  return device.createBindGroup({
    layout: vis.blendBindGroupLayout!,
    entries: blendBindEntries({
      indices: item.index ?? gpu.cache!.buffer,
      positions: item.position,
      uvs: item.uv ?? zero,
      uniform: gpu.uniformBuffer!,
      uniformSize: UNIFORM_STRIDE,
      colorAtlas: vis.colorAtlas!,
      sampler: vis.mapsSampler!,
      dataAtlas: vis.dataAtlas!,
      normals: item.normal ?? zero,
      scales: vis.materialScales!,
      sceneLights: gpu.lights!.buffer,
      clusterDiagnostic: compaction?.diagnosticBuffer ?? zero,
      clusterIds: compaction?.instanceBuffer ?? zero,
      clusterSpans: compaction?.spanBuffer ?? zero,
      slots: vis.slots!,
    }),
  });
}

/** Encodes the transparent back/front passes in source order and counts them on `rt.run`. */
export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
  textured: boolean,
) {
  const { gpu, vis, run, blendState } = rt,
    items = blendState.visibleBlend,
    { pipelineBlendTextured, pipelineBlendFront, pipelineBlendBack } = vis,
    indirect = blendState.compaction?.indirectBuffer;
  let drawCalls = 0,
    unpaged = 0;
  // Le pipeline courant de la passe : le reposer à l'identique ne change rien à l'état, et une
  // liste triée par ordre source enchaîne presque toujours des items qui demandent le même.
  let bound: GPURenderPipeline | undefined;
  const bind = (pipeline: GPURenderPipeline) => {
    if (pipeline === bound) return;
    bound = pipeline;
    pass.setPipeline(pipeline);
  };
  const pass = encoder.beginRenderPass({
    label: 'WG transparents',
    colorAttachments: [
      {
        view: vis.visEnabled && gpu.hdrView ? gpu.hdrView : gpu.colorView!,
        loadOp: 'load',
        storeOp: 'store',
      },
    ],
    depthStencilAttachment: { view: gpu.depthView!, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.group)
      item.group = textured
        ? blendBindGroup(rt, device, item)
        : device.createBindGroup({
            layout: gpu.bindGroupLayout!,
            entries: [
              { binding: 0, resource: { buffer: item.index ?? gpu.cache!.buffer } },
              { binding: 1, resource: { buffer: item.position } },
              { binding: 2, resource: { buffer: gpu.uniformBuffer!, size: UNIFORM_STRIDE } },
            ],
          });
    pass.setBindGroup(0, item.group, [(uniformBase + i) * UNIFORM_STRIDE]);
    const material = Array.isArray(item.material) ? item.material[0] : item.material;
    // Un seul déterminant : l'appel rendait deux fois la même valeur pour choisir les deux faces.
    const renverse = item.matrix.determinant() < 0;
    const front = renverse ? pipelineBlendFront : pipelineBlendBack,
      back = renverse ? pipelineBlendBack : pipelineBlendFront;
    // A paged item draws one instance per cluster the compaction kept: the count is the GPU's.
    const draw = () => {
      if (item.paged && indirect && item.pagedIndex !== undefined)
        pass.drawIndirect(indirect, item.pagedIndex * 16);
      else {
        pass.draw(item.count);
        unpaged += item.count / 3;
      }
      drawCalls++;
    };
    if (
      textured &&
      material.side === THREE.DoubleSide &&
      !material.forceSinglePass &&
      front &&
      back
    ) {
      bind(back);
      draw();
      bind(front);
      draw();
    } else {
      bind(
        textured
          ? material.side === THREE.FrontSide
            ? front!
            : material.side === THREE.BackSide
              ? back!
              : pipelineBlendTextured!
          : gpu.pipelineBlend!,
      );
      draw();
    }
  }
  pass.end();
  run.gpuDrawCalls += drawCalls;
  run.blendDrawCalls += drawCalls;
  run.blendUnpagedTriangles += unpaged;
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles;
}
