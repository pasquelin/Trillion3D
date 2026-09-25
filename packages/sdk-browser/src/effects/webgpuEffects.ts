import type { EffectKind, EffectPass } from '../../../sdk-core/src/world/effect/chain.ts';
import {
  countKinds,
  EFFECT_KINDS as KINDS,
  effectPassTargets,
  effectTargetBytes,
  type EffectPassOf,
} from './targets.ts';
import { createWebgpuBloom } from './webgpuBloom.ts';

/** One kind of pass on WebGPU: its programs, compiled once, and the resources its passes share. */
export type WebgpuEffectKind<P> = {
  /** Bytes of what it holds as allocated. */
  readonly bytes: number;
  /** Sizes what it holds for `count` passes on a `w × h` image; zero passes free it. */
  resize(w: number, h: number, count: number): void;
  /** Encodes `pass`, the `nth` of its kind in the chain, from `input` into `output`; returns the
   *  render passes encoded, zero when it cannot draw at this size. */
  encode(
    encoder: GPUCommandEncoder,
    pass: P,
    nth: number,
    input: GPUTextureView,
    output: GPUTextureView,
  ): number;
  dispose(): void;
};
type Kinds = { [K in EffectKind]: WebgpuEffectKind<EffectPassOf<K>> };

/** Each kind's WebGPU implementation: the one place a new built-in or a custom pass plugs in. */
export const WEBGPU_KINDS: { [K in EffectKind]: (device: GPUDevice) => Promise<Kinds[K]> } = {
  bloom: createWebgpuBloom,
};

/**
 * The WebGPU side of `world.effects`: the passes that run before tone mapping, between the
 * temporal resolve and the composition that tone-maps. Each pass writes a full-size
 * `rgba16float` target the next one reads, two in turn at most; each kind keeps its own resources.
 * Nothing exists before the first frame with a pass: the targets are made then, at the image's
 * size, and follow it; a kind's programs compile in the background at its first pass, and until
 * every kind of the chain is ready the image is drawn without the chain (`loading`), which its
 * caller draws again once they arrive (`settled`) rather than hold. `fail` is called when one
 * cannot be made, and the image stays without the chain.
 */
export function createWebgpuEffects(device: GPUDevice, fail: (error: unknown) => void) {
  const made: Partial<Kinds> = {},
    pending = new Map<EffectKind, Promise<void>>(),
    counts = {} as Record<EffectKind, number>,
    nth = {} as Record<EffectKind, number>;
  let failed = false,
    disposed = false,
    draws = 0,
    width = 0,
    height = 0;
  const targets: GPUTexture[] = [],
    views: GPUTextureView[] = [];
  const load = <K extends EffectKind>(kind: K) => {
    if (failed || pending.has(kind)) return;
    const loaded = WEBGPU_KINDS[kind](device).then(
      (implementation) => {
        // Arrived after the chain was disposed (a closed session, a lost device): freed, unsaid.
        if (disposed) return implementation.dispose();
        made[kind] = implementation;
        pending.delete(kind);
      },
      (error) => {
        if (disposed) return;
        failed = true;
        pending.delete(kind);
        fail(error);
      },
    );
    pending.set(kind, loaded);
  };
  /** Draws `pass` with its kind's implementation; the chain holds built-ins only (`EffectKind`). */
  const encodePass = <K extends EffectKind>(
    encoder: GPUCommandEncoder,
    pass: EffectPassOf<K>,
    input: GPUTextureView,
    output: GPUTextureView,
  ) => made[pass.kind as K]!.encode(encoder, pass, nth[pass.kind]++, input, output);
  const release = () => {
    for (const target of targets) target.destroy();
    targets.length = views.length = 0;
    for (const kind of KINDS) made[kind]?.resize(0, 0, 0);
    width = height = 0;
  };
  const ensure = (count: number, w: number, h: number) => {
    if (w !== width || h !== height) release();
    width = w;
    height = h;
    while (targets.length < count) {
      const target = device.createTexture({
        label: `Trillion3D effect target ${targets.length}`,
        size: { width: w, height: h },
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      targets.push(target);
      views.push(target.createView());
    }
    for (const kind of KINDS) made[kind]?.resize(w, h, counts[kind]);
  };
  /** Counts the passes of each kind; false while a kind they need is not compiled. */
  const readyFor = (passes: readonly EffectPass[]) => {
    countKinds(passes, counts);
    for (const kind of KINDS) nth[kind] = 0;
    let ready = !failed;
    for (const kind of KINDS)
      if (counts[kind] && !made[kind]) {
        load(kind);
        ready = false;
      }
    return ready;
  };
  return {
    /** True while programs compile: the image drawn meanwhile lacks the chain. */
    get loading() {
      return pending.size > 0;
    },
    /** Resolves once every program in compilation has arrived or failed. */
    settled: () => Promise.all(pending.values()),
    /** Bytes of every target the chain holds: the pass targets and each kind's own. */
    get bytes() {
      let bytes = effectTargetBytes(width, height, targets.length, false);
      for (const kind of KINDS) bytes += made[kind]?.bytes ?? 0;
      return bytes;
    },
    /** Render passes the last `encode` drew: zero when it drew none. */
    get draws() {
      return draws;
    },
    /** Encodes `passes` over `input`, an image of `w` × `h`, and returns what composition reads:
     *  `input` itself when there is nothing to draw. */
    encode(
      encoder: GPUCommandEncoder,
      passes: readonly EffectPass[],
      input: GPUTextureView,
      w: number,
      h: number,
    ) {
      draws = 0;
      if (!passes.length) {
        release();
        return input;
      }
      if (!readyFor(passes)) return input;
      ensure(effectPassTargets(passes.length), w, h);
      let view = input,
        written = 0;
      for (const pass of passes) {
        const output = views[written % 2],
          drawn = encodePass(encoder, pass as EffectPassOf<EffectKind>, view, output);
        if (!drawn) continue;
        draws += drawn;
        view = output;
        written++;
      }
      return view;
    },
    dispose() {
      disposed = true;
      release();
      for (const kind of KINDS) made[kind]?.dispose();
    },
  };
}

export type WebgpuEffects = ReturnType<typeof createWebgpuEffects>;
