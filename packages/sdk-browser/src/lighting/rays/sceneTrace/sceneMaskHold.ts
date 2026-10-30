import { NO_SCENE_MASKS, type SceneMaskPrograms } from './sceneMaskPrograms.ts'

/** How a pass makes its kernels over a set. The maker of a pass keyed by a text (`heldMakerOf`) may carry what frees the bookkeeping kept for that key, counted by the holds that use it: a hold calls `acquire` when its first pass naming the maker comes and `release` when its last is forgotten, and the bookkeeping is freed when no hold is left (several holds share a device). */
export type HeldMake<K> = ((programs: SceneMaskPrograms) => K) & {
  acquire?: () => void
  release?: () => void
}

/** What a consumer of the scene trace asked of the held programs: how to make its kernels over a set, whether they are ready and whether their own compile is still in flight, the kernels it made for each set, whether it ran since the last settling, for how many settlings it has not run, and the last kernels it had ready. */
interface Consumer<K = unknown> {
  make: HeldMake<K>
  ready: (kernel: K) => boolean
  pending: (kernel: K) => boolean
  /** The kernels this consumer made, by set: an older candidate is looked up here, never made. */
  made: WeakMap<SceneMaskPrograms, K>
  used: boolean
  idle: number
  /** The kernels the pass last had ready, and their set: it runs on them while the held set's kernels compile (the layouts do not depend on the programs). */
  lastReady: { programs: SceneMaskPrograms; kernel: K } | undefined
  /** The group of passes that must run on one set (`use`), none for a pass that stands alone. */
  group: string | undefined
  /** The sets whose kernels this pass failed to compile: dropped with the pass. */
  failed: WeakSet<SceneMaskPrograms>
  /** The refusals not said yet because the kernels of the set held before were not ready either, one for each refused set that is still held or a candidate: each is said once those kernels are ready, if the refused ones are neither ready nor compiling. */
  owed: { refused: SceneMaskPrograms; before: SceneMaskPrograms }[]
}

/** The kernels of a pass for a set of programs, and that set: what the pass keys its own history on. */
export interface HeldKernel<K> {
  readonly kernel: K
  readonly programs: SceneMaskPrograms
}

/** Whether a kernel (or a stage) that compiles off the frame has finished. */
export const isReady = <K extends { readonly ready: boolean }>(kernel: K) => kernel.ready

/** Whether the compile of a kernel (or a stage) that compiles off the frame is still in flight, neither finished nor refused. */
export const isPending = <K extends { readonly pending: boolean }>(kernel: K) => kernel.pending

/** `isReady` for kernels that hold their compile in `stages`. */
export const stagesReady = (kernel: { readonly stages: { readonly ready: boolean } }) =>
  kernel.stages.ready

/** `isPending` for kernels that hold their compile in `stages`. */
export const stagesPending = (kernel: { readonly stages: { readonly pending: boolean } }) =>
  kernel.stages.pending

/** The group of the passes whose results are read together, as the rays of the hardware reflections and the lighting of their hits (`MaskHold.use`). */
export const REFLECTION_HIT_GROUP = 'reflection hits'

/** The settlings a pass may stay away before the hold forgets it (and what its closures name). */
const IDLE_SETTLINGS = 600

/** The wanted sets the hold keeps compiling at most, newest last: the older ones are dropped. */
const CANDIDATES = 3

