import * as THREE from 'three';
import { createSceneLightBuffer } from './sceneLighting.ts';
import { createDeferredLighting } from './deferredLighting.ts';
import { createSceneLightContractBuffer } from './webgpuPagesStateLights.ts';
import { prepareWebgpuPresentation } from './webgpuPresentationSetup.ts';
import { createGpuPageCache } from './gpuPages.ts';
import { createWebgpuPagesPipelines } from './webgpuPagesPipelines.ts';
import { ensureWebgpuPositionBuffer } from './webgpuPositions.ts';
import { prepareWebgpuBlend } from './webgpuBlendPrepare.ts';
import { createTransparentTable } from './webgpuTransparentTable.ts';
import { createTransparentCompaction } from './webgpuTransparentCompact.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { createGpuDagSelection, packDagSelection } from './gpuDagSelection.ts';
import { OPEN_CONE, triangleCone } from './pageCone.ts';
import { visMaterial } from './visibilityBuffer.ts';
import { ensureTargets } from './webgpuPagesTargets.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { dropVis } from './webgpuPagesDrops.ts';
import { prepareWebgpuTextures } from './webgpuPagesPrepareTextures.ts';
import { prepareWebgpuVisibility } from './webgpuPagesPrepareVisibility.ts';
import { prepareDirectLights } from './webgpuPagesPrepareLights.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Every cluster carries its own cone; a double-sided or back-facing material keeps it open. */
export function prepareCones(rt: WebgpuPagesRuntime) {
  const xyzCache = new WeakMap<THREE.BufferGeometry['attributes'], Float32Array>();
  for (const rec of rt.setup.allPages) {
    const array = rec.array,
      attr = rec.attributes.position;
    if (!array || !attr) continue;
    let xyz = xyzCache.get(rec.attributes);
    if (!xyz) {
      xyz = new Float32Array(attr.count * 3);
      // Un attribut simple de trois composantes non normalisé est déjà ce tableau : `getX/getY/getZ`
      // rendent alors `array[i * 3 + c]`, et la copie par bloc écrit les mêmes valeurs, arrondies au
      // même flottant 32 bits. Tout autre attribut — entrelacé, normalisé, d'un autre pas — repasse
      // par les accesseurs, seuls capables de dire ce qu'il porte.
      const plat = attr as THREE.BufferAttribute;
      if (
        plat.itemSize === 3 &&
        !plat.normalized &&
        !(attr as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute &&
        plat.array.length >= attr.count * 3
      )
        xyz.set(plat.array.subarray(0, attr.count * 3) as ArrayLike<number>);
      else
        for (let i = 0; i < attr.count; i++) {
          xyz[i * 3] = attr.getX(i);
          xyz[i * 3 + 1] = attr.getY(i);
          xyz[i * 3 + 2] = attr.getZ(i);
        }
      xyzCache.set(rec.attributes, xyz);
    }
    const material = visMaterial(rec.material);
    rec.cone = material.doubleSided || material.backSide ? OPEN_CONE : triangleCone(xyz, array);
  }
}

function cacheOptions(rt: WebgpuPagesRuntime) {
  const { diag, run } = rt,
    { pageBytes, slots } = rt.setup;
  return (
    diag.traceEnabled
      ? {
          pageBytes,
          slots,
          onDiagnostic: (event: {
            phase: string;
            message: string;
            context: Record<string, unknown>;
          }) =>
            diag.traceDiagnostic(`cache-${event.phase}`, event.message, () => ({
              ...event.context,
              frame: run.frame,
            })),
        }
      : { pageBytes, slots }
  ) as Parameters<typeof createGpuPageCache>[2];
}

/** Builds every GPU resource an image needs; called once, after the device and lighting exist. */
export async function prepareWebgpuPages(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { gpu, vis, run, context, diag, capabilities, blendState, services } = rt,
    { allPages, blendCopies, scene, viewport, cap, frameBudget } = rt.setup,
    { packedPages, selectionRoots, rows } = rt.layout;
  gpu.lights = createSceneLightBuffer(gpuDevice, context.sceneLighting ?? rt.setup.source);
  run.lightState = gpu.lights.update();
  rt.lights.buffer = createSceneLightContractBuffer(gpuDevice);
  // Ce tampon ne sert plus qu'au chemin des transparents : le chemin opaque n'éclaire que par les
  // lampes déclarées du contrat, et n'a plus aucune lumière écrite dans la scène à lire (P6).
  diag.engineDiagnostic('scene-lighting', 'Lumières de la scène actives', {
    version: 1,
    ...run.lightState,
    contractLights: rt.lights.store.count,
    opaqueUsesSceneLights: false,
    shadows: false,
    globalIllumination: false,
  });
  gpu.deferred = await createDeferredLighting(gpuDevice, rt.lights.buffer);
  context.signal?.throwIfAborted();
  ({
    presenter: gpu.presenter,
    canvasTexture: gpu.canvasTexture,
    blitMaterial: gpu.blitMaterial,
    blit: gpu.blit,
  } = prepareWebgpuPresentation(gpuDevice, scene, context.gpuCanvas));
  if (gpu.presenter)
    capabilities.unsupported = capabilities.unsupported.filter(
      (item) => item !== 'direct WebGPU present',
    );
  diag.engineDiagnostic('gpu-presentation', 'Présentation GPU initialisée', {
    mode: context.gpuCanvas
      ? 'direct-canvas'
      : gpu.presenter
        ? 'gpu-canvas-webgl-composition'
        : 'texture-only',
    imageReadbackDuringRender: false,
  });
  gpu.cache = createGpuPageCache(gpuDevice, services.pageSource, cacheOptions(rt));
  ({
    bindGroupLayout: gpu.bindGroupLayout,
    pipelineBack: gpu.pipelineBack,
    pipelineBackCw: gpu.pipelineBackCw,
    pipelineNone: gpu.pipelineNone,
    pipelineBlend: gpu.pipelineBlend,
  } = createWebgpuPagesPipelines(gpuDevice, UNIFORM_STRIDE));
  for (const rec of allPages)
    ensureWebgpuPositionBuffer(gpuDevice, rec.attributes, gpu.positionBuffers);
  for (let i = 0; i < packedPages.length; i++)
    rows.pagePositions[i] = gpu.positionBuffers.get(packedPages[i].attributes);
  gpu.zeroUv = gpuDevice.createBuffer({
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  gpuDevice.queue.writeBuffer(gpu.zeroUv, 0, new Float32Array([0, 0]));
  prepareWebgpuBlend(
    gpuDevice,
    blendCopies,
    gpu.positionBuffers,
    blendState,
    scene,
    !!context.gpuCanvas,
  );
  // The transparent draw order is the scene's and is settled here, once: an image only chooses which
  // of its entries survive.
  blendState.table = createTransparentTable(selectionRoots, packedPages, blendState.blendGpu);
  for (let i = 0; i < blendState.table.pagedItems.length; i++)
    blendState.table.pagedItems[i].pagedIndex = i;
  blendState.compaction = await createTransparentCompaction(gpuDevice, blendState.table);
  diag.engineDiagnostic('transparent-clusters', 'Table des clusters transparents', {
    version: 1,
    items: blendState.table.pagedItems.length,
    clusters: blendState.table.length,
    maxVertexWords: blendState.table.maxVertexWords,
    gpuCompaction: !!blendState.compaction?.encode,
  });
  const [width, height] = viewport;
  ensureTargets(rt, gpuDevice, Math.max(1, width), Math.max(1, height));
  ensureUniform(rt, gpuDevice, cap);
  try {
    await prepareWebgpuTextures(rt, gpuDevice);
    await prepareWebgpuVisibility(rt, gpuDevice);
  } catch (error) {
    diag.diagnosticFailure('material-pipeline-failed', error);
    dropVis(rt);
  }
  if (blendState.blendGpu.length && !vis.pipelineBlendTextured) dropVis(rt);
  if (context.gpuCanvas && !vis.visEnabled) throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE');
  if (context.gpuCanvas && blendState.blendGpu.length && !vis.pipelineBlendTextured)
    throw new Error('WEBGPU_FORWARD_MATERIAL_UNAVAILABLE');
  await prepareDirectLights(rt, gpuDevice);
  prepareCones(rt);
  // Every cluster carries its own error band, so the GPU cut is one thread per cluster.
  if (vis.gpuDraw && selectionRoots.length)
    run.gpuSelection = await createGpuDagSelection(gpuDevice, packDagSelection(selectionRoots), {
      residentCut: true,
    });
  capabilities.gpuDriven = !!run.gpuSelection;
  await services.bootstrapState.ensure();
  diag.engineDiagnostic('render-capabilities', 'Chemins de rendu prêts', {
    surfaceVersion: gpu.surfaces?.version ?? null,
    deferredLighting: !!gpu.deferred,
    directLightTiles: !!rt.lights.tiles,
    shadowAtlas: rt.lights.shadows ? rt.lights.shadows.size : null,
    shadowUnavailable: rt.lights.shadowReason,
    frameBudgetBytes: frameBudget,
    imageReadbackDuringRender: false,
    visibilityBuffer: vis.visEnabled,
    gpuSelection: !!run.gpuSelection,
    indirectDraw: !!vis.gpuDraw,
    hiz: !!vis.gpuHiz,
    unsupported: [...capabilities.unsupported],
  });
}
