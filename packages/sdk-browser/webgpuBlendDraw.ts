import * as THREE from 'three';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { blendBindEntries } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Encodes the transparent back/front passes in source order and counts them on `rt.run`. */
export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
  textured: boolean,
) {
  const { gpu, vis, run } = rt,
    items = rt.blendState.visibleBlend,
    uniformBuffer = gpu.uniformBuffer!,
    pipelineBlend = gpu.pipelineBlend!,
    lightBuffer = gpu.lights?.buffer,
    { pipelineBlendTextured, pipelineBlendFront, pipelineBlendBack } = vis;
  let drawCalls = 0,
    submittedTriangles = 0;
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
    if (!item.group) {
      if (textured)
        item.group = device.createBindGroup({
          layout: vis.blendBindGroupLayout!,
          entries: blendBindEntries({
            indices: item.index,
            positions: item.position,
            uvs: item.uv ?? gpu.zeroUv!,
            uniform: uniformBuffer,
            uniformSize: UNIFORM_STRIDE,
            colorAtlas: vis.colorAtlas!,
            sampler: vis.mapsSampler!,
            dataAtlas: vis.dataAtlas!,
            normals: item.normal ?? gpu.zeroUv!,
            scales: vis.materialScales!,
            sceneLights: lightBuffer!,
            triangleDiagnostic: item.diagnosticBuffer ?? gpu.zeroUv!,
            slots: vis.slots!,
          }),
        });
      else
        item.group = device.createBindGroup({
          layout: gpu.bindGroupLayout!,
          entries: [
            { binding: 0, resource: { buffer: item.index } },
            { binding: 1, resource: { buffer: item.position } },
            { binding: 2, resource: { buffer: uniformBuffer, size: UNIFORM_STRIDE } },
          ],
        });
    }
    pass.setBindGroup(0, item.group, [(uniformBase + i) * UNIFORM_STRIDE]);
    const material = Array.isArray(item.material) ? item.material[0] : item.material;
    // Un seul déterminant : l'appel rendait deux fois la même valeur pour choisir les deux faces.
    const renverse = item.matrix.determinant() < 0;
    const front = renverse ? pipelineBlendFront : pipelineBlendBack,
      back = renverse ? pipelineBlendBack : pipelineBlendFront;
    if (
      textured &&
      material.side === THREE.DoubleSide &&
      !material.forceSinglePass &&
      front &&
      back
    ) {
      pass.setPipeline(back);
      pass.draw(item.count);
      pass.setPipeline(front);
      pass.draw(item.count);
      drawCalls += 2;
      submittedTriangles += (2 * item.count) / 3;
    } else {
      pass.setPipeline(
        textured
          ? material.side === THREE.FrontSide
            ? front!
            : material.side === THREE.BackSide
              ? back!
              : pipelineBlendTextured!
          : pipelineBlend,
      );
      pass.draw(item.count);
      drawCalls++;
      submittedTriangles += item.count / 3;
    }
  }
  pass.end();
  run.gpuDrawCalls += drawCalls;
  run.blendDrawCalls += drawCalls;
  run.blendSubmittedTriangles += submittedTriangles;
}
