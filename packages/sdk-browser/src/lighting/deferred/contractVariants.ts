import { CONTRACT_COMPOSITIONS, contractLightingShader } from './shaders.ts';
import { createDeferredProgram, type DeferredBindings, type DeferredProgram } from './program.ts';

type Variant = { program?: DeferredProgram; pending?: Promise<unknown> };
/** A contract program's rank: `bounce + 2 * narrow`. */
const rankOf = (bounce: boolean, narrow: boolean) => +bounce + 2 * +narrow;
const LABELS = ['DIRECT', 'BOUNCE', 'DIRECT_NARROW', 'BOUNCE_NARROW'] as const;

/**
 * The contract programs, each compiled the first time a frame asks for it: with or without bounce,
 * wide or narrow (#849). A narrow program reads at most `TILE_LIGHTS` lights, so it stands in for
 * no wide one; a wide one serves any scene. While the asked one compiles, the frame is lit by the
 * best one ready — the same width without bounce, then a wide one —, else by none.
 *
 * Once a narrow program is ready, its wide twin compiles behind it: a scene that passes
 * `TILE_LIGHTS` lights then finds its program ready, and never falls back to the unlit view.
 */
export function createContractVariants(
  device: GPUDevice,
  bindings: DeferredBindings,
  onReady?: () => void,
) {
  const variants: Variant[] = LABELS.map(() => ({}));
  const compile = (rank: number, onFailure?: (error: unknown) => void) => {
    const variant = variants[rank];
    if (variant.program || variant.pending) return;
    const bounce = !!(rank & 1),
      narrow = rank >= 2;
    variant.pending = createDeferredProgram(
      device,
      {
        lighting: contractLightingShader(bounce, narrow),
        compose: CONTRACT_COMPOSITIONS,
        label: LABELS[rank],
        direct: true,
        bounce,
      },
      bindings,
    ).then(
      (program) => {
        variant.program = program;
        onReady?.();
        if (narrow) compile(rank - 2, onFailure);
      },
      (error) => onFailure?.(error),
    );
  };
  return {
    /** The program to light this frame with, compiling the asked one; `undefined` if none is ready. */
    pick(bounce: boolean, narrow: boolean, onFailure?: (error: unknown) => void) {
      const rank = rankOf(bounce, narrow);
      compile(rank, onFailure);
      const order = [rank, rank & 2, rank & 1, 0];
      for (const candidate of order) {
        const program = variants[candidate].program;
        if (program) return program;
      }
      return undefined;
    },
    settle() {
      return Promise.all(variants.map((variant) => variant.pending)).then(() => {});
    },
    release() {
      for (const variant of variants) variant.program?.release();
    },
  };
}
