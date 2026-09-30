import { CONTRACT_COMPOSITIONS, contractLightingShader } from './shaders.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createDeferredProgram, type DeferredBindings, type DeferredProgram } from './program.ts';

/** A contract program: compiled, compiling or failed, and whether a frame asked for it. */
type Variant = {
  program?: DeferredProgram;
  pending?: Promise<unknown>;
  asked?: boolean;
  failed?: boolean;
};

/**
 * The contract programs, each compiled the first time a frame asks for it: with or without bounce,
 * wide or narrow (#849). A narrow program reads at most `TILE_LIGHTS` lights, so it stands in for
 * no wide one; a wide one serves any scene. While the asked one compiles, the frame is lit by the
 * best one ready — the same width without bounce, then a wide one —, else by none.
 *
 * A narrow program's wide twin compiles beside it, from the same frame: a scene that passes
 * `TILE_LIGHTS` lights finds its program ready as soon as a single program would have been, and
 * never falls back to the unlit view where one program would not. No frame waits for that twin
 * (`settle`) nor is redrawn at its arrival (`onReady`) until one asks for it. A failed compile is
 * said (`onFailure`) once, never retried.
 */
export function createContractVariants(
  device: GPUDevice,
  bindings: DeferredBindings,
  pages = SUN_WINDOW,
  onReady?: () => void,
  reportFailure?: (error: unknown) => void,
) {
  /** `variants[+narrow][+bounce]`. */
  const variants: Variant[][] = [
    [{}, {}],
    [{}, {}],
  ];
  const compile = (bounce: boolean, narrow: boolean, onFailure = reportFailure) => {
    const variant = variants[+narrow][+bounce];
    if (variant.program || variant.pending || variant.failed) return;
    variant.pending = createDeferredProgram(
      device,
      {
        lighting: contractLightingShader(bounce, narrow, pages),
        compose: CONTRACT_COMPOSITIONS,
        label: `${bounce ? 'BOUNCE' : 'DIRECT'}${narrow ? '_NARROW' : ''}`,
        direct: true,
        bounce,
        pages,
      },
      bindings,
    ).then(
      (program) => {
        variant.program = program;
        variant.pending = undefined;
        if (variant.asked) onReady?.();
      },
      (error) => {
        variant.pending = undefined;
        variant.failed = true;
        onFailure?.(error);
      },
    );
    if (narrow) compile(bounce, false, onFailure);
  };
  /** The best program ready to light a frame that asks for this one, if any. */
  const lending = (bounce: boolean, narrow: boolean) =>
    variants[+narrow][+bounce].program ??
    variants[+narrow][0].program ??
    variants[0][+bounce].program ??
    variants[0][0].program;
  return {
    /** The program to light this frame with, compiling the asked one; `undefined` if none is ready. */
    pick(bounce: boolean, narrow: boolean, onFailure?: (error: unknown) => void) {
      variants[+narrow][+bounce].asked = true;
      compile(bounce, narrow, onFailure);
      return lending(bounce, narrow);
    },
    /** Starts the narrow program and its wide twin before any frame asks for them, settled once
     *  both landed or failed: prepare compiles the lit program beside the others. */
    precompile(bounce: boolean) {
      compile(bounce, true);
      const started = [variants[1][+bounce].pending, variants[0][+bounce].pending];
      return Promise.all(started).then(() => {});
    },
    /** The compile a frame asking for this program must wait for: none while a ready program
     *  lends itself, nor once it failed (the frame then falls back to the unlit view). */
    awaited(bounce: boolean, narrow: boolean) {
      if (lending(bounce, narrow)) return undefined;
      variants[+narrow][+bounce].asked = true;
      compile(bounce, narrow);
      return variants[+narrow][+bounce].pending;
    },
    /** Waits for the programs a frame asked for, never a twin compiling beside them. */
    settle() {
      return Promise.all(
        variants.flat().map((variant) => (variant.asked ? variant.pending : undefined)),
      ).then(() => {});
    },
    release() {
      for (const variant of variants.flat()) variant.program?.release();
    },
  };
}
