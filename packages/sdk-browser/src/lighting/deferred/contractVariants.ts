import { CONTRACT_COMPOSITIONS, contractLightingShader } from './shaders.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createDeferredProgram, type DeferredBindings, type DeferredProgram } from './program.ts';

/** A contract program: compiled, compiling, and whether a frame asked for it. */
type Variant = { program?: DeferredProgram; pending?: Promise<unknown>; asked?: boolean };

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
 * arrival (`onReady`) until one asks for it.
 */
export function createContractVariants(
  device: GPUDevice,
  bindings: DeferredBindings,
  pages = SUN_WINDOW,
  onReady?: () => void,
) {
  /** `variants[+narrow + 2 * unshadowed][+bounce]`. */
  const variants: Variant[][] = [0, 1, 2, 3].map(() => [{}, {}]);
  const at = (narrow: boolean, unshadowed: boolean) => +narrow + 2 * +unshadowed;
  const compile = (
    bounce: boolean,
    narrow: boolean,
    unshadowed: boolean,
    onFailure?: (error: unknown) => void,
  ) => {
    const variant = variants[at(narrow, unshadowed)][+bounce];
    if (variant.program || variant.pending) return;
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
      (error) => onFailure?.(error),
    );
    if (narrow || unshadowed) compile(bounce, false, false, onFailure);
  };
  return {
    /** The program to light this frame with, compiling the asked one; `undefined` if none is ready. */
    pick(
      bounce: boolean,
      narrow: boolean,
      unshadowed: boolean,
      onFailure?: (error: unknown) => void,
    ) {
      const asked = variants[at(narrow, unshadowed)];
      asked[+bounce].asked = true;
      compile(bounce, narrow, unshadowed, onFailure);
      const shadowed = variants[at(narrow, false)];
      return (
        asked[+bounce].program ??
        asked[0].program ??
        shadowed[+bounce].program ??
        shadowed[0].program ??
        variants[0][+bounce].program ??
        variants[0][0].program
      );
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
