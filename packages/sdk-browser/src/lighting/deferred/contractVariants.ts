import { createLitProgram, type LitProgram } from './litProgram.ts'
import type { DeferredBindings } from './program.ts'
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
  /** Whether a special program's twin compiles beside it (`true`, the default), or only when a
   *  frame needs a stand-in (`false`). */
  twins?: boolean
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
 * lobe and contact shadow code only where the program has them (`twinOf`) — compiles beside it, from the same frame: a
 * scene that passes `TILE_LIGHTS` lights, or whose light takes a shadow or is a rectangle, finds
 * its program ready as soon as a single program would have been, and never falls back to the
 * unlit view where one program would not. A scene whose surfaces carry no lobe never compiles the
 * lobe code: a lobe that appears later asks for its program then, its frames held meanwhile, never
 * lit by a lobeless one (`askLobedPrograms`). No frame waits for that twin (`settle`) nor is
 * redrawn at its arrival (`onReady`) until one asks for it. A failed compile is said (`onFailure`) once, never retried; a failed twin stands in
 * for by the program with every code path, compiled then.
 *
 * `build` compiles one: the opaque lit passes' (`createContractVariants`), and the transparent
 * pass's (`../../blend/pipelines.ts`), which light with
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
    /** The program a frame that asks for this one would be lent, none if none is ready: a pure read, it asks and compiles nothing (`pick` does). */
    lent(bounce: boolean, narrow: boolean, set: number) {
      return table.lending(bounce, narrow, set)
    },
    /** The slot of this program as it stands (compiled, compiling, failed), a pure read: it asks and compiles nothing (`exact` does), and a failed one is not replaced by its stand-in. */
    slot(bounce: boolean, narrow: boolean, set: number) {
      return table.variant(narrow, set, bounce)
    },
    /** The program of this set once compiled — its stand-in's if it failed —, asked now. */
    async ready(bounce: boolean, narrow: boolean, set: number) {
      const variant = table.ask(bounce, narrow, set)
      await variant.pending
      return variant.program
    },
    /** Starts the program a first frame asks for and its wide twin, before any frame does,
     *  settled once both landed or failed: prepare compiles the lit program beside the others, and
     *  no first frame starts a compile (#1362); without `twins`, the first program alone. */
    precompile(bounce: boolean, key: ContractKey) {
      const set = cutsIn(key)
      table.compile(bounce, key.narrow, set)
      const started = [
        table.variant(key.narrow, set, bounce).pending,
        table.variant(false, twinOf(set), bounce).pending,
      ]
      return Promise.all(started).then(() => {})
    },
    /** The asked program itself, compiling it: its `program` once compiled (its stand-in's where it failed), its `pending` compile
     *  before; never the one lent in its place. */
    exact(bounce: boolean, narrow: boolean, set: number) {
      return table.ask(bounce, narrow, set)
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
    if (special && this.options.twins !== false) this.compile(bounce, false, twin, onFailure)
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

/** What the opaque lit passes' programs are told: a failed compile (`onFailure`). */
type ContractVariantOptions = {
  onFailure?: (error: unknown) => void
}
/** The lit programs: when `precompile`, the one a first frame asks for (`key`) compiles from the
 *  start beside the unlit one (#1362), without bounce always, with it too when `bounce`;
 *  `onFailure` hears any contract compile that fails, precompiled or asked later. `localFog`, the
 *  project switch `localFogVolumeSupport`: whether the fog pass holds the local fog volumes' code
 *  (it does unless false, `../fog/fogPass.ts`). */
export type LitPrograms = ContractVariantOptions & {
  precompile: boolean
  bounce: boolean
  key: ContractKey
  /** The scene writes the toon data (`DirectLightResources.toonUnified`): the programs compiled from the start are the toon table's. */
  toon?: boolean
  localFog?: boolean
}
/** One table of lit programs, over whether its programs hold the sky light's occlusion and the indirect capsule shadows. */
function litTable(
  device: GPUDevice,
  bindings: DeferredBindings,
  { skyShadowing, capsule, toon }: { skyShadowing: boolean; capsule: boolean; toon: boolean },
  { onReady, onFailure }: { onReady?: () => void } & ContractVariantOptions,
  ready?: () => Promise<unknown>,
) {
  return createLitVariants<LitProgram>(
    async (bounce, cuts) => {
      // The toon data is no cut: the table that holds it makes its programs write it.
      const key = toon ? { ...cuts, toonData: true } : cuts
      const [program] = await Promise.all([
        createLitProgram(
          device,
          {
            bounce,
            key,
            skyShadowing,
            capsule,
            label: `${bounce ? 'BOUNCE' : 'DIRECT'}${variantLabel(key)}${skyShadowing ? '_SKY_SHADOWING' : ''}${capsule ? '_CAPSULE' : ''}`,
          },
          bindings,
        ),
        ready?.(),
      ])
      return program
    },
    { onReady, onFailure, dispose: (program) => program.release() },
  )
}

/** The lit programs of one table. */
type LitTable<P> = ReturnType<typeof createLitVariants<P>>

/**
 * THE ONE RESOLVER of the lit program a frame asks for: `pick`, `awaited` and the asks of the per-light and bounce programs all read it, so that the frame is held for exactly
 * the program it will be lent. With `toon`, the toon table's program (that of the sky light's occlusion and the capsule shadows where one is ready, else the plain toon table's),
 * lent only once its toon diffuse pipelines are compiled (`toonReady`): none before, the frame held on those pipelines (`asking`: the program whose pipelines `pick` and `awaited` ask held,
 * `askToon`, the one the frame would be lent; a resolve that only warms a program holds nothing), never a program without the toon data that would show the per-light ramp and then switch. A toon table that can never light, or not yet — its compile failed, or the device refused a
 * toon pipeline, for good or to be tried again (`toonRefused`) — gives way to the non-toon tables', with no toon data: declared by the refusal, never unlit nor black; the toon program
 * takes over when it lands. Without toon, the table with the sky light's occlusion and the indirect capsule shadows asked where one is ready, else the plain one's; never a program that lacks
 * them while another has them. `exact` is the program of this set itself in the first table `pick` reads: what the image will bind once compiled, never the one lent while it compiles. `peek` is the same rule as a pure read, for a question of whether a program is lent.
 */
export function litResolver<
  P extends {
    toonReady: boolean
    toonRefused: boolean
    askToon: () => void
    /** Settles once the program's toon pipelines, those not already refused, have each landed or been refused, asking no frame to wait (a retry that lands is heard by the device: `onRetryLanded`). */
    toonLanded?: () => Promise<unknown>
  },
>(
  plain: LitTable<P>,
  tableFor: (skyShadowing: boolean, capsule: boolean, toon: boolean) => LitTable<P>,
  /** Heard when the toon pipelines of a program the resolve passed over (another toon program is lent meanwhile) have first landed or been refused: the view redraws with the program it prefers, as a view at rest asks nothing again. The watch is made once a program, and a pipeline refused later lands on a retry heard by the device (`onRetryLanded`, the one path of a retry): nothing is re-armed here. */
  landed?: () => void,
) {
  const watched = new WeakSet<P>()
  /** The one rule, read with `asks` (it asks the programs and starts their compile) or without (a pure read of what stands: `peek`). */
  const resolverOf =
    (asks: boolean) =>
    (
      bounce: boolean,
      narrow: boolean,
      set: number,
      onFailure?: (error: unknown) => void,
      skyShadowing = false,
      capsule = false,
      toon = false,
    ) => {
      const lend = (table: LitTable<P>) =>
          asks ? table.pick(bounce, narrow, set, onFailure) : table.lent(bounce, narrow, set),
        slotOf = (table: LitTable<P>) =>
          asks ? table.exact(bounce, narrow, set) : table.slot(bounce, narrow, set)
      const sky = skyShadowing && !bounce
      if (toon) {
        const own = tableFor(sky, capsule, true),
          base = tableFor(false, false, true),
          exact = slotOf(own)
        let pending: Promise<unknown> | undefined,
          asking: P | undefined,
          waiting = false
        for (let i = 0; i < (own === base ? 1 : 2); i++) {
          const table = i ? base : own,
            program = lend(table),
            compile = i ? slotOf(table) : exact
          if (program?.toonReady) return { program, exact, pending: undefined, asking: undefined }
          if (asks && landed && program?.toonLanded && !watched.has(program)) {
            watched.add(program)
            void program.toonLanded().then(landed)
          }
          // Waited for while its compile, or its pipelines' first compile, is in flight; given up on once refused.
          if (program ? program.toonRefused : compile.failed && !compile.program) continue
          asking ??= program
          pending ??= compile.pending
          waiting = true
        }
        if (waiting) return { program: undefined, exact, pending, asking }
      }
      const table = sky || capsule ? tableFor(sky, capsule, false) : plain,
        own = table === plain ? undefined : lend(table),
        program = own ?? lend(plain)
      return {
        program,
        exact: slotOf(table),
        pending: program ? undefined : slotOf(plain).pending,
        asking: undefined,
      }
    }
  return Object.assign(resolverOf(true), {
    /** The same resolution as a pure read: it asks no program, starts no compile and marks nothing asked (a failed compile's stand-in is not asked either). For a read of whether the program is lent. */
    peek: resolverOf(false),
  })
}

/**
 * The lighting passes' lit programs (`createLitVariants`): the sun's, the local lights' and the
 * indirect light's passes (`createLitProgram`) at each key. The program without bounce has a
 * second table, made at the first image that applies the sky light's distance-field occlusion (`pick`'s `skyShadowing`): the
 * programs there hold the code that reads it (`indirectPassWgsl`), and no program of the first table does. While one
 * of them compiles, the image is lit by the first table's, without the occlusion. `ready`, when
 * given, is awaited by every compile: what a lit image needs besides the passes, as its composition.
 */
export function createContractVariants(
  device: GPUDevice,
  bindings: DeferredBindings,
  onReady?: () => void,
  { onFailure }: ContractVariantOptions = {},
  ready?: () => Promise<unknown>,
) {
  const tableOf = (skyShadowing: boolean, capsule: boolean, toon: boolean) =>
    litTable(device, bindings, { skyShadowing, capsule, toon }, { onReady, onFailure }, ready)
  const plain = tableOf(false, false, false)
  // The tables that hold the code of the sky light's occlusion, of the indirect capsule shadows and of the toon data, by which of the three they hold, each made at the first image that asks.
  const others = new Map<string, ReturnType<typeof tableOf>>()
  const tableFor = (skyShadowing: boolean, capsule: boolean, toon: boolean) => {
    if (!skyShadowing && !capsule && !toon) return plain
    const key = `${skyShadowing}${capsule}${toon}`
    let table = others.get(key)
    if (!table) others.set(key, (table = tableOf(skyShadowing, capsule, toon)))
    return table
  }
  const resolveLit = litResolver(plain, tableFor, onReady)
  return {
    ...plain,
    resolve: resolveLit,
    /** The resolution of `resolve` as a pure read (`litResolver`). */
    peek: resolveLit.peek,
    /** The program to light this frame with (`litResolver`). */
    pick(...key: Parameters<typeof resolveLit>) {
      const { program, asking } = resolveLit(...key)
      asking?.askToon()
      return program
    },
    /** The compile a frame asking for this program must wait for (`litResolver`). */
    awaited(...key: Parameters<typeof resolveLit>) {
      const { pending, asking } = resolveLit(...key)
      asking?.askToon()
      return pending
    },
    /** Starts the first frame's program and its twin (`createLitVariants`), in the toon table where the scene is toon. */
    precompile(bounce: boolean, key: ContractKey, toon = false) {
      return tableFor(false, false, toon).precompile(bounce, key)
    },
    settle: () =>
      Promise.all([plain.settle(), ...[...others.values()].map((t) => t.settle())]).then(() => {}),
    release() {
      plain.release()
      for (const table of others.values()) table.release()
    },
  }
}
