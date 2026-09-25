import type { EffectPass } from '../../../sdk-core/src/world/effect/chain.ts';
import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts';
import { BLOOM_TEXEL_BYTES } from './bloomFilter.ts';
import { createWebgpuBloom, type WebgpuBloom } from './webgpuBloom.ts';

/**
 * The WebGPU side of `world.effects`: the passes that run before tone mapping, between the
 * temporal resolve and the composition that tone-maps. Each pass writes a full-size
 * `rgba16float` target the next one reads, two in turn at most; the bloom keeps its own levels.
 * Nothing exists before the first frame with a pass: the targets are made then, at the image's
 * size, and follow it; the programs compile in the background, and until they are ready the
 * image is drawn without the chain and says it is not settled (`loading`). `ready` is called when
 * they arrive, so the image is drawn again with them; `failed` when they cannot be made, and the
 * image stays without the chain.
 */
export function createWebgpuEffects(
  device: GPUDevice,
  events: { ready(): void; failed(error: unknown): void },
) {
  let bloom: WebgpuBloom | undefined,
    loading: Promise<void> | undefined,
    failed = false,
    draws = 0,
    width = 0,
    height = 0;
  const targets: GPUTexture[] = [],
    views: GPUTextureView[] = [];
  const load = () => {
    loading ??= createWebgpuBloom(device).then(
      (made) => {
        bloom = made;
        loading = undefined;
        events.ready();
      },
      (error) => {
        failed = true;
        loading = undefined;
        events.failed(error);
      },
    );
  };
  const release = () => {
    for (const target of targets) target.destroy();
    targets.length = views.length = 0;
    bloom?.resize(0, 0);
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
    bloom!.resize(w, h);
  };
  return {
    /** True while the programs compile: the image drawn meanwhile lacks the chain. */
    get loading() {
      return loading !== undefined;
    },
    /** Bytes of every target the chain holds: the pass targets and the bloom levels. */
    get bytes() {
      return targets.length * width * height * BLOOM_TEXEL_BYTES + (bloom?.bytes ?? 0);
    },
    /** Passes the last `encode` drew: zero when it drew none. */
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
      if (!bloom) {
        if (!failed) load();
        return input;
      }
      ensure(Math.min(passes.length, 2), w, h);
      if (!bloom.levels) return input;
      let view = input;
      for (let index = 0; index < passes.length; index++) {
        const output = views[index % 2];
        draws += bloom.encode(encoder, passes[index] as Bloom, view, output);
        view = output;
      }
      return view;
    },
    dispose() {
      release();
      bloom?.dispose();
      bloom = undefined;
    },
  };
}

export type WebgpuEffects = ReturnType<typeof createWebgpuEffects>;
