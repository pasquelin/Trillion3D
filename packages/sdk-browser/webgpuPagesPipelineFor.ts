import * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { projectedPageError } from './pageSelection.ts';
import { BIN_BACK, BIN_FRONT, BIN_NONE } from './gpuDraw.ts';
import { screenErrorColor } from './diagnosticColors.ts';
import { UNIFORM_STRIDE } from './webgpuBlendUniforms.ts';
import { PAGES_GREEN, clusterRgb, linearColor, materialSide } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const windingCw = (rec: PageRec) => {
  const e = rec.matrix.elements;
  return (
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
      e[1] * (e[4] * e[10] - e[6] * e[8]) +
      e[2] * (e[4] * e[9] - e[5] * e[8]) <
    0
  );
};

export function pipelineFor(rt: WebgpuPagesRuntime, rec: PageRec) {
  const side = materialSide(rec.material);
  if (side === THREE.DoubleSide) return rt.gpu.pipelineNone;
  return windingCw(rec) ? rt.gpu.pipelineBackCw : rt.gpu.pipelineBack;
}

export function visPipelineFor(rt: WebgpuPagesRuntime, rec: PageRec, rest: boolean) {
  const { vis } = rt;
  const side = materialSide(rec.material),
    cw = windingCw(rec);
  if (side === THREE.DoubleSide) return rest ? vis.visHizRestNone : vis.visPipelineNone;
  if (side === THREE.BackSide)
    return rest
      ? cw
        ? vis.visHizRestFrontCw
        : vis.visHizRestFront
      : cw
        ? vis.visPipelineFrontCw
        : vis.visPipelineFront;
  return rest
    ? cw
      ? vis.visHizRestBackCw
      : vis.visHizRestBack
    : cw
      ? vis.visPipelineBackCw
      : vis.visPipelineBack;
}

export const visBin = (rec: PageRec): 0 | 1 | 2 => {
  const side = materialSide(rec.material);
  if (side === THREE.DoubleSide) return BIN_NONE;
  // Indirect pipelines share ccw front faces; a reflection swaps which side
  // must be culled instead of requiring three more draw slots.
  return (side === THREE.BackSide) !== windingCw(rec) ? BIN_FRONT : BIN_BACK;
};

export function bindGroupFor(rt: WebgpuPagesRuntime, device: GPUDevice, position: GPUBuffer) {
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

export function ensureUniform(rt: WebgpuPagesRuntime, device: GPUDevice, draws: number) {
  const { gpu } = rt;
  const bytes = Math.max(1, draws, rt.setup.cap) * UNIFORM_STRIDE;
  if (!gpu.uniformBuffer || gpu.uniformBuffer.size < bytes) {
    gpu.uniformBuffer?.destroy();
    gpu.bindGroups.clear();
    for (const item of rt.blendState.blendGpu) item.group = undefined;
    gpu.uniformBuffer = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }
  if (gpu.uniformPacked.byteLength < bytes) gpu.uniformPacked = new Float32Array(bytes / 4);
}

export function pageRgb(rt: WebgpuPagesRuntime, rec: PageRec): [number, number, number] {
  const { run } = rt;
  if (run.diagnostic === 'beauty') return linearColor(rec.material);
  if (run.diagnostic === 'pages') return PAGES_GREEN;
  if (run.diagnostic === 'lod')
    return rec.role === 'coarse' ? [0.95, 0.42, 0.05] : [0.04, 0.51, 0.94];
  if (run.diagnostic === 'visibility') return PAGES_GREEN;
  if (run.diagnostic === 'screen-error')
    return run.lastCamera
      ? screenErrorColor(
          projectedPageError(rec, run.lastCamera, rt.setup.viewport),
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
