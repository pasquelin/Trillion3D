import * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { projectedPageError } from './pageSelection.ts';
import { dropPoolBindGroups } from './webgpuPagesDrops.ts';
import { BASE_SLOTS, BIN_BACK, BIN_FRONT, BIN_NONE } from './gpuDraw.ts';
import { visLayerPipelineIndex } from './webgpuVisibilityPipelines.ts';
import { screenErrorColor } from './diagnosticColors.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { PAGES_GREEN, clusterRgb, linearColor } from './webgpuPagesHelpers.ts';
import { materialSide } from './triangleDiagnostic.ts';
import { windingCw } from './webgpuPagesWinding.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';

/** Order of layer-0 indirect slots: the three untested pipelines, then their Hi-Z-tested twins. */
const VIS_SLOTS = [
  'visPipelineBack',
  'visPipelineNone',
  'visPipelineFront',
  'visHizRestBack',
  'visHizRestNone',
  'visHizRestFront',
] as const;

export function pipelineFor(rt: WebgpuPagesCore, rec: PageRec) {
  const side = materialSide(rec.material);
  if (side === THREE.DoubleSide) return rt.gpu.pipelineNone;
  return windingCw(rec) ? rt.gpu.pipelineBackCw : rt.gpu.pipelineBack;
}

/** Rank of a cluster's face mode in a layer set: back, none, front, inverted back, inverted front.
 *  The same order `LAYER_CULLS` builds. */
const visCullSlot = (rec: PageRec) => {
  const side = materialSide(rec.material);
  if (side === THREE.DoubleSide) return 1;
  if (side === THREE.BackSide) return windingCw(rec) ? 4 : 2;
  return windingCw(rec) ? 3 : 0;
};

/** Pipeline of an indirect slot: layer 0 keeps its own, each later layer has the same states plus
 *  its depth bias. A slot's face rank is its `bin`. */
export function visSlotPipeline(rt: WebgpuPagesCore, slot: number) {
  const { vis } = rt;
  const layer = Math.floor(slot / BASE_SLOTS),
    within = slot % BASE_SLOTS;
  if (layer === 0) return vis[VIS_SLOTS[within]];
  return vis.visLayerPipelines[visLayerPipelineIndex(layer, within >= 3, within % 3)];
}

/** Pipeline of a cluster drawn WITHOUT indirect compaction. That path does not know the tested
 *  half: without compaction there is no partition, and the image fits in one pass. */
export function visPipelineFor(rt: WebgpuPagesCore, rec: PageRec) {
  const { vis } = rt;
  const layer = Math.min(rec.depthLayer, vis.drawLayerSlots - 1);
  if (layer > 0)
    return vis.visLayerPipelines[visLayerPipelineIndex(layer, false, visCullSlot(rec))];
  const side = materialSide(rec.material),
    cw = windingCw(rec);
  if (side === THREE.DoubleSide) return vis.visPipelineNone;
  if (side === THREE.BackSide) return cw ? vis.visPipelineFrontCw : vis.visPipelineFront;
  return cw ? vis.visPipelineBackCw : vis.visPipelineBack;
}

export const visBin = (rec: PageRec): 0 | 1 | 2 => {
  const side = materialSide(rec.material);
  if (side === THREE.DoubleSide) return BIN_NONE;
  // Indirect pipelines share ccw front faces; a reflection swaps which side
  // must be culled instead of requiring three more draw slots.
  return (side === THREE.BackSide) !== windingCw(rec) ? BIN_FRONT : BIN_BACK;
};

export function bindGroupFor(rt: WebgpuPagesCore, device: GPUDevice, position: GPUBuffer) {
  const { gpu } = rt;
  let id = gpu.positionIds.get(position);
  if (!id) {
    id = gpu.nextPositionId++;
    gpu.positionIds.set(position, id);
  }
  let group = gpu.bindGroups.get(id);
  if (!group && gpu.bindGroupLayout && gpu.cache && gpu.uniformBuffer) {
    group = device.createBindGroup({
      layout: gpu.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: gpu.cache.buffer } },
        { binding: 1, resource: { buffer: position } },
        { binding: 2, resource: { buffer: gpu.uniformBuffer, size: UNIFORM_STRIDE } },
      ],
    });
    gpu.bindGroups.set(id, group);
  }
  return group;
}

export function ensureUniform(rt: WebgpuPagesCore, device: GPUDevice, draws: number) {
  const { gpu } = rt;
  const bytes = Math.max(1, draws, rt.setup.cap) * UNIFORM_STRIDE;
  if (!gpu.uniformBuffer || gpu.uniformBuffer.size < bytes) {
    gpu.uniformBuffer?.destroy();
    dropPoolBindGroups(rt);
    gpu.uniformBuffer = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }
  if (gpu.uniformPacked.byteLength < bytes) gpu.uniformPacked = new Float32Array(bytes / 4);
}

export function pageRgb(rt: WebgpuPagesCore, rec: PageRec): [number, number, number] {
  const { run } = rt;
  if (run.diagnostic === 'beauty') return linearColor(rec.material);
  if (run.diagnostic === 'pages') return PAGES_GREEN;
  if (run.diagnostic === 'lod')
    return rec.role === 'coarse' ? [0.95, 0.42, 0.05] : [0.04, 0.51, 0.94];
  if (run.diagnostic === 'visibility') return PAGES_GREEN;
  if (run.diagnostic === 'screen-error')
    return run.lastCamera
      ? screenErrorColor(
          projectedPageError(rec, run.gate.cam, rt.setup.viewport),
          run.diagnosticPixelError,
        )
      : [0, 1, 0.12];
  let rgb = rt.gpu.clusterRgbCache.get(rec.clusterId);
  if (!rgb) {
    rgb = clusterRgb(rec.clusterId);
    rt.gpu.clusterRgbCache.set(rec.clusterId, rgb);
  }
  return rgb;
}
