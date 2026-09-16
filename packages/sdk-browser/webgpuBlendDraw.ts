import * as THREE from 'three';
import { matrixWindingCw } from '../sdk-core/index.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { blendBindEntries, type BlendLighting } from './webgpuBindEntries.ts';
import { blendLightResources, sameLighting } from './webgpuBlendLighting.ts';
import { createBlendOverdraw } from './webgpuBlendOverdraw.ts';
import { countsBlendOverdraw } from './diagnosticGpuVariant.ts';
import { VOLUME_SIZE, VOLUME_STRIDE } from './webgpuTransmission.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The bind group of one transparent item: its own attributes, the shared cluster lists, the atlas. */
function blendBindGroup(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  item: BlendGpuItem,
  lighting: BlendLighting,
) {
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
      ...lighting,
      clusterDiagnostic: compaction?.diagnosticBuffer ?? zero,
      clusterIds: compaction?.instanceBuffer ?? zero,
      clusterSpans: compaction?.spanBuffer ?? zero,
      volume: gpu.volumeBuffer!,
      volumeSize: VOLUME_SIZE,
      backdrop: gpu.backdrop!.colorView,
      backdropDepth: gpu.backdrop!.depthView,
      slots: vis.slots!,
    }),
  });
}

/**
 * Encodes the transparent back/front passes in source order and counts them on `rt.run`.
 *
 * `transmissive` dit laquelle des deux passes on encode : les mélanges d'abord, puis, une fois le
 * fond figé, les surfaces qui le relisent. Les deux parcourent la même liste dans le même ordre, si
 * bien que l'ordre source d'une scène est celui des deux passes bout à bout.
 */
export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
  textured: boolean,
  transmissive = false,
) {
  const { gpu, vis, run, blendState } = rt,
    items = blendState.visibleBlend,
    { pipelineBlendTextured, pipelineBlendFront, pipelineBlendBack } = vis,
    indirect = blendState.compaction?.indirectBuffer;
  let drawCalls = 0,
    unpaged = 0;
  // L'atlas d'ombres et la grille de sondes n'existent pas dès la première image : un groupe bâti
  // sur les remplaçants doit être refait le jour où les vraies ressources arrivent, sinon les
  // transparents liraient une grille vide pendant que les opaques lisent la bonne.
  const lighting = textured ? blendLightResources(rt) : undefined;
  if (lighting && !sameLighting(blendState.lighting, lighting)) {
    blendState.lighting = lighting;
    for (const item of items) item.group = undefined;
  }
  // Le pipeline courant de la passe : le reposer à l'identique ne change rien à l'état, et une
  // liste triée par ordre source enchaîne presque toujours des items qui demandent le même.
  let bound: GPURenderPipeline | undefined;
  const bind = (pipeline: GPURenderPipeline) => {
    if (pipeline === bound) return;
    bound = pipeline;
    pass.setPipeline(pipeline);
  };
  // Diagnostic seul : la variante de comptage ouvre une requête d'occlusion autour de la passe. La
  // passe, ses appels et leur ordre sont inchangés — seule la requête s'ajoute au descripteur.
  const overdraw = countsBlendOverdraw(rt.context?.diagnosticGpuVariant)
    ? (blendState.overdraw ??= createBlendOverdraw(device))
    : undefined;
  const pass = encoder.beginRenderPass({
    label: transmissive ? 'WG transmission' : 'WG transparents',
    ...(overdraw ? { occlusionQuerySet: overdraw.set } : {}),
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
  overdraw?.begin(pass, transmissive);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!!item.transmissive !== transmissive) continue;
    if (!item.group)
      item.group = textured
        ? blendBindGroup(rt, device, item, lighting!)
        : device.createBindGroup({
            layout: gpu.bindGroupLayout!,
            entries: [
              { binding: 0, resource: { buffer: item.index ?? gpu.cache!.buffer } },
              { binding: 1, resource: { buffer: item.position } },
              { binding: 2, resource: { buffer: gpu.uniformBuffer!, size: UNIFORM_STRIDE } },
            ],
          });
    pass.setBindGroup(
      0,
      item.group,
      textured
        ? [(uniformBase + i) * UNIFORM_STRIDE, i * VOLUME_STRIDE]
        : [(uniformBase + i) * UNIFORM_STRIDE],
    );
    const material = Array.isArray(item.material) ? item.material[0] : item.material;
    // Un seul déterminant : l'appel rendait deux fois la même valeur pour choisir les deux faces.
    // Et une seule écriture de la règle, celle de sdk-core : sur la 3×3 d'une matrice monde affine
    // le verdict est celui de la 4×4, pour neuf multiplications au lieu d'une trentaine.
    const renverse = matrixWindingCw(item.matrix.elements);
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
  overdraw?.end(pass);
  pass.end();
  overdraw?.after(encoder);
  run.gpuDrawCalls += drawCalls;
  run.blendDrawCalls += drawCalls;
  run.blendUnpagedTriangles += unpaged;
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles;
}
