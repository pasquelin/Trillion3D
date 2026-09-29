import { TAA_PASS, TAA_VIEW_BYTES } from './shaderWgsl.ts';
import { SHARE_FORMAT, createTaaResolves } from './resolve.ts';
import { INPUTS, taaGroupEntries, type TaaInputs } from './inputs.ts';
import { createTaaCheckpoint, createTaaFrameState } from './frameState.ts';
import { createPlacementMotion, type MotionRoot } from './motion.ts';
import { createTaaFilterHistory } from './layers.ts';
import type { AccumulatedImage } from '../lighting/deferred/program.ts';

/** A history target's attachment: cleared by the pass that writes it. */
const CLEAR = { loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] } as const;
/** Bytes per pixel of the two history targets: two `rgba16float`, and their two shares and tags. */
export const TAA_HISTORY_BYTES_PER_PIXEL = 20;

/**
 * Temporal antialiasing pass: two history targets in ping-pong, each a colour and its as-is share,
 * one read and the other written each frame, and composition reads the one just written. Targets
 * follow the display size (`resize`); bind groups are rebuilt when an input changes identity, never
 * per frame. With `upscale`, the resolves that reconstruct a frame drawn below the display are
 * compiled at once (`upscales`).
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
  // A frame with no transparent reads zero as its reactive value, from this one texel.
  const noReactive = device.createTexture({
    label: 'Trillion3D TAA no reactive',
    size: { width: 1, height: 1 },
    format: SHARE_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const noReactiveView = noReactive.createView();
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
    /** Whether the upscaling resolves are compiled; the first ask compiles them (`resolve.ts`). */
    upscales: () => !!resolves.upscaled(),
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
      [width, height] = [w, h];
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
      const set = inputs.upscale ? resolves.upscaled() : resolves;
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
          const entries = taaGroupEntries(inputs, images[i], sampler, uniform, noReactiveView);
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
    /** Releases the two targets with the frame targets, history gone, until the next `resize`. */
    release: dropTargets,
    dispose() {
      dropTargets();
      motion.dispose();
      uniform.destroy();
      noReactive.destroy();
      bound = undefined;
      this.inputs = {} as TaaInputs;
    },
  };
}

export type TemporalAntialiasing = Awaited<ReturnType<typeof createTemporalAntialiasing>>;
