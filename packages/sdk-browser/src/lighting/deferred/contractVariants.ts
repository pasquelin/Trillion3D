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
 * wide or narrow (#849), with or without shadow code (#1249). A narrow program reads at most
 * `TILE_LIGHTS` lights, so it stands in for no wide one; an unshadowed one reads no shadow, so it
 * stands in for no scene that holds one; a wide program with shadow code serves any scene. While
 * the asked one compiles, the frame is lit by the best one ready — the same width and shadows
 * without bounce, then with shadow code, then a wide one —, else by none.
 *
 * A narrow or unshadowed program's twin — wide, with shadow code — compiles beside it, from the
 * same frame: a scene that passes `TILE_LIGHTS` lights, or whose light takes a shadow, finds its
 * program ready as soon as a single program would have been, and never falls back to the unlit
 * view where one program would not. No frame waits for that twin (`settle`) nor is redrawn at its
 * arrival (`onReady`) until one asks for it. A failed compile is said (`onFailure`) once, never
 * retried.
 */
export function createContractVariants(
  device: GPUDevice,
  bindings: DeferredBindings,
  pages = SUN_WINDOW,
  onReady?: () => void,
  reportFailure?: (error: unknown) => void,
) {
  /** `variants[+narrow + 2 * unshadowed][+bounce]`. */
  const variants: Variant[][] = [0, 1, 2, 3].map(() => [{}, {}]);
  const at = (narrow: boolean, unshadowed: boolean) => +narrow + 2 * +unshadowed;
  const compile = (
    bounce: boolean,
    narrow: boolean,
    unshadowed: boolean,
    onFailure = reportFailure,
  ) => {
    const variant = variants[at(narrow, unshadowed)][+bounce];
    if (variant.program || variant.pending || variant.failed) return;
    variant.pending = createDeferredProgram(
      device,
      {
        lighting: contractLightingShader(bounce, narrow, pages, !unshadowed),
        compose: CONTRACT_COMPOSITIONS,
        label: `${bounce ? 'BOUNCE' : 'DIRECT'}${narrow ? '_NARROW' : ''}${unshadowed ? '_UNSHADOWED' : ''}`,
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
    if (narrow || unshadowed) compile(bounce, false, false, onFailure);
  };
  /** The best program ready to light a frame that asks for this one, if any. */
  const lending = (bounce: boolean, narrow: boolean, unshadowed: boolean) => {
    const asked = variants[at(narrow, unshadowed)];
    const shadowed = variants[at(narrow, false)];
    return (
      asked[+bounce].program ??
      asked[0].program ??
      shadowed[+bounce].program ??
      shadowed[0].program ??
      variants[0][+bounce].program ??
      variants[0][0].program
    );
  };
  return {
    /** The program to light this frame with, compiling the asked one; `undefined` if none is ready. */
    pick(
      bounce: boolean,
      narrow: boolean,
      unshadowed: boolean,
      onFailure?: (error: unknown) => void,
    ) {
      variants[at(narrow, unshadowed)][+bounce].asked = true;
      compile(bounce, narrow, unshadowed, onFailure);
      return lending(bounce, narrow, unshadowed);
    },
    /** Starts the narrow program and its wide twin, both with shadow code, before any frame asks
     *  for them, settled once both landed or failed: prepare compiles the lit program beside the
     *  others, and a shadowed program lights any first frame. */
    precompile(bounce: boolean) {
      compile(bounce, true, false);
      const started = [variants[at(true, false)][+bounce].pending, variants[0][+bounce].pending];
      return Promise.all(started).then(() => {});
    },
    /** The compile a frame asking for this program must wait for: none while a ready program
     *  lends itself, nor once it failed (the frame then falls back to the unlit view). */
    awaited(bounce: boolean, narrow: boolean, unshadowed: boolean) {
      if (lending(bounce, narrow, unshadowed)) return undefined;
      const variant = variants[at(narrow, unshadowed)][+bounce];
      variant.asked = true;
      compile(bounce, narrow, unshadowed);
      return variant.pending;
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
