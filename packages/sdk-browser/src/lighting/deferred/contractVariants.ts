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
 * wide or narrow (#849), with or without shadow code (#1249), with or without rectangle code
 * (#1369). A narrow program reads at most `TILE_LIGHTS` lights, so it stands in for no wide one;
 * an unshadowed one reads no shadow, so it stands in for no scene that holds one; a rectless one
 * shades no rectangle, so it stands in for no scene that holds one; a wide program with shadow
 * and rectangle code serves any scene. While the asked one compiles, the frame is lit by the best
 * one ready — the same one without bounce, then with rectangle code, then with shadow code, then
 * with both, then a wide one —, else by none.
 *
 * A narrow, unshadowed or rectless program's twin — wide, with shadow and rectangle code —
 * compiles beside it, from the same frame: a scene that passes `TILE_LIGHTS` lights, or whose
 * light takes a shadow or is a rectangle, finds its program ready as soon as a single program
 * would have been, and never falls back to the unlit view where one program would not. No frame
 * waits for that twin (`settle`) nor is redrawn at its arrival (`onReady`) until one asks for it.
 * A failed compile is said (`onFailure`) once, never retried.
 */
export type ContractVariantOptions = {
  onFailure?: (error: unknown) => void;
  /** A reference session's rough reflection trace, unbounded (`reflectionTrace`, #33). */
  unboundedReflections?: boolean;
};
export function createContractVariants(
  device: GPUDevice,
  bindings: DeferredBindings,
  pages = SUN_WINDOW,
  onReady?: () => void,
  { onFailure: reportFailure, unboundedReflections }: ContractVariantOptions = {},
) {
  /** `variants[+narrow + 2 * unshadowed + 4 * rectless][+bounce]`. */
  const variants: Variant[][] = [0, 1, 2, 3, 4, 5, 6, 7].map(() => [{}, {}]);
  const at = (narrow: boolean, unshadowed: boolean, rectless: boolean) =>
    +narrow + 2 * +unshadowed + 4 * +rectless;
  const compile = (
    bounce: boolean,
    narrow: boolean,
    unshadowed: boolean,
    rectless: boolean,
    onFailure = reportFailure,
  ) => {
    const variant = variants[at(narrow, unshadowed, rectless)][+bounce];
    const special = at(narrow, unshadowed, rectless) !== 0;
    if (variant.program || variant.pending || variant.failed) return;
    variant.pending = createDeferredProgram(
      device,
      {
        lighting: contractLightingShader(bounce, narrow, pages, !unshadowed, !rectless),
        compose: CONTRACT_COMPOSITIONS,
        label: `${bounce ? 'BOUNCE' : 'DIRECT'}${narrow ? '_NARROW' : ''}${unshadowed ? '_UNSHADOWED' : ''}${rectless ? '_RECTLESS' : ''}`,
        direct: true,
        bounce,
        pages,
        unboundedReflections,
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
        // Its twin now lights the frames that asked for it: its arrival redraws them.
        if (variant.asked && special) variants[0][+bounce].asked = true;
        onFailure?.(error);
      },
    );
    if (special) compile(bounce, false, false, false, onFailure);
  };
  /** The program ready at this index, the asked bounce first, else without bounce. */
  const ready = (index: number, bounce: boolean) =>
    variants[index][+bounce].program ?? variants[index][0].program;
  /** The best program ready to light a frame that asks for this one, if any: each step serves
   *  more scenes than the one before. */
  const lending = (bounce: boolean, narrow: boolean, unshadowed: boolean, rectless: boolean) =>
    ready(at(narrow, unshadowed, rectless), bounce) ??
    ready(at(narrow, unshadowed, false), bounce) ??
    ready(at(narrow, false, rectless), bounce) ??
    ready(at(narrow, false, false), bounce) ??
    ready(0, bounce);
  /** A frame asks for this program: it compiles, and its arrival redraws (`onReady`). A failed one
   *  asks for its twin in its place, which the frame then waits for. */
  const ask = (
    bounce: boolean,
    narrow: boolean,
    unshadowed: boolean,
    rectless: boolean,
    onFailure?: (error: unknown) => void,
  ): Variant => {
    const variant = variants[at(narrow, unshadowed, rectless)][+bounce];
    variant.asked = true;
    compile(bounce, narrow, unshadowed, rectless, onFailure);
    return variant.failed && at(narrow, unshadowed, rectless) !== 0
      ? ask(bounce, false, false, false, onFailure)
      : variant;
  };
  return {
    /** The program to light this frame with, compiling the asked one; `undefined` if none is ready. */
    pick(
      bounce: boolean,
      narrow: boolean,
      unshadowed: boolean,
      rectless: boolean,
      onFailure?: (error: unknown) => void,
    ) {
      ask(bounce, narrow, unshadowed, rectless, onFailure);
      return lending(bounce, narrow, unshadowed, rectless);
    },
    /** Starts the narrow program and its wide twin, both with shadow code, before any frame asks
     *  for them, settled once both landed or failed: prepare compiles the lit program beside the
     *  others, and a shadowed program lights any first frame. */
    precompile(bounce: boolean) {
      compile(bounce, true, false, false);
      const started = [
        variants[at(true, false, false)][+bounce].pending,
        variants[0][+bounce].pending,
      ];
      return Promise.all(started).then(() => {});
    },
    /** The compile a frame asking for this program must wait for: none while a ready program
     *  lends itself; once it failed, its twin's; once both failed, none (the unlit view). */
    awaited(bounce: boolean, narrow: boolean, unshadowed: boolean, rectless: boolean) {
      return lending(bounce, narrow, unshadowed, rectless)
        ? undefined
        : ask(bounce, narrow, unshadowed, rectless).pending;
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
