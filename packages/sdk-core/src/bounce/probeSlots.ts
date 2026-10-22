import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { BounceCascades } from './cascades.ts'
import { BOUNCE_SETTINGS } from './contracts.ts'

/** Entries of the table a texel of the probes' atlas holds, one lane each. */
export const TABLE_LANES = 4

/** The cell a slot holds when it holds none. */
const FREE = -1

/** The probes of the pool and the table that names them (`probePool.ts`). */
export type ProbeSlots = ReturnType<typeof createProbeSlots>

/** What the pool holds, counted: probes alive, those never traced, those short of their updates, and
 *  the marks refused for want of a probe. */
type Tally = { live: number; unfilled: number; refreshing: number; refused: number }

/** The state of the slots (`createProbeSlots`), which the operations below read and write. */
type SlotState = ReturnType<typeof slotState>

/**
 * The state of `cascades.probes` slots: per slot its cell's entry, the cell, the images that read it
 * and traced it last, the updates it took since the lights last changed (at most `settledTraces`);
 * per entry the slot + 1 that holds the cell (`held`) and the slot + 1 the GPU's table names
 * (`visible`); the stack of free slots; the queue of texels of the table that changed, each once.
 */
function slotState(cascades: BounceCascades) {
  const { size, cells, probes: capacity } = cascades
  if (capacity >= 0xffff) throw new RangeError(`probePool ${capacity}: a slot is 16 bits`)
  const entries = cascades.levels.length * cells
  const texels = ceilDiv(entries, TABLE_LANES)
  return {
    size,
    cells,
    capacity,
    texels,
    settle: BOUNCE_SETTINGS.settledTraces,
    owner: new Int32Array(capacity).fill(FREE),
    cell: new Int32Array(capacity * 3),
    usedAt: new Uint32Array(capacity),
    tracedAt: new Uint32Array(capacity),
    traces: new Uint16Array(capacity),
    held: new Uint16Array(entries),
    visible: new Uint16Array(entries),
    stack: Uint16Array.from({ length: capacity }, (_, at) => capacity - 1 - at),
    top: capacity,
    dirtyFlag: new Uint8Array(texels),
    dirtyQueue: new Uint32Array(texels),
    head: 0,
    waiting: 0,
    tally: { live: 0, unfilled: 0, refreshing: 0, refused: 0 } as Tally,
  }
}

/** The texel of the table holding `entry` is told to the GPU, once, until it is taken. */
function markDirty(s: SlotState, entry: number) {
  const texel = Math.floor(entry / TABLE_LANES)
  if (s.dirtyFlag[texel]) return
  s.dirtyFlag[texel] = 1
  s.dirtyQueue[(s.head + s.waiting++) % s.texels] = texel
}

/** Takes a slot for the cell `x, y, z` at `entry`, read at `frame`; false when none is left. */
function allocate(s: SlotState, entry: number, x: number, y: number, z: number, frame: number) {
  if (!s.top) {
    s.tally.refused++
    return false
  }
  const slot = s.stack[--s.top]
  s.owner[slot] = entry
  s.cell[slot * 3] = x
  s.cell[slot * 3 + 1] = y
  s.cell[slot * 3 + 2] = z
  s.usedAt[slot] = frame
  s.tracedAt[slot] = 0
  s.traces[slot] = 0
  s.held[entry] = slot + 1
  s.tally.live++
  s.tally.unfilled++
  s.tally.refreshing++
  return true
}

/** Gives a slot back: its cell forgotten by both tables, the GPU's told. */
function release(s: SlotState, slot: number) {
  const entry = s.owner[slot]
  if (s.held[entry] === slot + 1) s.held[entry] = 0
  if (s.visible[entry] === slot + 1) {
    s.visible[entry] = 0
    markDirty(s, entry)
  }
  if (s.tracedAt[slot] === 0) s.tally.unfilled--
  if (s.traces[slot] < s.settle) s.tally.refreshing--
  s.owner[slot] = FREE
  s.stack[s.top++] = slot
  s.tally.live--
}

/** A trace of a slot at `frame`; whether it is its first, which publishes it to the GPU. */
function trace(s: SlotState, slot: number, frame: number) {
  const first = s.tracedAt[slot] === 0
  s.tracedAt[slot] = frame
  if (s.traces[slot] < s.settle && ++s.traces[slot] === s.settle) s.tally.refreshing--
  if (first) {
    s.tally.unfilled--
    s.visible[s.owner[slot]] = slot + 1
    markDirty(s, s.owner[slot])
  }
  return first
}

/** The rank of the next texel of the table that changed, its four entries into `into`; -1 when none. */
function takeDirty(s: SlotState, into: Float32Array) {
  if (!s.waiting) return -1
  const texel = s.dirtyQueue[s.head]
  s.head = (s.head + 1) % s.texels
  s.waiting--
  s.dirtyFlag[texel] = 0
  for (let lane = 0; lane < TABLE_LANES; lane++) into[lane] = s.visible[texel * TABLE_LANES + lane]
  return texel
}

/**
 * THE SLOTS: a fixed pool of probes, and, for every cell of every level, the slot that holds it.
 *
 * A cell is named by its remainder modulo the level's side — its entry, `entryAt` —: sliding a level
 * by a cell changes only the entries of the cells that come in. A slot is taken for a cell
 * (`allocate`), traced (`trace`), and given back (`release`). The table the GPU reads
 * (`visible`, one `u16` an entry, the slot + 1 or zero) names a slot only once it holds light — the
 * first trace publishes it — and forgets it the moment it is given back; the table the CPU holds
 * (`held`) names it from its allocation, for the marks of the images to find it.
 *
 * A texel of the table is `TABLE_LANES` entries: those that changed since they were last written
 * wait in a queue of texels (`takeDirty`), each once, for the GPU to be told.
 *
 * Nothing is allocated after construction.
 */
export function createProbeSlots(cascades: BounceCascades) {
  const s = slotState(cascades)
  const wrap = (value: number) => ((value % s.size) + s.size) % s.size
  return {
    capacity: s.capacity,
    settle: s.settle,
    owner: s.owner,
    cell: s.cell,
    usedAt: s.usedAt,
    tracedAt: s.tracedAt,
    traces: s.traces,
    held: s.held,
    tally: s.tally,
    /** Texels of the table that changed and wait to be told. */
    get waiting() {
      return s.waiting
    },
    /** The entry of the cell `x, y, z` of `level`: its remainders modulo the side, laid out
     *  level, z, y, x. */
    entryAt: (level: number, x: number, y: number, z: number) =>
      ((level * s.size + wrap(z)) * s.size + wrap(y)) * s.size + wrap(x),
    /** The level a held slot's cell belongs to. */
    levelOf: (slot: number) => Math.floor(s.owner[slot] / s.cells),
    allocate: (entry: number, x: number, y: number, z: number, frame: number) =>
      allocate(s, entry, x, y, z, frame),
    release: (slot: number) => release(s, slot),
    trace: (slot: number, frame: number) => trace(s, slot, frame),
    takeDirty: (into: Float32Array) => takeDirty(s, into),
    /** The lights changed: every slot is traced again, up to `settledTraces` times. */
    restart() {
      s.traces.fill(0)
      s.tally.refreshing = s.tally.live
    },
  }
}
