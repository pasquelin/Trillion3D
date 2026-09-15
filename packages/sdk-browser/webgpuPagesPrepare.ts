import * as THREE from 'three';
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
import { VOLUME_STRIDE, createVolumeBuffer } from './webgpuTransmission.ts';
import { createGpuDagSelection, packDagSelection } from './gpuDagSelection.ts';
import { OPEN_CONE, triangleCone } from './pageCone.ts';
import { visMaterial } from './visibilityBuffer.ts';
import { ensureTargets } from './webgpuPagesTargets.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { dropVis, grantCapability } from './webgpuPagesDrops.ts';
import { prepareWebgpuTextures } from './webgpuPagesPrepareTextures.ts';
import { prepareWebgpuVisibility } from './webgpuPagesPrepareVisibility.ts';
import { prepareDirectLights } from './webgpuPagesPrepareLights.ts';
import { type WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Every cluster carries its own cone; a double-sided or back-facing material keeps it open.
 *  Poser un cône, c'est le déclarer : la racine de la page relève son drapeau, sans quoi la coupe
 *  la croirait sans cône et ne lirait plus `cone`. Les pages sont parcourues par racine : le
 *  catalogue `allPages` est la concaténation de leurs pages, dans le même ordre. */
export function prepareCones(rt: WebgpuPagesRuntime) {
  const xyzCache = new WeakMap<THREE.BufferGeometry['attributes'], Float32Array>();
  for (const root of rt.setup.roots)
    for (const rec of root.pages) {
      const array = rec.array,
        attr = rec.attributes.position;
      if (!array || !attr) continue;
      root.cones = true;
      let xyz = xyzCache.get(rec.attributes);
      if (!xyz) {
        xyz = new Float32Array(attr.count * 3);
        // Un attribut simple de trois composantes non normalisé est déjà ce tableau :
        // `getX/getY/getZ` rendent alors `array[i * 3 + c]`, et la copie par bloc écrit les mêmes
        // valeurs, arrondies au même flottant 32 bits. Tout autre attribut — entrelacé, normalisé,
        // d'un autre pas — repasse par les accesseurs, seuls capables de dire ce qu'il porte.
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
  rt.lights.buffer = createSceneLightContractBuffer(gpuDevice);
  // Plus aucune lumière écrite dans la scène, d'aucun côté : opaques et transparents lisent le même
  // tampon de lampes déclarées, avec les mêmes ombres et la même exposition (P6).
  diag.engineDiagnostic('scene-lighting', 'Lumières de la scène actives', {
    version: 1,
    contractLights: rt.lights.store.count,
    sceneGraphLights: false,
    implicitAmbient: false,
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
  if (gpu.presenter) grantCapability(capabilities, 'direct WebGPU present');
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
    ensureWebgpuPositionBuffer(gpuDevice, rec.attributes, gpu.positionBuffers, gpu);
  for (let i = 0; i < packedPages.length; i++)
    rows.pagePositions[i] = gpu.positionBuffers.get(packedPages[i].attributes);
  gpu.zeroUv = gpuDevice.createBuffer({
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  gpuDevice.queue.writeBuffer(gpu.zeroUv, 0, new Float32Array([0, 0]));
  blendState.transmissive = prepareWebgpuBlend(gpuDevice, blendCopies, gpu, blendState, scene);
  blendState.volumePacked = new Float32Array(blendState.blendGpu.length * (VOLUME_STRIDE / 4));
  gpu.volumeBuffer = createVolumeBuffer(gpuDevice, blendState.blendGpu.length);
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
    transmissiveMeshes: blendState.transmissive,
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
    bounceProxy: !!context.readSceneProxy,
    bounceWanted: rt.bounce.wanted,
    frameBudgetBytes: frameBudget,
    imageReadbackDuringRender: false,
    visibilityBuffer: vis.visEnabled,
    gpuSelection: !!run.gpuSelection,
    indirectDraw: !!vis.gpuDraw,
    hiz: !!vis.gpuHiz,
    unsupported: [...capabilities.unsupported],
  });
}
