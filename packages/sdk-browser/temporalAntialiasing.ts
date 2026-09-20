import { createCheckedShaderModule } from './gpuShaderModule.ts';
import { makeFullscreenPipeline } from './deferredLightingProgram.ts';
import { TAA_BINDINGS, TAA_PASS, TAA_SHADER, TAA_VIEW_BYTES } from './taaShaderWgsl.ts';
import { createTaaCheckpoint, createTaaFrameState } from './taaFrame.ts';
import { createPlacementMotion, type MotionRoot } from './taaMotion.ts';
import { readOnly } from './webgpuBindLayout.ts';

/** Bytes per pixel of the two history targets: two `rgba16float`. */
export const TAA_HISTORY_BYTES_PER_PIXEL = 16;

/** What the pass reads in the frame: the lit and blended image, depth, visibility-buffer
 *  identifiers, the page-record table and placement motion matrices. */
export interface TaaInputs {
  current: GPUTextureView;
  depth: GPUTextureView;
  ids: GPUTextureView;
  pages: GPUBuffer;
  motion: GPUBuffer;
}

function createTaaLayout(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT;
  return device.createBindGroupLayout({
    entries: [
      {
        binding: TAA_BINDINGS.current,
        visibility: fragment,
        texture: { sampleType: 'unfilterable-float' },
      },
      { binding: TAA_BINDINGS.history, visibility: fragment, texture: { sampleType: 'float' } },
      {
        binding: TAA_BINDINGS.historySampler,
        visibility: fragment,
        sampler: { type: 'filtering' },
      },
      { binding: TAA_BINDINGS.depth, visibility: fragment, texture: { sampleType: 'depth' } },
      { binding: TAA_BINDINGS.ids, visibility: fragment, texture: { sampleType: 'uint' } },
      { binding: TAA_BINDINGS.pages, visibility: fragment, buffer: readOnly },
      { binding: TAA_BINDINGS.motion, visibility: fragment, buffer: readOnly },
      { binding: TAA_BINDINGS.view, visibility: fragment, buffer: { type: 'uniform' } },
    ],
  });
}

/**
 * Temporal antialiasing pass: two history targets in ping-pong, one read and the other
 * written each frame, and composition reads the one just written. Targets follow the
 * image size (`resize`); bind groups are rebuilt when an input changes identity, never per frame.
 */
export async function createTemporalAntialiasing(device: GPUDevice, roots: readonly MotionRoot[]) {
  const layout = createTaaLayout(device);
  const module = await createCheckedShaderModule(device, TAA_SHADER, 'TAA_RESOLVE');
  const pipeline = await makeFullscreenPipeline(device, module, layout, 'resolve', ['rgba16float']);
  const motion = createPlacementMotion(device, roots);
  const uniform = device.createBuffer({
    label: 'WG TAA view v1',
    size: TAA_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({
    label: 'WG TAA history sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const textures: GPUTexture[] = [],
    views: GPUTextureView[] = [],
    groups: (GPUBindGroup | undefined)[] = [undefined, undefined];
  let width = 0,
    height = 0,
    /** Target read on the next frame: the other is written. */
    read = 0,
    bound: TaaInputs | undefined;
  /** Where the last ordinary frame started: what a convergence frame replays. */
  const saved = createTaaCheckpoint();
  const dropTargets = () => {
    for (const texture of textures) texture.destroy();
    textures.length = 0;
    views.length = 0;
    groups[0] = groups[1] = undefined;
  };
  return {
    uniform,
    motion,
    /** Bytes of the two targets as allocated: what a capture must count beside its own. */
    get historyBytes() {
      return textures.length ? width * height * TAA_HISTORY_BYTES_PER_PIXEL : 0;
    },
    /** Draft of the frame inputs, filled by `encodeTaaPass`: nothing is allocated per frame. */
    inputs: {} as TaaInputs,
    /** What the pass keeps from frame to frame on the CPU: jitter, history, hold. */
    frame: createTaaFrameState(),
    /** An ordinary frame's entry remembers where it started; a convergence frame — the
     *  barrier that re-renders the same pose to show arrived tiles — COMES BACK to it: same jitter,
     *  same still-frame count, same history read. It remakes the image without accumulating
     *  more: two barriers at different frame counts yield the same image, to the bit. */
    checkpoint(quiet: boolean) {
      const { frame } = this;
      saved.read = read;
      saved.sample = frame.sample;
      saved.stillFrames = frame.stillFrames;
      saved.hasHistory = frame.hasHistory;
      saved.sceneSeen = frame.sceneSeen;
      saved.quiet = quiet;
      saved.sampledRank = frame.sampledRank;
      saved.previousViewProjection.set(frame.previousViewProjection);
    },
    /** Returns the stillness of the replayed frame: its own, not the one arrived tiles disturbed. */
    replay() {
      const { frame } = this;
      read = saved.read;
      frame.sample = saved.sample;
      frame.stillFrames = saved.stillFrames;
      frame.hasHistory = saved.hasHistory;
      frame.sceneSeen = saved.sceneSeen;
      frame.sampledRank = saved.sampledRank;
      frame.previousViewProjection.set(saved.previousViewProjection);
      return saved.quiet;
    },
    /** True when the targets have the requested size; otherwise they are remade and history
     *  no longer exists. Returns true when something was reallocated. */
    resize(w: number, h: number) {
      if (w === width && h === height && textures.length === 2) return false;
      dropTargets();
      width = w;
      height = h;
      for (let i = 0; i < 2; i++) {
        const texture = device.createTexture({
          label: `WG TAA history ${i}`,
          size: { width: w, height: h },
          format: 'rgba16float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        textures.push(texture);
        views.push(texture.createView());
      }
      bound = undefined;
      return true;
    },
    /**
     * Encode the pass: reads `inputs.current` and history, writes the other target, then swaps
     * roles. The uniform must have been written first. Returns the written view.
     */
    encode(encoder: GPUCommandEncoder, inputs: TaaInputs) {
      if (textures.length !== 2) throw new Error('TAA_TARGETS_MISSING');
      if (
        !bound ||
        bound.current !== inputs.current ||
        bound.depth !== inputs.depth ||
        bound.ids !== inputs.ids ||
        bound.pages !== inputs.pages ||
        bound.motion !== inputs.motion
      ) {
        bound = { ...inputs };
        for (let i = 0; i < 2; i++)
          groups[i] = device.createBindGroup({
            layout,
            entries: [
              { binding: TAA_BINDINGS.current, resource: inputs.current },
              { binding: TAA_BINDINGS.history, resource: views[i] },
              { binding: TAA_BINDINGS.historySampler, resource: sampler },
              { binding: TAA_BINDINGS.depth, resource: inputs.depth },
              { binding: TAA_BINDINGS.ids, resource: inputs.ids },
              { binding: TAA_BINDINGS.pages, resource: { buffer: inputs.pages } },
              { binding: TAA_BINDINGS.motion, resource: { buffer: inputs.motion } },
              { binding: TAA_BINDINGS.view, resource: { buffer: uniform } },
            ],
          });
      }
      const write = 1 - read;
      const pass = encoder.beginRenderPass({
        label: TAA_PASS,
        colorAttachments: [
          { view: views[write], loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, groups[read]!);
      pass.draw(3);
      pass.end();
      read = write;
      return views[write];
    },
    dispose() {
      dropTargets();
      motion.dispose();
      uniform.destroy();
      bound = undefined;
      this.inputs = {} as TaaInputs;
    },
  };
}

export type TemporalAntialiasing = Awaited<ReturnType<typeof createTemporalAntialiasing>>;
