import {
  SELECTION_WORKGROUP as WORKGROUP,
  copySelectionUniforms,
  sameSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type SelectionUniforms,
} from './gpuSelection.ts';
import { writeDagUniforms, parseDagOutput } from './gpuDagUniforms.ts';
import type { createDagResources } from './gpuDagResources.ts';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;
export type DagRuntimeState = {
  last: GpuCut | null;
  lastSubmitted?: SelectionUniforms;
  lastReadback?: SelectionUniforms;
  pending: Promise<unknown>;
  disposed: boolean;
  dead: boolean;
  worldRevision: number;
  residencyRevision: number;
  submittedResidencyRevision: number;
  readbackResidencyRevision: number;
  mapped: boolean[];
  slot: number;
};

export function createDagDispatch(
  resources: DagResources,
  state: DagRuntimeState,
  fail: () => void,
): GpuSelection['dispatch'] {
  const {
    device,
    packed,
    residentCut,
    pageCount,
    nodeCount,
    worldCount,
    outputBytes,
    uniformData,
    flags,
    uniforms,
    output,
    readback,
    bindGroup,
    resetPipeline,
    planePipeline,
    nodePipeline,
    wantedPipeline,
    escalatePipeline,
    checkPipeline,
    maskPipeline,
  } = resources;
  const groups = (count: number) => Math.max(1, Math.ceil(count / WORKGROUP));
  const dispatch: GpuSelection['dispatch'] = (next, shared) => {
    if (state.disposed || state.dead) return;
    const compute =
      !state.lastSubmitted ||
      !sameSelectionUniforms(state.lastSubmitted, next) ||
      state.submittedResidencyRevision !== state.residencyRevision;
    const needsReadback =
      !state.lastReadback ||
      !sameSelectionUniforms(state.lastReadback, next) ||
      state.readbackResidencyRevision !== state.residencyRevision;
    const i = !state.mapped[state.slot]
      ? state.slot
      : !state.mapped[state.slot ^ 1]
        ? state.slot ^ 1
        : -1;
    const copy = needsReadback && i >= 0;
    if ((!compute && !copy) || (!residentCut && i < 0)) return;
    const encoder = shared ?? device.createCommandEncoder();
    // What this call is about to claim, so an abandoned command buffer can give it all back: a copy
    // that never runs would leave its readback slot mapped forever and freeze the cut on its last
    // result, and a compute pass that never runs must not be remembered as submitted.
    const undoSubmitted = state.lastSubmitted,
      undoSubmittedRevision = state.submittedResidencyRevision;
    const undoReadback = state.lastReadback,
      undoReadbackRevision = state.readbackResidencyRevision,
      undoSlot = state.slot;
    if (compute) {
      writeDagUniforms(uniformData, packed, next, residentCut);
      device.queue.writeBuffer(uniforms, 0, uniformData);
      const pass = encoder.beginComputePass({ label: 'WG DAG selection' });
      pass.setBindGroup(0, bindGroup);
      const run = (pipeline: GPUComputePipeline, count: number) => {
        pass.setPipeline(pipeline);
        pass.dispatchWorkgroups(groups(count));
      };
      run(resetPipeline, worldCount);
      run(planePipeline, worldCount);
      run(nodePipeline, Math.max(1, nodeCount));
      run(wantedPipeline, pageCount);
      if (residentCut) {
        for (let round = 0; round < ESCALATION_ROUNDS; round++) run(escalatePipeline, pageCount);
        run(checkPipeline, pageCount);
      }
      run(maskPipeline, pageCount);
      pass.end();
      state.lastSubmitted = copySelectionUniforms(next);
      state.submittedResidencyRevision = state.residencyRevision;
    }
    if (copy) {
      encoder.copyBufferToBuffer(output, 0, readback[i], 0, outputBytes);
      if (residentCut)
        encoder.copyBufferToBuffer(flags, nodeCount * 4, readback[i], outputBytes, pageCount * 4);
    }
    const captured = copy ? copySelectionUniforms(next) : undefined;
    const capturedWorldRevision = state.worldRevision,
      capturedResidencyRevision = state.residencyRevision;
    if (captured) {
      state.lastReadback = captured;
      state.readbackResidencyRevision = state.residencyRevision;
      state.mapped[i] = true;
      state.slot = i ^ 1;
    }
    const read = () => {
      if (!captured) return;
      state.pending = state.pending
        .catch(() => {})
        .then(async () => {
          try {
            await readback[i].mapAsync(GPUMapMode.READ);
            const bytes = readback[i].getMappedRange();
            const parsed = parseDagOutput(bytes, 0, bytes.byteLength, residentCut ? pageCount : 0);
            readback[i].unmap();
            state.mapped[i] = false;
            if (!parsed) {
              fail();
              return;
            }
            if (
              capturedWorldRevision === state.worldRevision &&
              capturedResidencyRevision === state.residencyRevision
            )
              state.last = { uniforms: captured, result: parsed };
          } catch {
            try {
              readback[i].unmap();
            } catch {
              /* Mapping may already be closed. */
            }
            state.mapped[i] = false;
            fail();
          }
        });
    };
    if (shared) {
      let settled = false;
      return (submitted: boolean) => {
        if (settled) return;
        settled = true;
        if (submitted) {
          read();
          return;
        }
        state.lastSubmitted = undoSubmitted;
        state.submittedResidencyRevision = undoSubmittedRevision;
        state.lastReadback = undoReadback;
        state.readbackResidencyRevision = undoReadbackRevision;
        if (captured) {
          state.mapped[i] = false;
          state.slot = undoSlot;
        }
      };
    }
    device.queue.submit([encoder.finish()]);
    read();
    return undefined;
  };
  return dispatch;
}
