import type { HostAttributes } from '../../../host/resources.ts';
import { createDeferredLighting } from '../../../lighting/deferred/deferred.ts';
import { prepareTemporalAntialiasing } from '../../../taa/prepare.ts';
import { createSceneLightContractBuffer } from '../state/lights.ts';
import { prepareWebgpuPresentation } from '../../frame/presentationSetup.ts';
import { createWebgpuPagesPipelines } from './pipelines.ts';
import { ensureWebgpuPositionBuffer } from '../../core/positions.ts';
import { prepareWebgpuBlend } from '../../blend/prepare.ts';
import { createTransparentTable } from '../../transparent/table.ts';
import { prepareBlendResources } from '../../blend/resources.ts';
import { createTransparentCompaction } from '../../transparent/compact.ts';
import { UNIFORM_STRIDE } from '../../blend/uniforms.ts';
import { VOLUME_WORDS, createVolumeBuffer } from '../../transparent/transmission.ts';
import { createGpuDagSelection, packDagSelection } from '../../../gpu/dag/selection.ts';
import { OPEN_CONE, triangleCone } from '../../../page/cone/cone.ts';
import { surfaceFrontOnly } from '../../../page/surface.ts';
import { ensureTargets } from './targets.ts';
import { ensureUniform } from './pipelineFor.ts';
import { dropVis, grantCapability } from '../io/drops.ts';
import { prepareWebgpuTextures } from './textures.ts';
import { prepareWebgpuVisibility } from './visibility.ts';
import { prepareDirectLights } from './lights.ts';
import { createWebgpuPagesCache } from './cache.ts';
import { type WebgpuPagesRuntime } from '../runtime.ts';

/** Every cluster carries its own cone; a double-sided or back-facing material keeps it open.
 *  Posting a cone is declaring it: the page's root raises its flag, or the cut would believe it has
 *  no cone and would no longer read `cone`. Pages are walked by root: the `allPages` catalogue is the
 *  concatenation of their pages, in the same order. */
export function prepareCones(rt: WebgpuPagesRuntime) {
  const xyzCache = new WeakMap<HostAttributes, Float32Array>();
  for (const root of rt.setup.roots)
    for (const rec of root.pages) {
      const array = rec.array,
        attr = rec.attributes.position;
      if (!array || !attr) continue;
      root.cones = true;
      let xyz = xyzCache.get(rec.attributes);
      if (!xyz) {
        xyz = new Float32Array(attr.count * 3);
        // A plain three-component attribute is already that array, copied as a block; any other —
        // interleaved, normalized, another stride — goes through the accessors that can read it.
        const flat = attr.array as ArrayLike<number> & {
          subarray?(begin: number, end: number): ArrayLike<number>;
          isInterleavedBufferAttribute?: boolean;
        };
        if (
          attr.itemSize === 3 &&
          !attr.normalized &&
          !(attr as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute &&
          flat.subarray &&
          flat.length >= attr.count * 3
        )
          xyz.set(flat.subarray(0, attr.count * 3));
        else
          for (let i = 0; i < attr.count; i++) {
            xyz[i * 3] = attr.getX(i);
            xyz[i * 3 + 1] = attr.getY(i);
            xyz[i * 3 + 2] = attr.getZ(i);
          }
        xyzCache.set(rec.attributes, xyz);
      }
      // Front-only alone gets a closed cone, and the side is read from the declaration at this
      // very moment: a surface the host later opens in place reopens its cone at the cut
      // (`../../../page/surface.ts`, `gpuSelection.leafCone`).
      rec.cone = surfaceFrontOnly(rec.material) ? triangleCone(xyz, array) : OPEN_CONE;
    }
}

/** Builds every GPU resource an image needs; called once, after the device and lighting exist. */
export async function prepareWebgpuPages(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { gpu, vis, run, context, diag, capabilities, blendState, services } = rt,
    { allPages, blendCopies, scene, viewport, cap } = rt.setup,
    { packedPages, selectionRoots, rows } = rt.layout;
  const step = <T>(name: string, work: Promise<T>) => (rt.context.preparationStep?.(name), work);
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
  // The contract program finishes compiling between two images: its arrival is a new resource, or
  // the held image would keep presenting raw albedo. The two programs compile side by side.
  [gpu.deferred] = await step(
    'lighting and antialiasing programs',
    Promise.all([
      createDeferredLighting(gpuDevice, rt.lights.buffer, () => run.gate.resourcesChanged()),
      prepareTemporalAntialiasing(rt, gpuDevice),
    ]),
  );
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
  // Only a cluster no quantized page covers still needs its primitive's float positions: what the
  // fallback draw reads for the others is the page in their pool slot.
  for (const rec of allPages)
    if (!rec.geometryPage)
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
  // The transparent draw order is the scene's, settled here once: an image only picks survivors.
  blendState.table = createTransparentTable(selectionRoots, packedPages, blendState.blendGpu);
  for (let i = 0; i < blendState.table.pagedItems.length; i++)
    blendState.table.pagedItems[i].pagedIndex = i;
  blendState.compaction = await step(
    'transparent compaction',
    createTransparentCompaction(gpuDevice, blendState.table),
  );
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
    await step('textures', prepareWebgpuTextures(rt, gpuDevice));
    // Item rows cite atlas layers: they are therefore mounted AFTER the textures.
    await step('blend resources', prepareBlendResources(rt, gpuDevice));
    await step('visibility programs', prepareWebgpuVisibility(rt, gpuDevice));
  } catch (error) {
    diag.diagnosticFailure('material-pipeline-failed', error);
    dropVis(rt);
  }
  if (blendState.blendGpu.length && !vis.blendPipelines) dropVis(rt);
  if (context.gpuCanvas && !vis.visEnabled) throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE');
  if (context.gpuCanvas && blendState.blendGpu.length && !vis.blendPipelines)
    throw new Error('WEBGPU_FORWARD_MATERIAL_UNAVAILABLE');
  await step('direct lights', prepareDirectLights(rt, gpuDevice));
  prepareCones(rt);
  // Every cluster carries its own error band, so the GPU cut is one thread per cluster.
  if (vis.gpuDraw && selectionRoots.length) {
    run.gpuSelection = await step(
      'GPU cut',
      createGpuDagSelection(gpuDevice, packDagSelection(selectionRoots), {
        residentCut: true,
        diagnosticGpuVariant: rt.context.diagnosticGpuVariant,
      }),
    );
    // The GPU has just received ABSOLUTE world matrices: no render origin is posted there yet, and
    // the first image will bring them back to the eye wherever it is then.
    run.worldUploadOrigin.fill(NaN);
  }
  capabilities.gpuDriven = !!run.gpuSelection;
  await step('coverage bootstrap', services.bootstrapState.ensure());
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
