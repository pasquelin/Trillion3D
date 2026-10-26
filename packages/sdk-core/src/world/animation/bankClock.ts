/**
 * THE CLOCK OF A SCENE'S ANIMATION BANKS: the second each of its items — tracks — draws, on the
 * CPU, the GPU evaluating every joint of a track at it (`packages/sdk-browser/src/deformation/`).
 * Every instance of one item is in one pose. A track starts at its item's second and advances by
 * its play rate times the world's seconds times `timeScale` (the run-time setting
 * `animationBankTimeScale`, written by the session that draws it); a looping track wraps into its
 * length, another holds at its ends. Its length is its bake's frames less one over its rate: the
 * last key is where it ends.
 *
 * The step order is the reference's: a frame draws the second the track held when the frame began,
 * then the track advances by that frame's seconds — so each step first takes the pending second
 * (`next`) as the one drawn (`time`), the one drawn before as the previous (`previous`, which the
 * temporal pass reprojects by), then advances the pending one. The clocks advance with the scene's
 * clips (`advanceMixers`): once a world step for each clock one of whose owners — the roots it plays
 * under — the world's scene holds. A clock whose owners are all gone leaves the registry.
 */
import type { DecodedBanks } from '../../scene/core/animationBanks.ts'
import type { Object3D } from '../object/object3d.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The clock of one scene's banks (`createBankClock`). */
export type BankClock = {
  /** Per item, the second it draws this frame. */
  readonly time: Float64Array
  /** Per item, the second it drew the frame before. */
  readonly previous: Float64Array
  /** The scale of the world's seconds the tracks advance by. */
  timeScale: number
  /** Plays under `owner`: the clock advances while a world's scene holds it. */
  own(owner: Object3D): void
}

/** What the registry steps a clock by. */
type Held = {
  readonly clock: BankClock
  readonly owners: WeakRef<Object3D>[]
  /** Advances every track by `seconds`; whether one still moves. */
  step(seconds: number): boolean
}

/** Every clock with an owner. */
const clocks = new Set<Held>()

/** `position` brought into a track of length `length`: wrapped when it loops — into `[0, length)`,
 *  0 for a track of no length —, held at its ends otherwise. */
function wrapped(position: number, length: number, looping: boolean) {
  if (!looping) return clamp(position, 0, length)
  if (length === 0) return 0
  const into = position % length
  return into < 0 ? into + length : into
}

/** The clock of `banks`' items, each at its item's second. */
export function createBankClock(banks: DecodedBanks): BankClock {
  const count = banks.items.length
  const lengths = Float64Array.from(banks.items, (item) => {
    const { frames, rate } = banks.bakes[item.bake]
    return (frames - 1) / rate
  })
  const start = Float64Array.from(banks.items, (item) => item.position)
  const next = start.slice()
  const clock: BankClock = {
    time: start.slice(),
    previous: start.slice(),
    timeScale: 1,
    own(owner) {
      held.owners.push(new WeakRef(owner))
      clocks.add(held)
    },
  }
  const held: Held = {
    clock,
    owners: [],
    step(seconds) {
      let moving = false
      for (let i = 0; i < count; i++) {
        const { playRate, looping } = banks.items[i]
        clock.previous[i] = clock.time[i]
        clock.time[i] = next[i]
        next[i] = wrapped(next[i] + playRate * seconds * clock.timeScale, lengths[i], looping)
        moving ||= next[i] !== clock.time[i] || clock.previous[i] !== clock.time[i]
      }
      return moving
    },
  }
  return clock
}

/** Whether `node` hangs under `scene`, or is it. */
function under(node: Object3D, scene: Object3D) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) if (walk === scene) return true
  return false
}

/**
 * Steps by `seconds` every clock an owner of which `scene` holds, once; a clock whose owners are
 * all collected leaves the registry. Returns whether a track still moves: the world draws on.
 */
export function advanceBankClocks(scene: Object3D, seconds: number) {
  let moving = false
  for (const held of clocks) {
    let shown = false,
      live = 0
    for (const ref of held.owners) {
      const owner = ref.deref()
      if (!owner) continue
      held.owners[live++] = ref
      shown ||= under(owner, scene)
    }
    held.owners.length = live
    if (!live) clocks.delete(held)
    else if (shown) moving = held.step(seconds) || moving
  }
  return moving
}
