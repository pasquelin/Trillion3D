// The pool's kernels (`poolWgsl.ts`) run as JavaScript (`shaderRun`), a thread after the other in the order the pass dispatches them: its
// slots, its table, its marks and its queue as plain arrays a test reads, the images it is given one at a time.
import {
  BOUNCE_SETTINGS,
  probeQueueFor,
  probeQueueShapeOf,
} from '../../../../../sdk-core/src/bounce/contracts.ts'
import {
  createBounceCascades,
  type BounceCascades,
} from '../../../../../sdk-core/src/bounce/cascades.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { simulatedAtlas, ATLAS_CALLS } from '../atlas.fixture.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { PROBE_QUEUE_WORDS } from '../probes/probeQueueWgsl.ts'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { POOL_SHADER } from './poolWgsl.ts'
import { POOL_SLOT, POOL_WORK, freshWork, poolLimits, poolShapeOf } from './poolLayout.ts'

/** The probes the fixture's pool queues at most, whatever its slots: the world's pool. */
export const POOL_QUEUE = BOUNCE_SETTINGS.probePool

/** The frames a probe nothing reads is kept by default, and the factor the temporary atlas is divided by: the screen probes' own. */
const { framesToKeepProbes: KEEP_FRAMES, temporaryAtlasDownsample: ATLAS_DOWNSAMPLE } =
  screenProbeSettings().cache

/** The probes a frame queues for `budget` at the default factor of the temporary atlas (`probeQueueFor`). */
export const queueFor = (budget: number) => probeQueueFor(budget, ATLAS_DOWNSAMPLE)

/** A probe the pool queued: its slot, its level, whether it is a first trace (read from the slot as the pass found it), whether its map is
 *  traced at half its side, its cell. */
export type QueuedProbe = {
  slot: number
  level: number
  fresh: boolean
  down: boolean
  cell: number[]
}

/** What an image asks of the pool: its rank (the frame number), the eye, whether the lights changed, whether it is a full update (every probe
 *  given back and traced, at no budget), the budget in probes (`probesPerFrame`), the frames a probe nothing reads is kept (the default of the screen probes' settings without) and the squares of
 *  the distances, in metres, the cost of a probe changes at: past the first a quarter of a map, within the second four maps (the pass's
 *  own are the screen probes' settings, `pool.ts`) and, under an orthographic view, the direction it looks along. */
export type PoolImage = {
  rank: number
  eye: ArrayLike<number>
  restart?: boolean
  full?: boolean
  budget: number
  keep?: number
  distances?: [number, number]
  /** The direction an orthographic view looks along; none under a perspective one. */
  forward?: number[]
}

const NAMES = [
  'clearWork',
  'stampChange',
  'clearIndirection',
  'updateProbes',
  'allocateProbes',
  'countProbes',
  'cutProbes',
  'emitProbes',
  'tallyProbes',
  'publishTable',
] as const

/** The remainders of a cell modulo the side: the entry of the table that names it, in the order level, z, y, x. */
const poolEntryOf = (cascades: BounceCascades, level: number, x: number, y: number, z: number) => {
  const { size } = cascades
  const wrap = (v: number) => ((v % size) + size) % size
  return ((level * size + wrap(z)) * size + wrap(y)) * size + wrap(x)
}

/** The cells a bitmap of marks names, as the levels hold them now: each bit an entry — the remainders of a cell modulo the side, in the order
 *  level, z, y, x —, the cell of the level's cube those remainders name. */
export function markedCells(cascades: BounceCascades, bits: Uint32Array) {
  const { size, cells } = cascades
  const cells3 = [] as { level: number; cell: number[] }[]
  for (let entry = 0; entry < cascades.levels.length * cells; entry++) {
    if (!((bits[entry >> 5] >>> (entry & 31)) & 1)) continue
    const level = Math.floor(entry / cells)
    const rest = entry - level * cells
    const remainder = [
      rest % size,
      Math.floor(rest / size) % size,
      Math.floor(rest / (size * size)),
    ]
    const { base } = cascades.levels[level]
    cells3.push({
      level,
      cell: remainder.map((r, axis) => base[axis] + ((((r - base[axis]) % size) + size) % size)),
    })
  }
  return cells3
}

/**
 * The pool over `cascades` with `slotCount` slots, its own state and its kernels run as the shipped text. `marked` reads the cells
 * marked since the last image, `image` runs the pass (the marks are the image's alone: cleared once it ran) and answers the probes
 * it queued. The published table, where given, takes the table the pass publishes.
 */
