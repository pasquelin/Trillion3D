import { CONTRACT_COMPOSITIONS, contractLightingShader } from './shaders.ts'
import { createDeferredProgram, type DeferredBindings, type DeferredProgram } from './program.ts'
import {
  CUT_COUNT,
  SERVING,
  cutsIn,
  keyOf,
  twinOf,
  variantLabel,
  type ContractKey,
} from './contractCuts.ts'

/** A lit program: compiled, compiling or failed, and whether a frame asked for it. */
type Variant<P> = {
  program?: P
  pending?: Promise<unknown>
  asked?: boolean
  failed?: boolean
}

/** Who hears of a pass's lit programs: a frame waiting for one that lands (`onReady`), a failed
 *  compile (`onFailure`), a program released (`dispose`). */
type LitVariantsOptions<P> = {
  onReady?: () => void
  onFailure?: (error: unknown) => void
  dispose?: (program: P) => void
}

/**
 * The lit programs of one pass, each compiled the first time a frame asks for it: with or without
 * bounce, wide or narrow (#849), with or without shadow code (#1249), with the shadow read of a
 * sun, of a local light, or of both (`ShadowKinds`), with or without rectangle
 * code (#1369). A narrow program reads at most `TILE_LIGHTS` lights, so it stands in for no wide
 * one; an unshadowed one reads no shadow, so it stands in for no scene that holds one; a rectless
 * one shades no rectangle, so it stands in for no scene that holds one; a wide program with shadow
 * and rectangle code serves any scene. While the asked one compiles, the frame is lit by the best
 * one ready — the same one without bounce, then with rectangle code, then with shadow code, then
 * with both, then a wide one —, else by none.
 *
 * A narrow, unshadowed or rectless program's twin — wide, with shadow and rectangle code, and the
 * lobe code only where the program has it (`twinOf`) — compiles beside it, from the same frame: a
 * scene that passes `TILE_LIGHTS` lights, or whose light takes a shadow or is a rectangle, finds
 * its program ready as soon as a single program would have been, and never falls back to the
 * unlit view where one program would not. A scene whose surfaces carry no lobe never compiles the
 * lobe code: a lobe that appears later asks for its program then, its frames held meanwhile, never
 * lit by a lobeless one (`askLobedPrograms`). No frame waits for that twin (`settle`) nor is
 * redrawn at its arrival (`onReady`) until one asks for it. A failed compile is said (`onFailure`) once, never retried; a failed twin stands in
 * for by the program with every code path, compiled then.
 *
 * `build` compiles one: the opaque resolve's (`createContractVariants`), and the transparent
 * passes' (`../../webgpu/blend/pipelines.ts`, `../../webgpu/water/pipelines.ts`), which light with
 * the same light loop (`declaredLightWgsl`) and are keyed on the same lights (`contractKey`).
 */
export function createLitVariants<P>(
  build: (bounce: boolean, key: ContractKey) => Promise<P>,
  options: LitVariantsOptions<P> = {},
) {
  const table = new LitVariantTable(build, options)
  return {
    /** The program to light this frame with, compiling the asked one; `undefined` if none is ready.
     *  `narrow` is the lists' width, which `key`'s own is not read for. */
    pick(bounce: boolean, narrow: boolean, set: number, onFailure?: (error: unknown) => void) {
      table.ask(bounce, narrow, set, onFailure)
      return table.lending(bounce, narrow, set)
    },
    /** The program of this set once compiled — its stand-in's if it failed —, asked now. */
    async ready(bounce: boolean, narrow: boolean, set: number) {
      const variant = table.ask(bounce, narrow, set)
      await variant.pending
      return variant.program
    },
    /** Starts the program a first frame asks for and its wide twin, before any frame does,
     *  settled once both landed or failed: prepare compiles the lit program beside the others, and
     *  no first frame starts a compile (#1362). */
    precompile(bounce: boolean, key: ContractKey) {
      const set = cutsIn(key)
      table.compile(bounce, key.narrow, set)
      const started = [
        table.variant(key.narrow, set, bounce).pending,
        table.variant(false, twinOf(set), bounce).pending,
      ]
      return Promise.all(started).then(() => {})
    },
    /** The compile a frame asking for this program must wait for: none while a ready program
     *  lends itself; once it failed, its twin's; once both failed, none (the unlit view). */
    awaited(bounce: boolean, narrow: boolean, set: number) {
      return table.lending(bounce, narrow, set) ? undefined : table.ask(bounce, narrow, set).pending
    },
    /** Waits for the programs a frame asked for, never a twin compiling beside them. */
    settle() {
      return Promise.all(
        table.variants.flat().map((variant) => (variant.asked ? variant.pending : undefined)),
      ).then(() => {})
    },
    release() {
      for (const variant of table.variants.flat())
        if (variant.program) options.dispose?.(variant.program)
    },
  }
}

