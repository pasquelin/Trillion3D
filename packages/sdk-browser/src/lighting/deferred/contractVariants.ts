import { CONTRACT_COMPOSITIONS, contractLightingShader } from './shaders.ts'
import { shadowKindsOf } from '../direct/shadowKinds.ts'
import { createDeferredProgram, type DeferredBindings, type DeferredProgram } from './program.ts'

/** A lit program: compiled, compiling or failed, and whether a frame asked for it. */
type Variant<P> = {
  program?: P
  pending?: Promise<unknown>
  asked?: boolean
  failed?: boolean
}

/**
 * Which lit program a frame asks for, past its bounce: what it leaves out. `sunless` and
 * `localless` leave out the shadow read of one kind of light — a sun's clipmap, a local light's map
 * (`ShadowKinds`) — where every shadowed light of the scene is of the other; never set beside
 * `unshadowed`, which leaves out both.
 */
export type ContractKey = {
  narrow: boolean
  unshadowed: boolean
  rectless: boolean
  sunless: boolean
  localless: boolean
}

/** What a program can leave out besides its lists' width: bit `k` of a set is `CUTS[k]`. */
const CUTS = ['unshadowed', 'rectless', 'sunless', 'localless'] as const
const UNSHADOWED = 1,
  KINDS = 4 | 8

/** The suffix of the name of a program that leaves out what `key` says. */
export const variantLabel = (key: Partial<ContractKey>) =>
  `${key.narrow ? '_NARROW' : ''}${CUTS.map((cut) => (key[cut] ? `_${cut.toUpperCase()}` : '')).join('')}`

/** The key of the program with every code path: it serves any scene. */
export const FULL_CONTRACT: Readonly<ContractKey> = {
  narrow: false,
  unshadowed: false,
  rectless: false,
  sunless: false,
  localless: false,
}

/** Whether `key` leaves out some code: its program has a twin with every code path. */
export const leavesOut = (key: Partial<ContractKey>) => CUTS.some((cut) => key[cut])

/** The set of cuts `key` makes. */
const cutsOf = (key: Partial<ContractKey>) =>
  CUTS.reduce((set, cut, bit) => set | (key[cut] ? 1 << bit : 0), 0)

/** The sets of cuts of the programs that serve a frame of cuts `set`, the most cuts first — the
 *  closest fit: a program serves the frames that keep what it leaves out. An unshadowed frame
 *  keeps no shadow read of either kind, so a program that leaves out one kind serves it too. No
 *  key leaves out a kind beside `unshadowed`, nor both kinds (`ContractKey`): no such set is a
 *  program. */
const serving = (set: number) => {
  const served = set & UNSHADOWED ? set | KINDS : set
  const sets: number[] = []
  for (let own = served; ; own = (own - 1) & served) {
    if (!(own & UNSHADOWED && own & KINDS) && (own & KINDS) !== KINDS) sets.push(own)
    if (!own) break
  }
  const size = (n: number) => n.toString(2).replace(/0/g, '').length
  return sets.sort((x, y) => size(y) - size(x) || x - y)
}
const SERVING = Array.from({ length: 16 }, (_, set) => serving(set))

/**
 * The lit programs of one pass, each compiled the first time a frame asks for it: with or without
 * bounce, wide or narrow, with or without shadow code, with the shadow read of a
 * sun, of a local light, or of both (`ShadowKinds`), with or without rectangle
 * code. A narrow program reads at most `TILE_LIGHTS` lights, so it stands in for no wide
 * one; an unshadowed one reads no shadow, so it stands in for no scene that holds one; a rectless
 * one shades no rectangle, so it stands in for no scene that holds one; a wide program with shadow
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
 *
 * `build` compiles one: the opaque resolve's (`createContractVariants`), and the transparent
 * passes' (`../../webgpu/blend/pipelines.ts`, `../../webgpu/water/pipelines.ts`), which light with
 * the same light loop (`declaredLightWgsl`) and are keyed on the same lights (`contractKey`).
 */