/**
 * THE GRAPH PROGRAMS THE ANY-HIT TEST CUTS BY, HELD (`SceneTrace.maskHold`): every pass that casts rays through the scene's triangles asks its kernels of the held set (`use`), never of the
 * set the rasters hold now. When a join of the graph changes the set, the held one stands, the rays staying traced, until the kernels of every pass that ran in the last image
 * are ready for a wanted set: all of them are then swapped at once, so that no pass reads a program set another has not. Only the newest wanted set is started compiling; while more graphs
 * join, the sets before it stay candidates (a few, newest first) for the swap, so that a stream of joins still lands on the newest set that is ready. A pass that did not run in the last
 * image does not hold the swap back: it keeps running on the last set it had ready until its kernels for the held one have compiled. A pass whose kernels failed to compile for a wanted set (they are
 * not ready and none of their own compiles is in flight: what else compiles on the device is not waited for) is settled as failed: it is said once for the set (`report`, whatever the passes that come and go), and only where its kernels for the set held before were ready (else the refusal is not the mask's), it stays on
 * its last ready set and does not hold the swap back. A refused compile is tried again off the frame by the kernels themselves (`retryAfter`), and a pass that gets ready after it is swapped to as any other.
 * The hold outlives the scene trace it serves (`ensureSceneTrace`): a trace made again keeps the held set, the candidates and the kernels the passes made.
 */