/** A program's slot: `+narrow + 2 · cuts`. */
const slotOf = (narrow: boolean, set: number) => +narrow + 2 * set
/** The program that stands in for this one where it fails, and compiles beside it: its twin,
 *  else, for a twin, the one with every code path; none for that one. */
const standIn = (narrow: boolean, set: number) =>
  slotOf(narrow, set) !== slotOf(false, twinOf(set)) ? twinOf(set) : set ? 0 : undefined

/** The lit programs of one pass (`createLitVariants`), `variants[slotOf(narrow, cuts)][+bounce]`:
 *  each compiled once, a failed one replaced by its stand-in. */
class LitVariantTable<P> {
  readonly variants: Variant<P>[][] = Array.from({ length: 2 << CUT_COUNT }, () => [{}, {}])
  private readonly build: (bounce: boolean, key: ContractKey) => Promise<P>
  private readonly options: LitVariantsOptions<P>
  constructor(
    build: (bounce: boolean, key: ContractKey) => Promise<P>,
    options: LitVariantsOptions<P>,
  ) {
    this.build = build
    this.options = options
  }
  variant(narrow: boolean, set: number, bounce: boolean) {
    return this.variants[slotOf(narrow, set)][+bounce]
  }
  /** Compiles this program once, and a special one's twin beside it; a failure lets its stand-in
   *  light the frames that asked for it, whose arrival redraws them. */
  compile(bounce: boolean, narrow: boolean, set: number, onFailure = this.options.onFailure) {
    const variant = this.variant(narrow, set, bounce),
      twin = twinOf(set),
      special = slotOf(narrow, set) !== slotOf(false, twin)
    if (variant.program || variant.pending || variant.failed) return
    variant.pending = this.build(bounce, keyOf(narrow, set)).then(
      (program) => {
        variant.program = program
        variant.pending = undefined
        if (variant.asked) this.options.onReady?.()
      },
      (error) => {
        variant.pending = undefined
        variant.failed = true
        const instead = standIn(narrow, set)
        if (variant.asked && instead !== undefined) this.ask(bounce, false, instead, onFailure)
        onFailure?.(error)
      },
    )
    if (special) this.compile(bounce, false, twin, onFailure)
  }
  /** The best program ready to light a frame that asks for this one, if any — the asked bounce
   *  first, else without —: each step serves more scenes than the one before, the last the one
   *  with every code path. */
  lending(bounce: boolean, narrow: boolean, set: number) {
    for (const own of SERVING[set]) {
      const slot = this.variants[slotOf(narrow, own)]
      const program = slot[+bounce].program ?? slot[0].program
      if (program) return program
    }
  }
  /** A frame asks for this program: it compiles, and its arrival redraws (`onReady`). A failed one
   *  asks for its stand-in in its place, which the frame then waits for. */
  ask(
    bounce: boolean,
    narrow: boolean,
    set: number,
    onFailure?: (error: unknown) => void,
  ): Variant<P> {
    const variant = this.variant(narrow, set, bounce),
      instead = standIn(narrow, set)
    variant.asked = true
    this.compile(bounce, narrow, set, onFailure)
    return variant.failed && instead !== undefined
      ? this.ask(bounce, false, instead, onFailure)
      : variant
  }
}

/** What the opaque resolve's programs are told: a failed compile (`onFailure`), and a reference
 *  session's rough reflection trace, unbounded (`reflectionTrace`, #33). */
type ContractVariantOptions = {
  onFailure?: (error: unknown) => void
  unboundedReflections?: boolean
}
/** The lit programs: when `precompile`, the one a first frame asks for (`key`) compiles from the
 *  start beside the unlit one (#1362), without bounce always, with it too when `bounce`;
 *  `onFailure` hears any contract compile that fails, precompiled or asked later. */
export type LitPrograms = ContractVariantOptions & {
  precompile: boolean
  bounce: boolean
  key: ContractKey
}
/** The opaque resolve's lit programs (`createLitVariants`): its contract shader at each key. */
export const createContractVariants = (
  device: GPUDevice,
  bindings: DeferredBindings,
  onReady?: () => void,
  { onFailure, unboundedReflections }: ContractVariantOptions = {},
) =>
  createLitVariants<DeferredProgram>(
    (bounce, key) =>
      createDeferredProgram(
        device,
        {
          lighting: contractLightingShader(bounce, key),
          compose: CONTRACT_COMPOSITIONS,
          label: `${bounce ? 'BOUNCE' : 'DIRECT'}${variantLabel(key)}`,
          direct: true,
          bounce,
          unboundedReflections,
        },
        bindings,
      ),
    { onReady, onFailure, dispose: (program) => program.release() },
  )
