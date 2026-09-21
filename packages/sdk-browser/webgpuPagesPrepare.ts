import * as THREE from 'three';
import { createDeferredLighting } from './deferredLighting.ts';
import { prepareTemporalAntialiasing } from './taaPrepare.ts';
import { createSceneLightContractBuffer } from './webgpuPagesStateLights.ts';
import { prepareWebgpuPresentation } from './webgpuPresentationSetup.ts';
import { createWebgpuPagesPipelines } from './webgpuPagesPipelines.ts';
import { ensureWebgpuPositionBuffer } from './webgpuPositions.ts';
import { prepareWebgpuBlend } from './webgpuBlendPrepare.ts';
import { createTransparentTable } from './webgpuTransparentTable.ts';
import { prepareBlendResources } from './webgpuBlendResources.ts';
import { createTransparentCompaction } from './webgpuTransparentCompact.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { VOLUME_WORDS, createVolumeBuffer } from './webgpuTransmission.ts';
import { createGpuDagSelection, packDagSelection } from './gpuDagSelection.ts';
import { OPEN_CONE, triangleCone } from './pageCone.ts';
import { visMaterial } from './visibilityBuffer.ts';
import { ensureTargets } from './webgpuPagesTargets.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { dropVis, grantCapability } from './webgpuPagesDrops.ts';
import { prepareWebgpuTextures } from './webgpuPagesPrepareTextures.ts';
import { prepareWebgpuVisibility } from './webgpuPagesPrepareVisibility.ts';
import { prepareDirectLights } from './webgpuPagesPrepareLights.ts';
import { createWebgpuPagesCache } from './webgpuPagesPrepareCache.ts';
import { type WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Every cluster carries its own cone; a double-sided or back-facing material keeps it open.
 *  Posting a cone is declaring it: the page's root raises its flag, or the cut would believe it has
 *  no cone and would no longer read `cone`. Pages are walked by root: the `allPages` catalogue is the
 *  concatenation of their pages, in the same order. */
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
        // A simple unnormalized three-component attribute is already that array: `getX/getY/getZ` then
        // yield `array[i * 3 + c]`, and the block copy writes the same values, rounded to the same 32-bit
        // float. Any other attribute — interleaved, normalized, another stride — goes back through the
        // accessors, the only ones able to say what it holds.
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

/** Builds every GPU resource an image needs; called once, after the device and lighting exist. */
export async function prepareWebgpuPages(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { gpu, vis, run, context, diag, capabilities, blendState, services } = rt,
    { allPages, blendCopies, scene, viewport, cap } = rt.setup,
    { packedPages, selectionRoots, rows } = rt.layout;
  rt.lights.buffer = createSceneLightContractBuffer(gpuDevice);
  // No more light written into the scene, on either side: opaques and transparents read the same
  // declared-light buffer, with the same shadows and the same exposure (P6).
  diag.engineDiagnostic('scene-lighting', 'Scene lights active', {
    version: 1,
    contractLights: rt.lights.store.count,
    sceneGraphLights: false,
    implicitAmbient: false,
    shadows: false,
    globalIllumination: false,
  });
  // The contract program finishes compiling between two images: its arrival is a new resource, and
  // without this counter the held image would keep presenting raw albedo.
  // The two programs compile side by side: they share only the device.
  [gpu.deferred] = await Promise.all([
    createDeferredLighting(gpuDevice, rt.lights.buffer, () => run.gate.resourcesChanged()),
    prepareTemporalAntialiasing(rt, gpuDevice),
  ]);
  context.signal?.throwIfAborted();
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
  gpu.cache = createWebgpuPagesCache(rt, gpuDevice);
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
  // Fresh position buffers: rank sync starts over from the catalogue.
  rows.rowsRevision++;
  gpu.zeroUv = gpuDevice.createBuffer({
    size: 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  gpuDevice.queue.writeBuffer(gpu.zeroUv, 0, new Float32Array([0, 0]));
  blendState.transmissive = prepareWebgpuBlend(gpuDevice, blendCopies, gpu, blendState, scene);
  blendState.volumePacked = new Float32Array(blendState.transmissive * VOLUME_WORDS);
  gpu.volumeBuffer = createVolumeBuffer(gpuDevice, blendState.transmissive);
  // The transparent draw order is the scene's and is settled here, once: an image only chooses which
  // of its entries survive.
  blendState.table = createTransparentTable(selectionRoots, packedPages, blendState.blendGpu);
  for (let i = 0; i < blendState.table.pagedItems.length; i++)
    blendState.table.pagedItems[i].pagedIndex = i;
  blendState.compaction = await createTransparentCompaction(gpuDevice, blendState.table);
  diag.engineDiagnostic('transparent-clusters', 'Transparent cluster table', {
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
    // Item rows cite atlas layers: they are therefore mounted AFTER the textures.
    await prepareBlendResources(rt, gpuDevice);
    await prepareWebgpuVisibility(rt, gpuDevice);
  } catch (error) {
    diag.diagnosticFailure('material-pipeline-failed', error);
    dropVis(rt);
  }
  if (blendState.blendGpu.length && !vis.blendPipelines) dropVis(rt);
  if (context.gpuCanvas && !vis.visEnabled) throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE');
  if (context.gpuCanvas && blendState.blendGpu.length && !vis.blendPipelines)
    throw new Error('WEBGPU_FORWARD_MATERIAL_UNAVAILABLE');
  await prepareDirectLights(rt, gpuDevice);
  prepareCones(rt);
  // Every cluster carries its own error band, so the GPU cut is one thread per cluster.
  if (vis.gpuDraw && selectionRoots.length) {
    run.gpuSelection = await createGpuDagSelection(gpuDevice, packDagSelection(selectionRoots), {
      residentCut: true,
      diagnosticGpuVariant: rt.context.diagnosticGpuVariant,
    });
    // The GPU has just received ABSOLUTE world matrices: no render origin is posted there yet, and
    // the first image will bring them back to the eye wherever it is then.
    run.worldUploadOrigin.fill(NaN);
  }
  capabilities.gpuDriven = !!run.gpuSelection;
  await services.bootstrapState.ensure();
  diag.engineDiagnostic('render-capabilities', 'Render paths ready', {
    surfaceVersion: gpu.surfaces?.version ?? null,
    deferredLighting: !!gpu.deferred,
    directLightTiles: !!rt.lights.tiles,
    shadowAtlas: rt.lights.shadows ? rt.lights.shadows.size : null,
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
