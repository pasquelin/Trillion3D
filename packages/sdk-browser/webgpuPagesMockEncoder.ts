import type { PackedDag } from './gpuDagSelection.ts';
import { simulateComputeDispatch, type ComputeBind } from './webgpuPagesMockCompute.ts';

export type MockDraw = {
  vertexCount: number;
  instanceCount?: number;
  firstInstance?: number;
  bindOffset?: number;
  instanceBuffer?: unknown;
  slotOffsetsBuffer?: unknown;
  indirect?: boolean;
  entryPoint?: string;
};
export type MockPass = {
  label?: string;
  colorLoad?: string;
  colorClear?: GPUColor;
  depthLoad?: string;
  colorCount: number;
  formats: string[];
};

export function createMockCommandEncoderFactory(inputs: {
  draws: MockDraw[];
  passes: MockPass[];
  computes: string[];
  imageCopies: unknown[];
  packed?: PackedDag;
  failVisPass: boolean;
}) {
  const { draws, passes, computes, imageCopies, packed, failVisPass } = inputs;
  let currentRenderEntry = '';
  let currentBind: unknown,
    computeBind: ComputeBind | undefined,
    computeOffsets: readonly number[] | undefined,
    computePipeline: { entryPoint: string } | undefined,
    visPassFails = failVisPass;
  return () => ({
    beginRenderPass: (desc?: {
      label?: string;
      colorAttachments?: Array<{
        loadOp?: string;
        clearValue?: GPUColor;
        view?: { format?: string };
      }>;
      depthStencilAttachment?: { depthLoadOp?: string };
    }) => {
      if (visPassFails && desc?.label === 'WG visibility primary') {
        visPassFails = false;
        throw new Error('VIS_FAIL');
      }
      const colors = desc?.colorAttachments ?? [];
      passes.push({
        label: desc?.label,
        colorLoad: colors[0]?.loadOp,
        colorClear: colors[0]?.clearValue,
        depthLoad: desc?.depthStencilAttachment?.depthLoadOp,
        colorCount: colors.length,
        formats: colors.map((color) => color.view?.format ?? ''),
      });
      return {
        setPipeline(pipeline: { entryPoint?: string }) {
          currentRenderEntry = pipeline.entryPoint ?? '';
        },
        setBindGroup(_i: number, group: unknown) {
          currentBind = group;
        },
        setViewport() {},
        draw(vertexCount: number, instanceCount = 1, _firstVertex = 0, firstInstance = 0) {
          draws.push({
            vertexCount,
            instanceCount,
            firstInstance,
            entryPoint: currentRenderEntry,
          });
          void currentBind;
        },
        drawIndirect(buffer: { data?: Uint8Array }, offset: number) {
          const words = new Uint32Array(buffer.data!.buffer, buffer.data!.byteOffset + offset, 4);
          const entries = (
            currentBind as
              { entries?: Array<{ binding: number; resource: { offset?: number } }> } | undefined
          )?.entries;
          const page = entries?.find((entry) => entry.binding === 2);
          const instances = entries?.find((entry) => entry.binding === 8),
            offsets = entries?.find((entry) => entry.binding === 9);
          draws.push({
            vertexCount: words[0],
            instanceCount: words[1],
            firstInstance: words[3],
            bindOffset: page?.resource?.offset ?? 0,
            instanceBuffer: instances?.resource,
            slotOffsetsBuffer: offsets?.resource,
            indirect: true,
            entryPoint: currentRenderEntry,
          });
        },
        end() {},
      };
    },
    beginComputePass: () => ({
      setPipeline(next: { entryPoint: string }) {
        computePipeline = next;
      },
      // Dynamic offsets count: plan expansion reads the uniform region of ITS pass, and two passes
      // follow each other in the same compute pass.
      setBindGroup(_i: number, group: typeof computeBind, offsets?: readonly number[]) {
        computeBind = group;
        computeOffsets = offsets;
      },
      // Kernels that spread over the live-cluster list go through here: the double replays the same
      // kernel whichever path the GPU launches it on.
      dispatchWorkgroupsIndirect(this: { dispatchWorkgroups(): void }) {
        this.dispatchWorkgroups();
      },
      dispatchWorkgroups() {
        simulateComputeDispatch(computePipeline, computeBind, computes, packed, computeOffsets);
      },
      end() {},
    }),
    clearBuffer(buffer: { data?: Uint8Array }, offset = 0, size?: number) {
      buffer.data?.fill(0, offset, size === undefined ? buffer.data.length : offset + size);
    },
    copyBufferToBuffer(
      src: { data?: Uint8Array },
      s: number,
      dst: { data?: Uint8Array },
      d: number,
      size: number,
    ) {
      if (src.data && dst.data) dst.data.set(src.data.subarray(s, s + size), d);
    },
    copyTextureToBuffer(...args: unknown[]) {
      imageCopies.push(args);
    },
    copyTextureToTexture() {},
    finish: () => ({}),
  });
}
