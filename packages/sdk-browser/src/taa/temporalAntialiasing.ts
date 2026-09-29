import { TAA_BINDINGS, TAA_PASS, TAA_VIEW_BYTES } from './shaderWgsl.ts';
import { SHARE_FORMAT, createTaaResolves } from './resolve.ts';
import { createTaaCheckpoint, createTaaFrameState } from './frame.ts';
import { createPlacementMotion, type MotionRoot } from './motion.ts';
import { createTaaFilterHistory, type DisplayLayers } from './layers.ts';
import type { AccumulatedImage } from '../lighting/deferred/program.ts';

/** A history target's attachment: cleared by the pass that writes it. */
const CLEAR = { loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] } as const;
/** Bytes per pixel of the two history targets: two `rgba16float`, and their two shares. */
export const TAA_HISTORY_BYTES_PER_PIXEL = 18;

/** What the pass reads in the frame: the lit and blended image, depth, visibility-buffer
 *  identifiers, the page-record table, placement motion matrices and the surface flags — absent
 *  when no as-is pixel is in the frame, which the flagless resolve reads none of (OMB-11). */
export interface TaaInputs {
  current: GPUTextureView;
  depth: GPUTextureView;
  ids: GPUTextureView;
  pages: GPUBuffer;
  motion: GPUBuffer;
  flags?: GPUTextureView;
  share?: GPUTextureView;
  /** The frame was drawn below the display: the resolve reconstructs it (`upscaleWgsl.ts`). */
  upscale?: boolean;
  /** The display layers of a frame whose blends filter (`../webgpu/blend/displayFilter.ts`). */
  filter?: DisplayLayers;
}
const INPUTS = ['current', 'depth', 'ids', 'pages', 'motion', 'flags', 'share', 'filter'] as const;

/**
 * Temporal antialiasing pass: two history targets in ping-pong, each a colour and its as-is share,
 * one read and the other written each frame, and composition reads the one just written. Targets
 * follow the display size (`resize`); bind groups are rebuilt when an input changes identity, never
 * per frame. With `upscale`, the resolves that reconstruct a frame drawn below the display are
 * compiled too.
 */
export async function createTemporalAntialiasing(
  device: GPUDevice,
  roots: readonly MotionRoot[],
  upscale = false,
) {
  const resolves = await createTaaResolves(device, upscale);
  const motion = createPlacementMotion(device, roots);
  const filterHistory = createTaaFilterHistory(device);
  const uniform = device.createBuffer({
    label: 'Trillion3D TAA view v1',
    size: TAA_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({
    label: 'Trillion3D TAA history sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });
  const textures: GPUTexture[] = [],
    images: AccumulatedImage[] = [],
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
    images.length = 0;
    groups[0] = groups[1] = undefined;
    filterHistory.drop();
  };
  return {
    uniform,
    motion,
    filterHistory,
    /** Bytes of the two targets as allocated: what a capture must count beside its own. */
    get historyBytes() {
      const colour = textures.length ? width * height * TAA_HISTORY_BYTES_PER_PIXEL : 0;
      return colour + filterHistory.bytes;
    },
    /** Draft of the frame inputs, filled by `encodeTaaPass`: nothing is allocated per frame. */
    inputs: {} as TaaInputs,
    /** What the pass keeps from frame to frame on the CPU: jitter, history, hold. */
    frame: createTaaFrameState(),
    /** An ordinary frame's entry remembers where it started; a convergence frame (re-rendering the
     *  pose for arrived tiles) COMES BACK to it, remaking the image to the bit without accumulating. */
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
      filterHistory.checkpoint();
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
      filterHistory.replay();
      return saved.quiet;
    },
    /** Remakes the targets at another size, history gone: true when something was reallocated. */
    resize(w: number, h: number) {
      if (w === width && h === height && images.length === 2) return false;
      dropTargets();
      width = w;
      height = h;
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        size = { width: w, height: h };
      const target = (label: string, format: GPUTextureFormat) => {
        const texture = device.createTexture({ label, size, format, usage });
        textures.push(texture);
        return texture.createView();
      };
      for (let i = 0; i < 2; i++)
        images.push({
          color: target(`Trillion3D TAA history ${i}`, 'rgba16float'),
          share: target(`Trillion3D TAA as-is share ${i}`, SHARE_FORMAT),
        });
      bound = undefined;
      return true;
    },
    /** Encode the pass, its uniform written first: reads `inputs.current` and history, writes the
     *  other target, then swaps roles. Returns the written colour, share and display layers. */
    encode(encoder: GPUCommandEncoder, inputs: TaaInputs) {
      if (images.length !== 2) throw new Error('TAA_TARGETS_MISSING');
      const set = inputs.upscale ? resolves.upscale : resolves;
      if (!set) throw new Error('TAA_UPSCALE_MISSING');
      const kind = inputs.share ? 'blended' : inputs.flags ? 'asIs' : 'flagless';
      const twin = inputs.filter && resolves.filtered(kind, !!inputs.upscale);
      // Until its twin is compiled, the image resolves no layer: composition reads the raw ones.
      if (!twin) inputs.filter = undefined;
      const resolve = twin || set[kind];
      filterHistory.follow(inputs.filter, width, height);
      if (!bound || INPUTS.some((key) => bound![key] !== inputs[key])) {
        bound = { ...inputs };
        const { layout } = resolve;
        for (let i = 0; i < 2; i++) {
          const entries: GPUBindGroupEntry[] = [
            { binding: TAA_BINDINGS.current, resource: inputs.current },
            { binding: TAA_BINDINGS.history, resource: images[i].color },
            { binding: TAA_BINDINGS.historySampler, resource: sampler },
            { binding: TAA_BINDINGS.depth, resource: inputs.depth },
            { binding: TAA_BINDINGS.ids, resource: inputs.ids },
            { binding: TAA_BINDINGS.pages, resource: { buffer: inputs.pages } },
            { binding: TAA_BINDINGS.motion, resource: { buffer: inputs.motion } },
            { binding: TAA_BINDINGS.view, resource: { buffer: uniform } },
          ];
          if (inputs.flags || inputs.share)
            entries.push(
              { binding: TAA_BINDINGS.flags, resource: inputs.share ?? inputs.flags! },
              { binding: TAA_BINDINGS.shareHistory, resource: images[i].share },
            );
          entries.push(...filterHistory.entries(inputs.filter, i));
          groups[i] = device.createBindGroup({ layout, entries });
        }
      }
      const write = 1 - read,
        { color, share } = images[write],
        filter = inputs.filter && filterHistory.target(write);
      const pass = encoder.beginRenderPass({
        label: TAA_PASS,
        colorAttachments: [color, share, ...(filter ?? [])].map((view) => ({ view, ...CLEAR })),
      });
      pass.setPipeline(resolve.pipeline);
      pass.setBindGroup(0, groups[read]!);
      pass.draw(3);
      pass.end();
      read = write;
      filterHistory.written = !!filter;
      images[write].filter = filter;
      return images[write];
    },
    /** Releases the two targets with the frame targets: the next `resize` makes them again, and
     *  history no longer exists. */
    release: dropTargets,
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
