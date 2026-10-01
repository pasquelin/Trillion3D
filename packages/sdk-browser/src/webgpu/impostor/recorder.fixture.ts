// The card passes' render passes, recorded: each one's label, pipeline, groups and draws (#1335).

/** An encoder that records the render passes and what each one draws. */
export function recordingEncoder() {
  const passes: Array<{
    label?: string;
    pipeline?: unknown;
    groups: unknown[];
    draws: number[][];
  }> = [];
  const open = (label?: string) => {
    const pass = { label, groups: [] as unknown[], draws: [] as number[][] };
    passes.push(pass as (typeof passes)[number]);
    return {
      setViewport() {},
      setPipeline: (pipeline: unknown) => void Object.assign(pass, { pipeline }),
      setBindGroup: (index: number, group: unknown) => void (pass.groups[index] = group),
      draw: (...args: number[]) => void pass.draws.push(args),
      end() {},
    } as unknown as GPURenderPassEncoder;
  };
  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => open(descriptor.label),
  } as unknown as GPUCommandEncoder;
  return { encoder, open, passes };
}