function createLitVariants<P>(
  build: (bounce: boolean, key: ContractKey) => Promise<P>,
  onReady?: () => void,
  reportFailure?: (error: unknown) => void,
  dispose?: (program: P) => void,
) {
  /** `variants[slotOf(narrow, cuts)][+bounce]`: `+narrow + 2 · cuts`. */
  const variants: Variant<P>[][] = Array.from({ length: 32 }, () => [{}, {}])
  const slotOf = (narrow: boolean, set: number) => +narrow + 2 * set
  const keyOf = (narrow: boolean, set: number): ContractKey => ({
    narrow,
    unshadowed: !!(set & 1),
    rectless: !!(set & 2),
    sunless: !!(set & 4),
    localless: !!(set & 8),
  })
  const compile = (bounce: boolean, narrow: boolean, set: number, onFailure = reportFailure) => {
    const index = slotOf(narrow, set),
      variant = variants[index][+bounce],
      special = index !== 0
    if (variant.program || variant.pending || variant.failed) return
    variant.pending = build(bounce, keyOf(narrow, set)).then(
      (program) => {
        variant.program = program
        variant.pending = undefined
        if (variant.asked) onReady?.()
      },
      (error) => {
        variant.pending = undefined
        variant.failed = true
        // Its twin now lights the frames that asked for it: its arrival redraws them.
        if (variant.asked && special) variants[0][+bounce].asked = true
        onFailure?.(error)
      },
    )
    if (special) compile(bounce, false, 0, onFailure)
  }
  /** The program ready at this index, the asked bounce first, else without bounce. */
  const ready = (index: number, bounce: boolean) =>
    variants[index][+bounce].program ?? variants[index][0].program
  /** The best program ready to light a frame that asks for this one, if any: each step serves
   *  more scenes than the one before. */
  const lending = (bounce: boolean, narrow: boolean, set: number) => {
    for (const own of SERVING[set]) {
      const program = ready(slotOf(narrow, own), bounce)
      if (program) return program
    }
    return ready(0, bounce)
  }
  /** A frame asks for this program: it compiles, and its arrival redraws (`onReady`). A failed one
   *  asks for its twin in its place, which the frame then waits for. */
  const ask = (
    bounce: boolean,
    narrow: boolean,
    set: number,
    onFailure?: (error: unknown) => void,
  ): Variant<P> => {
    const index = slotOf(narrow, set),
      variant = variants[index][+bounce]
    variant.asked = true
    compile(bounce, narrow, set, onFailure)
    return variant.failed && index !== 0 ? ask(bounce, false, 0, onFailure) : variant
  }
  return {
    /** The program to light this frame with, compiling the asked one; `undefined` if none is ready.
     *  `narrow` is the lists' width, which `key`'s own is not read for. */
    pick(
      bounce: boolean,
      narrow: boolean,
      key: Partial<ContractKey>,
      onFailure?: (error: unknown) => void,
    ) {
      const set = cutsOf(key)
      ask(bounce, narrow, set, onFailure)
      return lending(bounce, narrow, set)
    },
    /** Starts the program a first frame asks for and its wide twin with every code path, before
     *  any frame does, settled once both landed or failed: prepare compiles the lit program beside
     *  the others, and no first frame starts a compile. */
    precompile(bounce: boolean, key: ContractKey) {
      const set = cutsOf(key)
      compile(bounce, key.narrow, set)
      const started = [
        variants[slotOf(key.narrow, set)][+bounce].pending,
        variants[0][+bounce].pending,
      ]
      return Promise.all(started).then(() => {})
    },
    /** The compile a frame asking for this program must wait for: none while a ready program
     *  lends itself; once it failed, its twin's; once both failed, none (the unlit view). */
    awaited(bounce: boolean, narrow: boolean, key: Partial<ContractKey>) {
      const set = cutsOf(key)
      return lending(bounce, narrow, set) ? undefined : ask(bounce, narrow, set).pending
    },
    /** Waits for the programs a frame asked for, never a twin compiling beside them. */
    settle() {
      return Promise.all(
        variants.flat().map((variant) => (variant.asked ? variant.pending : undefined)),
      ).then(() => {})
    },
    release() {
      for (const variant of variants.flat()) if (variant.program) dispose?.(variant.program)
    },
  }
}

/** What the opaque resolve's programs are told: a failed compile (`onFailure`), and a reference
 *  session's rough reflection trace, unbounded (`reflectionTrace`). */
type ContractVariantOptions = {
  onFailure?: (error: unknown) => void
  unboundedReflections?: boolean
}
/** The lit programs: when `precompile`, the one a first frame asks for (`key`) compiles from the
 *  start beside the unlit one, without bounce always, with it too when `bounce`;
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
          lighting: contractLightingShader(
            bounce,
            key.narrow,
            !key.unshadowed,
            !key.rectless,
            shadowKindsOf(key),
          ),
          compose: CONTRACT_COMPOSITIONS,
          label: `${bounce ? 'BOUNCE' : 'DIRECT'}${variantLabel(key)}`,
          direct: true,
          bounce,
          unboundedReflections,
        },
        bindings,
      ),
    onReady,
    onFailure,
    (program) => program.release(),
  )

/** What a forward pass is told of the lit programs (`LitPrograms`): the key a first frame asks for
 *  while `precompile`, and whom a failed compile is said to. */
export type ForwardLit = Pick<LitPrograms, 'precompile' | 'key' | 'onFailure'>

/**
 * A forward pass's lit programs — the blends' (`../../webgpu/blend/pipelines.ts`), the water
 * composite's (`../../webgpu/water/frame.ts`) —, which light with the opaque resolve's loop
 * (`declaredLightingWgsl`) and so take its programs without shadow or rectangle code
 * (`createLitVariants`), never bounce or narrow lists, which they do not read: a first frame's
 * narrow key asks for the wide program. Prepare compiles the one a first frame asks for and its
 * twin with every code path, and waits for both; a frame picks on the opaque resolve's key
 * (`directLightResources`), lent the twin while another compiles — the same image, every program a
 * light loop that sums the same terms. The twin's failure is the pass's own (thrown); another's is
 * said (`onFailure`), the twin lighting in its place.
 */
export async function createForwardVariants<P>(
  build: (key: ContractKey) => Promise<P>,
  lit?: ForwardLit,
) {
  let failure: unknown
  const variants = createLitVariants((_bounce, key) =>
    build(key).catch((error: unknown) => {
      if (leavesOut(key)) lit?.onFailure?.(error)
      else failure = error
      throw error
    }),
  )
  const first = lit?.precompile ? { ...lit.key, narrow: false } : FULL_CONTRACT
  await variants.precompile(false, first)
  const twin = variants.pick(false, false, FULL_CONTRACT)
  if (!twin) throw failure
  /** The program that lights a frame of key `key`. */
  return (key: Partial<ContractKey>) => variants.pick(false, false, key) ?? twin
}
