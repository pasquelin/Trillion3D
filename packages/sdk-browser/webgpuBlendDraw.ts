import * as THREE from 'three';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';

type DrawOptions = {
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  uniformBase: number;
  items: BlendGpuItem[];
  textured: boolean;
  visEnabled: boolean;
  hdrView?: GPUTextureView;
  colorView: GPUTextureView;
  depthView: GPUTextureView;
  targetSize: [number, number];
  uniformBuffer: GPUBuffer;
  blendBindGroupLayout?: GPUBindGroupLayout;
  mapsTexture?: GPUTexture;
  mapsSampler?: GPUSampler;
  dataMapsTexture?: GPUTexture;
  materialScales?: GPUBuffer;
  zeroUv?: GPUBuffer;
  lightBuffer?: GPUBuffer;
  bindGroupLayout?: GPUBindGroupLayout;
  pipelineBlend: GPURenderPipeline;
  pipelineBlendTextured?: GPURenderPipeline;
  pipelineBlendFront?: GPURenderPipeline;
  pipelineBlendBack?: GPURenderPipeline;
};

/** Encodes the transparent back/front passes in source order. */
export function drawBlendPass({
  device,
  encoder,
  uniformBase,
  items,
  textured,
  visEnabled,
  hdrView,
  colorView,
  depthView,
  targetSize,
  uniformBuffer,
  blendBindGroupLayout,
  mapsTexture,
  mapsSampler,
  dataMapsTexture,
  materialScales,
  zeroUv,
  lightBuffer,
  bindGroupLayout,
  pipelineBlend,
  pipelineBlendTextured,
  pipelineBlendFront,
  pipelineBlendBack,
}: DrawOptions) {
  let drawCalls = 0,
    submittedTriangles = 0;
  const pass = encoder.beginRenderPass({
    label: 'WG transparents',
    colorAttachments: [
      { view: visEnabled && hdrView ? hdrView : colorView, loadOp: 'load', storeOp: 'store' },
    ],
    depthStencilAttachment: { view: depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
  });
  pass.setViewport(0, 0, targetSize[0], targetSize[1], 0, 1);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.group) {
      if (textured)
        item.group = device.createBindGroup({
          layout: blendBindGroupLayout!,
          entries: [
            { binding: 0, resource: { buffer: item.index } },
            { binding: 1, resource: { buffer: item.position } },
            { binding: 2, resource: { buffer: item.uv ?? zeroUv! } },
            { binding: 3, resource: { buffer: uniformBuffer, size: UNIFORM_STRIDE } },
            { binding: 4, resource: mapsTexture!.createView({ dimension: '2d-array' }) },
            { binding: 5, resource: mapsSampler! },
            { binding: 6, resource: dataMapsTexture!.createView({ dimension: '2d-array' }) },
            { binding: 7, resource: { buffer: item.normal ?? zeroUv! } },
            { binding: 8, resource: { buffer: materialScales! } },
            { binding: 9, resource: { buffer: lightBuffer! } },
            { binding: 10, resource: { buffer: item.diagnosticBuffer ?? zeroUv! } },
          ],
        });
      else
        item.group = device.createBindGroup({
          layout: bindGroupLayout!,
          entries: [
            { binding: 0, resource: { buffer: item.index } },
            { binding: 1, resource: { buffer: item.position } },
            { binding: 2, resource: { buffer: uniformBuffer, size: UNIFORM_STRIDE } },
          ],
        });
    }
    pass.setBindGroup(0, item.group, [(uniformBase + i) * UNIFORM_STRIDE]);
    const material = Array.isArray(item.material) ? item.material[0] : item.material;
    const front = item.matrix.determinant() < 0 ? pipelineBlendFront : pipelineBlendBack,
      back = item.matrix.determinant() < 0 ? pipelineBlendBack : pipelineBlendFront;
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
  return { drawCalls, submittedTriangles };
}
