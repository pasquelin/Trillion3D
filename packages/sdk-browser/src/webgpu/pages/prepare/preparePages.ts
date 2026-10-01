import { createDeferredLighting } from '../../../lighting/deferred/deferred.ts';
import { prepareTemporalAntialiasing } from '../../../taa/prepare.ts';
import { createSceneLightContractBuffer } from '../state/lightBuffer.ts';
import { prepareWebgpuPresentation } from '../../frame/presentationSetup.ts';
import { createWebgpuPagesPipelines } from './pipelines.ts';
import { ensureWebgpuPositionBuffer, loadUnpaged } from '../../core/positions.ts';
import { prepareDeformationGeometry } from '../../../deformation/prepare.ts';
import { prepareWebgpuBlend } from '../../blend/prepare.ts';
import { declaredBlendModes } from '../../blend/stagePipelines.ts';
import { createTransparentTable } from '../../transparent/table.ts';
import { prepareBlendResources } from '../../blend/resources.ts';
import { createTransparentCompaction } from '../../transparent/compact.ts';
import { UNIFORM_STRIDE } from '../../blend/uniforms.ts';
import { VOLUME_WORDS, createVolumeBuffer } from '../../transparent/transmission.ts';
import { createGpuDagSelection, packDagSelection } from '../../../gpu/dag/selection.ts';
import { prepareCones } from './cones.ts';
import { cutsOnCpu, VIEW_ROWS } from '../../row/tableRows.ts';
import { grantFrameTargets } from './targetGrant.ts';
import { ensureUniform } from './pipelineFor.ts';
import { dropVis, fallbackToCpuCut, grantCapability } from '../io/drops.ts';
import { throwIfStopped } from '../io/lost.ts';
import { prepareWebgpuTextures } from './textures.ts';
import { prepareWebgpuVisibility } from './visibility.ts';
import { prepareDirectLights, prepareShadowPipelines } from './lights.ts';
import { grantWebgpuPagesCache } from './cache.ts';
import { litPrograms } from './contractLight.ts';
import { type WebgpuPagesRuntime } from '../runtime.ts';
import { loadImpostorCode } from '../../../impostor/code.ts';
import * as impostorLent from '../../impostor/lent.ts';

/** Builds every GPU resource an image needs, once; `gpuDevice` is then kept as `gpu.device`. A
 *  backend closed or a device lost starts no further step; the teardown releases what steps built. */
