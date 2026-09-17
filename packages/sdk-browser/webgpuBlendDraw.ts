import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';
import { blendBindEntries, type BlendLighting } from './webgpuBindEntries.ts';
import { blendLightResources, sameLighting } from './webgpuBlendLighting.ts';
import { createBlendOverdraw } from './webgpuBlendOverdraw.ts';
import { countsBlendOverdraw } from './diagnosticGpuVariant.ts';
import { VOLUME_SIZE, VOLUME_STRIDE } from './webgpuTransmission.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { PIPELINE_BACK, PIPELINE_FRONT, planPipeline } from './webgpuBlendPlan.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from './webgpuBlendRuns.ts';
import { itemKept } from './webgpuBlendExpandCpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Le groupe de liaison d'une passe de melange : les tampons de sommets, les fiches d'items, les
 * atlas et l'eclairage. Un item pagine lit le cache de pages et la geometrie concatenee, donc TOUS
 * les items pagines partagent ce groupe ; un item non pagine porte ses propres tampons et garde le
 * sien.
 */
function blendBindGroup(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  item: BlendGpuItem | undefined,
  lighting: BlendLighting,
) {
  const { gpu, vis, blendState } = rt,
    compaction = blendState.compaction,
    zero = gpu.zeroUv!;
  return device.createBindGroup({
    layout: vis.blendBindGroupLayout!,
    entries: blendBindEntries({
      indices: item?.index ?? gpu.cache!.buffer,
      positions: item?.position ?? vis.concatPos!,
      uvs: item ? (item.uv ?? zero) : vis.concatUv!,
      uniform: blendState.viewBuffer!,
      uniformSize: BLEND_VIEW_SIZE,
      items: blendState.itemBuffer!,
      colorAtlas: vis.colorAtlas!,
      sampler: vis.mapsSampler!,
      dataAtlas: vis.dataAtlas!,
      normals: item ? (item.normal ?? zero) : vis.concatNrm!,
      scales: vis.materialScales!,
      ...lighting,
      clusterDiagnostic: compaction?.diagnosticBuffer ?? zero,
      planInstances: blendState.expandedBuffer ?? zero,
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
 * Encode une passe transparente : un `drawIndirect` par TRANCHE, et rien d'autre.
 *
 * Une tranche est une suite d'entrées du plan trié qui pose le même pipeline et lit les mêmes
 * tampons (`webgpuBlendRuns.ts`). Les primitives d'un appel sont rasterisées instance par instance,
 * dans l'ordre : la liste étalée par la carte porte donc les instances de chaque entrée à la suite,
 * du plus lointain au plus proche, et l'ordre de peinture est celui qu'un appel par item donnait —
 * sans les appels. Une scène de primitives paginées qui partagent un pipeline tient en un appel ;
 * un item non paginé, qui porte ses propres tampons, garde le sien.
 *
 * La boucle ne fait ni produit de matrice, ni lecture de matériau, ni test de tronc : le verdict du
 * tronc est posé avec les clés de classement (`webgpuBlendOrder.ts`), et il ne reste ici qu'à ne pas
 * encoder l'appel d'un item entièrement hors champ.
 *
 * `transmissive` dit laquelle des deux passes on encode : les mélanges d'abord, puis, une fois le
 * fond figé, les surfaces qui le relisent — une tranche par entrée, chacune décalant son volume.
 */
/** Le tableau de decalages dynamiques, alloue une fois : `setBindGroup` le lit sur place. */
const offsets = [0];

export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  transmissive = false,
) {
  const { gpu, vis, run, blendState } = rt,
    items = blendState.blendGpu,
    slice = transmissive ? 1 : 0,
    order = blendState.orders[slice],
    runs = blendState.runs[slice],
    count = blendState.runCount[slice],
    args = blendState.argsBuffer;
  if (!count || !args) return;
  // L'atlas d'ombres et la grille de sondes n'existent pas des la premiere image : un groupe bati
  // sur les remplacants doit etre refait le jour ou les vraies ressources arrivent.
  const lighting = blendLightResources(rt);
  if (!sameLighting(blendState.lighting, lighting)) {
    blendState.lighting = lighting;
    blendState.pagedGroup = undefined;
    for (const item of items) item.group = undefined;
  }
  blendState.pagedGroup ??= blendBindGroup(rt, device, undefined, lighting);
  // Diagnostic seul : la variante de comptage ouvre une requete d'occlusion autour de la passe.
  const overdraw = countsBlendOverdraw(rt.context?.diagnosticGpuVariant)
    ? (blendState.overdraw ??= createBlendOverdraw(device))
    : undefined;
  const pass = encoder.beginRenderPass({
    label: transmissive ? 'WG transmission' : 'WG transparents',
    occlusionQuerySet: overdraw?.set,
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
  let boundPipeline = -1,
    boundGroup: GPUBindGroup | undefined,
    encoded = 0;
  const base = blendState.planRegions[slice].args * 4;
  for (let index = 0; index < count; index++) {
    const at = index * RUN_WORDS,
      entry = order[runs[at]],
      owner = runOwner(entry, runs[at + 1]);
    // Une tranche qui nomme son item se decide sur le bit du tronc : l'appel qui ne poserait aucun
    // pixel n'est pas encode du tout, comme il ne l'etait pas par item. Une tranche qui en fusionne
    // plusieurs porte trop d'entrees pour les interroger une a une — c'est la carte qui met ses
    // instances a zero, et un appel sans instance ne pose rien.
    if (owner !== RUN_SHARED && !itemKept(blendState.keepPacked, owner)) continue;
    encoded++;
    if (boundPipeline !== planPipeline(entry)) {
      boundPipeline = planPipeline(entry);
      pass.setPipeline(
        boundPipeline === PIPELINE_FRONT
          ? vis.pipelineBlendFront!
          : boundPipeline === PIPELINE_BACK
            ? vis.pipelineBlendBack!
            : vis.pipelineBlendTextured!,
      );
    }
    const item = owner === RUN_SHARED ? undefined : items[owner];
    const group =
      item && !item.paged
        ? (item.group ??= blendBindGroup(rt, device, item, lighting))
        : blendState.pagedGroup!;
    // Le volume du materiau est la SEULE chose qui reste a decaler par item, et seule la passe de
    // transmission le lit : la passe de melange pose son groupe une fois pour toute la liste.
    // Les decalages sont lus a l'appel : un seul tableau de module, reecrit, suffit.
    if (transmissive) {
      offsets[0] = (owner === RUN_SHARED ? 0 : owner) * VOLUME_STRIDE;
      pass.setBindGroup(0, group, offsets);
    } else if (group !== boundGroup) {
      offsets[0] = 0;
      pass.setBindGroup(0, (boundGroup = group), offsets);
    }
    pass.drawIndirect(args, base + index * 16);
  }
  overdraw?.end(pass);
  pass.end();
  overdraw?.after(encoder);
  run.gpuDrawCalls += encoded;
  run.blendDrawCalls += encoded;
  run.blendUnpagedTriangles += transmissive
    ? blendState.transmissionTriangles
    : blendState.blendTriangles;
  run.blendSubmittedTriangles = run.blendPagedTriangles + run.blendUnpagedTriangles;
}