export function simulatedPool(
  cascades: BounceCascades,
  slotCount: number,
  published?: ReturnType<typeof simulatedAtlas>,
) {
  const slots = new Uint32Array(slotCount * POOL_SLOT.words)
  const shape = poolShapeOf(cascades)
  const table = new Uint32Array(shape.entries)
  const work = freshWork(slotCount)
  const marks = new Uint32Array(shape.markWords)
  const probeQueue = new Uint32Array(POOL_QUEUE * PROBE_QUEUE_WORDS)
  const bounce: Record<string, unknown> = {
    counts: [cascades.size, cascades.levels.length, cascades.cells, slotCount],
    frame: [1, 0, 0, 0],
    eye: [0, 0, 0, 0],
    forward: [0, 0, 0, 0],
    levels: [],
  }
  const pool = { room: 0, keep: 0, cap: 0, fullUpdate: 0, distances: [0, 0] }
  const kit = shaderRun<Record<(typeof NAMES)[number], (id?: number[]) => void>>(
    POOL_SHADER,
    [...NAMES],
    {
      ...ATLAS_CALLS,
      bounce,
      pool,
      slots,
      table,
      work,
      marks,
      probeQueue,
      publishedOut: published,
      // A cell's coordinates are signed words in the slots and the queue.
      bitcast_u32: (x: number) => x >>> 0,
      bitcast_vec3i: (v: number[]) => v.map((x) => x | 0),
    },
  )
  const over = (name: (typeof NAMES)[number], threads: number) => {
    for (let id = 0; id < threads; id++) kit[name]([id, 0, 0])
  }
  /** A kernel a slot, over the groups `sizeSlots` writes from `high`. */
  const overSlots = (name: (typeof NAMES)[number]) =>
    over(name, Math.ceil(work[POOL_WORK.high] / WORKGROUP_THREADS) * WORKGROUP_THREADS)
  return {
    slots,
    table,
    work,
    marks,
    /** The cell `x, y, z` of `level` is read by the image. */
    mark(level: number, x: number, y: number, z: number) {
      const entry = poolEntryOf(cascades, level, x, y, z)
      marks[entry >> 5] |= 1 << (entry & 31)
    },
    /** What the last pass counted: probes alive, those holding nothing, those not traced since the lights last changed, the marks refused in all. */
    tally: () => ({
      live: work[POOL_WORK.live],
      unfilled: work[POOL_WORK.unfilled],
      refreshing: work[POOL_WORK.refreshing],
      refused: work[POOL_WORK.refused],
      free: work[POOL_WORK.free],
      marked: work[POOL_WORK.marked],
    }),
    /** The slot + 1 the lit passes read for the entry (zero for none). */
    visible: (entry: number) => table[entry] >>> 16,
    /** One image's pass, its kernels in order; the probes it queued. */
    image(image: PoolImage): QueuedProbe[] {
      bounce.frame = [1, 0, image.rank, 0]
      bounce.eye = [...Array.from(image.eye), 0]
      bounce.forward = image.forward ? [...image.forward, 1] : [0, 0, 0, 0]
      bounce.levels = cascades.levels.map(({ base, spacing }) => ({ base: [...base], spacing }))
      const full = image.full ?? false
      Object.assign(
        pool,
        poolLimits(
          image.budget,
          full,
          probeQueueShapeOf(image.budget, ATLAS_DOWNSAMPLE, full, POOL_QUEUE).probes,
        ),
      )
      pool.keep = image.keep ?? KEEP_FRAMES
      pool.distances = image.distances ?? [40 * 40, 0]
      over('clearIndirection', table.length)
      overSlots('updateProbes')
      over('clearWork', POOL_WORK.stack)
      if (image.restart) kit.stampChange()
      over('allocateProbes', shape.markWords)
      marks.fill(0)
      overSlots('countProbes')
      // The probes first traced in this pass: those the slots hold never traced as the pass finds them.
      const first = new Set<number>()
      for (let slot = 0; slot < slots.length / POOL_SLOT.words; slot++)
        if (
          slots[slot * POOL_SLOT.words + POOL_SLOT.owner] &&
          !slots[slot * POOL_SLOT.words + POOL_SLOT.tracedAt]
        )
          first.add(slot)
      kit.cutProbes()
      overSlots('emitProbes')
      overSlots('tallyProbes')
      if (published) over('publishTable', shape.tableTexels)
      const queued = Math.min(work[POOL_WORK.queued], POOL_QUEUE)
      return Array.from({ length: queued }, (_, at) => {
        const word = probeQueue[at * PROBE_QUEUE_WORDS]
        return {
          slot: word & 0xffff,
          level: (word >>> 16) & 0xff,
          fresh: first.has(word & 0xffff),
          down: (word & (1 << 24)) !== 0,
          cell: [1, 2, 3].map((word) => probeQueue[at * PROBE_QUEUE_WORDS + word] | 0),
        }
      })
    },
  }
}

/** The cells, from the one the eye is in, a city-sized scene reads around it along each axis (`cityPool`): more cells in the finest level
 *  than the queue holds. */
export const CITY_REACH = 7

/** A city-sized scene read around an eye: every cell within `CITY_REACH` of the cell the eye is in, in the two
 *  finest levels, marked; the pool run as its shipped kernels, and a pass of it (`image`) answering the probes it queued —
 *  each its slot, its level, whether it is a first trace, its cell. */
export function cityPool(eye: number[]) {
  const cascades = createBounceCascades([0, 0, 0, 200, 30, 200])
  cascades.follow(eye)
  const pool = simulatedPool(cascades, cascades.probes)
  const read = () => {
    for (let level = 0; level < 2; level++) {
      const base = cascades.levels[level].spacing
      const at = eye.map((v) => Math.floor(v / base))
      for (let dz = -CITY_REACH; dz <= CITY_REACH; dz++)
        for (let dy = -CITY_REACH; dy <= CITY_REACH; dy++)
          for (let dx = -CITY_REACH; dx <= CITY_REACH; dx++)
            pool.mark(level, at[0] + dx, at[1] + dy, at[2] + dz)
    }
  }
  return { cascades, pool, read }
}

/** The levels around an eye at `eye` and a pool of `capacity` probes over them. */
export function poolAt(eye: number[], capacity = 64) {
  const cascades = { ...createBounceCascades([0, 0, 0, 10, 10, 10]), probes: capacity }
  cascades.follow(eye)
  const pool = simulatedPool(cascades, capacity)
  /** The cell `dx, dy, dz` cells from the one the eye is in, in the level. */
  const around = (level: number, dx: number, dy: number, dz: number) => {
    const spacing = cascades.levels[level].spacing
    return [dx, dy, dz].map((d, axis) => Math.floor(eye[axis] / spacing) + d) as [
      number,
      number,
      number,
    ]
  }
  const entryOf = (level: number, [x, y, z]: number[]) => poolEntryOf(cascades, level, x, y, z)
  return { cascades, pool, around, entryOf }
}
