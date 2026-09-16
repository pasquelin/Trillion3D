import { frustumExcludesBox } from '../sdk-core/index.ts';
import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';
import { blendBindEntries, type BlendLighting } from './webgpuBindEntries.ts';
import { blendLightResources, sameLighting } from './webgpuBlendLighting.ts';
import { createBlendOverdraw } from './webgpuBlendOverdraw.ts';
import { countsBlendOverdraw } from './diagnosticGpuVariant.ts';
import { VOLUME_SIZE, VOLUME_STRIDE } from './webgpuTransmission.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { PIPELINE_BACK, PIPELINE_FRONT, planItem, planPipeline } from './webgpuBlendPlan.ts';
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
 * Encode une passe transparente : un `drawIndirect` par entree du plan, rien d'autre.
 *
 * Le plan est statique (`webgpuBlendPlan.ts`) : il porte le rang de l'item et le pipeline a poser,
 * dans l'ordre source de la scene, faces arriere puis faces avant pour un item double face. La
 * boucle ne fait donc plus ni produit de matrice, ni lecture de materiau, ni allocation ; le
 * nombre d'instances de chaque appel est celui que la carte vient d'ecrire, zero pour un item que
 * le tronc a rejete.
 *
 * `transmissive` dit laquelle des deux passes on encode : les melanges d'abord, puis, une fois le
 * fond fige, les surfaces qui le relisent.
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
    plan = transmissive ? blendState.planTransmission : blendState.planBlend,
    args = blendState.argsBuffer;
  if (!plan.length || !args) return;
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
  const planes = blendState.blendPlanes;
  for (let i = 0; i < plan.length; i++) {
    const entry = plan[i],
      index = planItem(entry),
      item = items[index],
      box = item.bounds;
    // Le noyau met a zero les instances d'un item hors champ, mais un appel encode reste un appel
    // soumis : le tronc est reteste ici, en double precision, et l'item entierement hors champ
    // n'est pas encode du tout. Le noyau reste conservateur au-dela de ce test.
    if (box && frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])) continue;
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
    const group = item.paged
      ? blendState.pagedGroup!
      : (item.group ??= blendBindGroup(rt, device, item, lighting));
    // Le volume du materiau est la SEULE chose qui reste a decaler par item, et seule la passe de
    // transmission le lit : la passe de melange pose son groupe une fois pour toute la liste.
    // Les decalages sont lus a l'appel : un seul tableau de module, reecrit, suffit.
    if (transmissive) {
      offsets[0] = index * VOLUME_STRIDE;
      pass.setBindGroup(0, group, offsets);
    } else if (group !== boundGroup) {
      offsets[0] = 0;
      pass.setBindGroup(0, (boundGroup = group), offsets);
    }
    pass.drawIndirect(args, index * 16);
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