export function createMaskHold() {
  const consumers = new Map<string, Consumer>()
  /** The passes whose refusal was said, by the set: said once each, whatever the passes that come and go (an evicted pass that comes back is not told again); struck off only when the maker changes. */
  const said = new WeakMap<SceneMaskPrograms, Set<string>>()
  /** The sets wanted since the swap, oldest first, the newest last. */
  let candidates: SceneMaskPrograms[] = []
  let held: SceneMaskPrograms | undefined
  let settled = -1
  let disposed = false
  const reportOnce = (
    name: string,
    programs: SceneMaskPrograms,
    report: ((pass: string) => void) | undefined,
  ) => {
    const names = said.get(programs) ?? new Set<string>()
    said.set(programs, names)
    if (names.has(name)) return
    names.add(name)
    report?.(name)
  }
  /** The refusals said of pass `name` struck off the sets still wanted (the older ones go with their sets): a maker that changes (a device replaced) makes the pass anew, and its refusal is said anew. */
  const forgetSaid = (name: string) => {
    for (const set of [held, ...candidates]) if (set) said.get(set)?.delete(name)
  }
  /** Whether the kernels of `consumer` over `programs` are settled: ready, or failed to compile (said once to `report`). Made now for the newest set (`start`), only looked up for an older one, which was started while it was the newest. */
  const settledOver = (
    name: string,
    consumer: Consumer,
    programs: SceneMaskPrograms,
    start: boolean,
    report: ((pass: string) => void) | undefined,
  ) => {
    let kernel = consumer.made.get(programs)
    if (kernel === undefined && start)
      consumer.made.set(programs, (kernel = consumer.make(programs)))
    // Not ready and none of their own compiles in flight is a refusal, which the kernels try again themselves.
    if (kernel === undefined || consumer.ready(kernel)) return kernel !== undefined
    if (consumer.failed.has(programs)) return true
    if (consumer.pending(kernel)) return false
    consumer.failed.add(programs)
    // A refusal the pass met just as well over the set held (its kernels not ready either) is not the mask's: the pipeline's own refusal is already said. It is said later if those kernels get ready while this one stays refused.
    const before = held && consumer.made.get(held)
    if (before !== undefined && consumer.ready(before)) reportOnce(name, programs, report)
    else if (held) consumer.owed.push({ refused: programs, before: held })
    return true
  }
  /** Whether every pass that ran has its kernels settled for `programs`. */
  const allSettled = (
    programs: SceneMaskPrograms,
    start: boolean,
    report: ((pass: string) => void) | undefined,
  ) => {
    let settled = true
    // Every pass is asked, not only up to the first that is not settled: all of their kernels compile together.
    for (const [name, consumer] of consumers)
      if (consumer.used) settled = settledOver(name, consumer, programs, start, report) && settled
    return settled
  }
  /** The kernels of `consumer` over `programs` if they are ready, made now where it did not yet and `start`. */
  const readyOver = (consumer: Consumer, programs: SceneMaskPrograms, start: boolean) => {
    if (consumer.lastReady?.programs === programs && consumer.ready(consumer.lastReady.kernel))
      return consumer.lastReady.kernel
    let kernel = consumer.made.get(programs)
    if (kernel === undefined && start)
      consumer.made.set(programs, (kernel = consumer.make(programs)))
    return kernel !== undefined && consumer.ready(kernel) ? kernel : undefined
  }
  /** Whether a pass names `make`. */
  const named = (make: HeldMake<unknown>) =>
    [...consumers.values()].some((peer) => peer.make === make)
  /** The set each group runs on in this image, decided once (at the settling, else at the group's first use): a pass of the group answers from it. None is a group that does not run. */
  const decided = new Map<string, SceneMaskPrograms | undefined>()
  /**
   * The set the passes of `group` run on: `programs` where every pass the group knows that had kernels ready before has them ready now (made now where it did not yet, for the passes that ran in this image), else the newest set every
   * one of them last had ready, none if there is no such set. The members are all the passes known to the group, not only those that asked first in the image: a pass back after a pause counts at once. A pass with nothing ready yet
   * (new, or its compile refused from the start) does not veto the others: it does not run until its kernels are ready on the set the group runs on.
   */
  const groupSetOf = (group: string, programs: SceneMaskPrograms) => {
    const members = [...consumers.values()].filter((peer) => peer.group === group)
    const onHeld = new Set(members.filter((member) => readyOver(member, programs, member.used)))
    // Only the passes that run vote: one idle never compiles the new set, so it could not hold the group back for as long as it is remembered (it gets none when it comes back, until its kernels are ready on the set the group runs on).
    const voters = members.filter((member) => member.used && member.lastReady)
    if (voters.every((member) => onHeld.has(member))) return programs
    // Each voter's last set, as it was left.
    for (const { lastReady } of voters)
      if (lastReady && voters.every((member) => readyOver(member, lastReady.programs, false)))
        return lastReady.programs
    return undefined
  }
  const decideGroup = (group: string, programs: SceneMaskPrograms) => {
    const set = groupSetOf(group, programs)
    decided.set(group, set)
    return set
  }
  /**
   * The kernels (or stages) `make` makes over the held set for the pass `id` under the kernel key `key` (what tells apart the kernels the pass builds from its views and settings: two keys are two
   * passes to the swap), which `ready` says are compiled, with the set they were made over; the pass is remembered as one the next swap waits for. Where they are not compiled yet and the pass
   * had kernels ready for an earlier set under the same key, those are returned instead. A pass keys its history on the set returned. `pending` says whether the compile of the kernels is still in flight
   * (what `settle` tells a refusal from): where it is left out, kernels not ready are taken as compiling. The passes of one `group` (passes whose results are read together, as the rays of a reflection and
   * the lighting of their hits) run on one set, decided once an image (at the settling): the held one when every pass of the group that ran has its kernels ready for it, else the newest set every one last had ready. A pass with no kernels ready yet never vetoes the others: it gets none until its kernels are ready on the set the group runs on.
   */
  function use<K>(
    id: string,
    key: string,
    make: HeldMake<K>,
    ready: (kernel: K) => boolean,
    pending?: (kernel: K) => boolean,
  ): HeldKernel<K> | undefined
  function use<K>(
    id: string,
    key: string,
    make: HeldMake<K>,
    ready: (kernel: K) => boolean,
    pending: ((kernel: K) => boolean) | undefined,
    group: string,
  ): HeldKernel<K> | undefined
  function use<K>(
    id: string,
    key: string,
    make: HeldMake<K>,
    ready: (kernel: K) => boolean,
    pending: (kernel: K) => boolean = () => true,
    group?: string,
  ): HeldKernel<K> | undefined {
    // A hold dropped with its owner serves nobody and keeps nothing of the makers it was given.
    if (disposed) return undefined
    const name = `${id}|${key}`
    let consumer = consumers.get(name) as Consumer<K> | undefined
    if (consumer) {
      // A maker that changes is acquired by the hold and the old one released, as for a pass that comes and goes.
      if (consumer.make !== make) {
        if (!named(make)) make.acquire?.()
        const old = consumer.make
        consumer.make = make
        // What the old maker made (its pipelines, bound to its device) is not the new maker's: nothing of it is kept.
        consumer.made = new WeakMap()
        consumer.lastReady = undefined
        consumer.failed = new WeakSet()
        consumer.owed = []
        forgetSaid(name)
        if (!named(old)) old.release?.()
      }
      consumer.ready = ready
      consumer.pending = pending
      consumer.group = group
      consumer.used = true
    } else {
      if (!named(make)) make.acquire?.()
      consumers.set(
        name,
        (consumer = {
          make,
          ready,
          pending,
          made: new WeakMap(),
          used: true,
          idle: 0,
          lastReady: undefined,
          group,
          failed: new WeakSet(),
          owed: [],
        }) as Consumer,
      )
    }
    const programs = held ?? NO_SCENE_MASKS
    const kernel = make(programs)
    consumer.made.set(programs, kernel)
    if (group !== undefined) {
      // A group never mixes sets: it runs on the set decided for this image.
      const set = decided.has(group) ? decided.get(group) : decideGroup(group, programs)
      const common = set && (readyOver(consumer as Consumer, set, false) as K | undefined)
      if (set === undefined || common === undefined) return undefined
      if (consumer.lastReady?.programs !== set || consumer.lastReady.kernel !== common)
        consumer.lastReady = { programs: set, kernel: common }
      return consumer.lastReady
    }
    const last = consumer.lastReady
    if (ready(kernel)) {
      if (last?.programs !== programs || last.kernel !== kernel)
        consumer.lastReady = { programs, kernel }
      return consumer.lastReady!
    }
    return last ?? { kernel, programs }
  }
  return {
    /**
     * The set for the image `frame` out of the `wanted` one (the rasters'): `wanted` where nothing is held yet, else the newest of the sets wanted since the last swap for which every pass that
     * ran since the last settling has its kernels settled, else the set held. Asked again in the same image, it answers the same. `report` hears the name of a pass whose kernels failed to compile.
     */
    settle(wanted: SceneMaskPrograms, frame: number, report?: (pass: string) => void) {
      if (frame === settled && held) return held
      settled = frame
      decided.clear()
      if (!held || wanted === held) {
        held = wanted
        candidates = []
      } else {
        if (candidates[candidates.length - 1] !== wanted)
          candidates = [...candidates.filter((set) => set !== wanted), wanted].slice(-CANDIDATES)
        // The newest is asked first (it starts compiling); the older ones were started while they were the newest, so they are only looked up.
        for (let i = candidates.length - 1; i >= 0; i--) {
          const set = candidates[i]!
          if (allSettled(set, i === candidates.length - 1, report)) {
            held = set
            candidates = []
            break
          }
        }
      }
      // The group of every pass that ran runs on one set for the whole image; a pass that comes later in it answers from that set.
      for (const { group, used } of consumers.values())
        if (used && group !== undefined && !decided.has(group)) decideGroup(group, held)
      for (const [id, consumer] of consumers) {
        consumer.owed = consumer.owed.filter(({ refused, before }) => {
          const refusedKernel = consumer.made.get(refused),
            beforeKernel = consumer.made.get(before)
          if (refusedKernel === undefined || consumer.ready(refusedKernel)) return false
          if (refused !== held && !candidates.includes(refused)) return false
          if (consumer.pending(refusedKernel) || beforeKernel === undefined) return true
          if (!consumer.ready(beforeKernel)) return true
          reportOnce(id, refused, report)
          return false
        })
        if (consumer.used) consumer.idle = 0
        else if (++consumer.idle > IDLE_SETTLINGS) {
          consumers.delete(id)
          if (!named(consumer.make)) consumer.make.release?.()
        }
        consumer.used = false
      }
      return held
    },
    use,
    /** Forgets every pass, releasing the makers they named: the hold is dropped with its owner, and serves no pass after it (`use` answers none). */
    dispose() {
      disposed = true
      const makers = new Set([...consumers.values()].map((consumer) => consumer.make))
      consumers.clear()
      candidates = []
      decided.clear()
      for (const make of makers) make.release?.()
    },
  }
}

/** The hold of a scene trace. */
export type MaskHold = ReturnType<typeof createMaskHold>
