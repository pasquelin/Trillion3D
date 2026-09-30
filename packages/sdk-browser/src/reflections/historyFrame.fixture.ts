import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import {
  REFLECTION_LIGHTING_VERSIONS,
  REFLECTION_PLACEMENT_VERSIONS,
  type ReflectionHistoryFrame,
} from './historyFrame.ts';
import type { ReflectionHistory } from './historyRuntime.ts';

/** A still frame of the reflection history at `frame`, its metadata `current`, with no live
 *  motion: the motion bound is the page table (`reflectionFrame.ts`). */
export function stillHistoryFrame(current: GPUTexture, frame: number): ReflectionHistoryFrame {
  const pages = {} as GPUBuffer;
  return {
    metadata: { depth: current, normal: current, ids: current },
    ids: {} as GPUTextureView,
    pages,
    motion: pages,
    eye: [0, 0, 0],
    epoch: new Float64Array(REFLECTION_PLACEMENT_VERSIONS),
    lighting: new Float64Array(REFLECTION_LIGHTING_VERSIONS),
    seed: 1,
    frame,
    camera: IDENTITY_MATRIX4,
  };
}

/** What a drawn image does to `history` on a fake device: `frame` prepared, its metadata
 *  `current`, then resolved once. */
export function resolveHistory(
  device: GPUDevice,
  history: ReflectionHistory,
  frame: ReflectionHistoryFrame,
  current: GPUTexture,
  drawn: readonly number[],
) {
  const pass = { setViewport() {}, setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
  const encoder = {
    ...device.createCommandEncoder(),
    beginRenderPass: () => pass,
  } as unknown as GPUCommandEncoder;
  history.prepare(frame, IDENTITY_MATRIX4, drawn);
  history.encode(encoder, current.createView(), {} as GPURenderPipeline, {} as GPUBindGroupLayout);
}