export async function prepareWebgpuPages(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { gpu, vis, run, context, diag, capabilities, blendState, services } = rt,
    { allPages, blendCopies, scene, cap } = rt.setup,
    { packedPages, selectionRoots, rows } = rt.layout;
  const step = <T>(name: string, work: () => Promise<T>) => {
    throwIfStopped(rt);
    rt.context.preparationStep?.(name);
    return work();
  };
  // The impostor draw's code, on its way beside every step below, awaited before the first image.
  const impostorCode = loadImpostorCode(rt.context, impostorLent);
  const lightBuffer = createSceneLightContractBuffer((gpu.device = gpuDevice), rt.lights.store);
  rt.lights.buffer = lightBuffer;
  // No more light written into the scene: opaques and transparents read the same declared-light buffer.
  diag.engineDiagnostic('scene-lighting', 'Scene lights active', {
    version: 1,
    contractLights: rt.lights.store.count,
    sceneGraphLights: false,
    implicitAmbient: false,
    shadows: false,
    globalIllumination: false,
  });
  // The lit program starts now, beside every other program, and prepare ends once it landed: the
  // first image is lit, never the unlit stand-in (#1362). Its later arrival (a light turned on) is a
  // new resource, or a held image would stay as it was. Both are awaited, each kept as built.
  const programs = await step('lighting and antialiasing programs', () =>
    Promise.allSettled([
      createDeferredLighting(
        gpuDevice,
        () => run.gate.resourcesChanged(),
        rt.lights.plan.sunWindow,
        litPrograms(rt),
      ),
      prepareTemporalAntialiasing(rt, gpuDevice),
    ]),
  );
  const [deferred] = programs;
  if (deferred.status === 'fulfilled') gpu.deferred = deferred.value;
  for (const program of programs) if (program.status === 'rejected') throw program.reason;
  gpu.presenter = prepareWebgpuPresentation(gpuDevice, context.gpuCanvas);
  if (gpu.presenter) grantCapability(capabilities, 'direct WebGPU present');
  diag.engineDiagnostic('gpu-presentation', 'GPU presentation initialised', {
    mode: context.gpuCanvas
      ? 'direct-canvas'
      : gpu.presenter
        ? 'gpu-canvas-webgl-composition'
        : 'texture-only',
    imageReadbackDuringRender: false,
  });
  Object.assign(gpu, await createWebgpuPagesPipelines(gpuDevice, UNIFORM_STRIDE));
  // Only a cluster no quantized page covers still needs its primitive's float positions: what the
  // fallback draw reads for the others is the page in their pool slot.
  for (const rec of await loadUnpaged(allPages, blendCopies))
    ensureWebgpuPositionBuffer(gpuDevice, rec.attributes, gpu.positionBuffers, gpu);
  for (let i = 0; i < packedPages.length; i++)
    rows.pagePositions[i] = gpu.positionBuffers.get(rt.layout.recordOf(i)!.attributes);
  // Fresh position buffers: rank sync starts over from the catalogue.
  rows.rowsRevision++;
  gpu.zeroUv = gpuDevice.createBuffer({
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  gpuDevice.queue.writeBuffer(gpu.zeroUv, 0, new Float32Array([0, 0]));
  blendState.transmissive = prepareWebgpuBlend(gpuDevice, blendCopies, gpu, blendState, scene);
  await gpu.pipelineBlend!.precompile(declaredBlendModes(blendState.blendGpu));
  blendState.volumePacked = new Float32Array(blendState.transmissive * VOLUME_WORDS);
  gpu.volumeBuffer = createVolumeBuffer(gpuDevice, blendState.transmissive);
  // The transparent draw order is the scene's, settled here once: an image only picks survivors.
  const table = createTransparentTable(selectionRoots, packedPages, blendState.blendGpu);
  blendState.table = table;
  for (let i = 0; i < blendState.table.pagedItems.length; i++)
    blendState.table.pagedItems[i].pagedIndex = i;
  blendState.compaction = await step('transparent compaction', () =>
    createTransparentCompaction(gpuDevice, table),
  );
  diag.engineDiagnostic('transparent-clusters', 'Transparent cluster table', {
    version: 1,
    items: blendState.table.pagedItems.length,
    clusters: blendState.table.length,
    maxVertexWords: blendState.table.maxVertexWords,
    gpuCompaction: !!blendState.compaction?.encode,
    transmissiveMeshes: blendState.transmissive,
  });
  throwIfStopped(rt);
  let geometryFailure: { error: unknown } | undefined;
  try {
    await prepareDeformationGeometry(rt, gpuDevice);
  } catch (error) {
    geometryFailure = { error };
  }
  if (geometryFailure && vis.deformation?.any) throw geometryFailure.error;
  gpu.impostorCode = await impostorCode;
  await grantWebgpuPagesCache(rt, gpuDevice);
  await grantFrameTargets(rt, gpuDevice);
  ensureUniform(rt, gpuDevice, cap);
  // A refused deformation import is a geometry failure, told below: no compute without its code.
  const deformationCode = vis.deformationCode;
  vis.deformationCompute =
    deformationCode && (allPages.some((page) => page.deformationOutput) || !!vis.wholeDeformation)
      ? await deformationCode.createDeformationCompute(gpuDevice)
      : undefined;
  try {
    if (geometryFailure) throw geometryFailure.error;
    await step('textures', () => prepareWebgpuTextures(rt, gpuDevice));
    await step('blend resources', () => prepareBlendResources(rt, gpuDevice));
    await step('visibility programs', () => prepareWebgpuVisibility(rt, gpuDevice));
  } catch (error) {
    throwIfStopped(rt); // A close or a loss is no material failure.
    // The untextured fallback reads rest positions, so a deformed scene must select another backend.
    if (vis.deformation?.any) throw error;
    diag.diagnosticFailure('material-pipeline-failed', error);
    dropVis(rt);
  }
  if (blendState.blendGpu.length && !vis.blendPipelines) {
    if (vis.deformation?.any) throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE');
    dropVis(rt);
  }
  if (context.gpuCanvas && !vis.visEnabled) throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE');
  if (context.gpuCanvas && blendState.blendGpu.length && !vis.blendPipelines)
    throw new Error('WEBGPU_FORWARD_MATERIAL_UNAVAILABLE');
  await step('direct lights', () => prepareDirectLights(rt, gpuDevice));
  await step('shadow pipelines', () => prepareShadowPipelines(rt, gpuDevice));
  prepareCones(rt);
  // One thread per cluster, each with its own error band; a device that cannot hold it is said.
  // The GPU cut packs a node per placement and claims a row per resident instance: a scene whose
  // instances pass the rows a view holds is cut on the CPU, which claims a row per cluster it
  // selects, so neither its DAG nor its rows grow with the placements (#1232).
  if (vis.gpuDraw && selectionRoots.length && cutsOnCpu(packedPages.length))
    fallbackToCpuCut(rt, 'view rows', { instances: packedPages.length, viewRows: VIEW_ROWS });
  else if (vis.gpuDraw && selectionRoots.length) {
    run.gpuSelection = await step('GPU cut', () =>
      createGpuDagSelection(gpuDevice, packDagSelection(selectionRoots), {
        residentCut: true,
        diagnosticGpuVariant: rt.context.diagnosticGpuVariant,
        onRefused: (reason, details) => fallbackToCpuCut(rt, reason, details),
      }),
    );
    // ABSOLUTE world matrices on the GPU, no render origin yet: the first image brings them back.
    run.worldUploadOrigin.fill(NaN);
  }
  capabilities.gpuDriven = !!run.gpuSelection;
  await step('coverage bootstrap', () => services.bootstrapState.ensure());
  // Last, the lit program of the first step; one that failed is said, and lets the unlit view by.
  await gpu.deferred?.litReady;
  diag.engineDiagnostic('render-capabilities', 'Render paths ready', {
    surfaceVersion: gpu.surfaces?.version ?? null,
    deferredLighting: !!gpu.deferred,
    directLightTiles: !!rt.lights.tiles,
    shadowAtlas: !!rt.lights.shadows,
    shadowUnavailable: rt.lights.shadowReason,
    bounceProxy: !!context.readSceneProxy,
    bounceWanted: rt.bounce.wanted,
    imageReadbackDuringRender: false,
    visibilityBuffer: vis.visEnabled,
    gpuSelection: !!run.gpuSelection,
    indirectDraw: !!vis.gpuDraw,
    hiz: !!vis.gpuHiz,
    temporalAntialiasing: !!gpu.temporal,
    // No vector target is rasterised: the temporal pass derives them from the visibility buffer and
    // the placement's previous pose.
    motionVectors: gpu.temporal ? 'derived' : false,
    unsupported: [...capabilities.unsupported],
  });
}
