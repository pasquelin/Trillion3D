// The diff of the instances' boxes (`castDiff.ts`) is asked when the event the reference follows may
// have happened — a placement's world was written, its word was written, the roots grew — and never otherwise; the
// first diff of a memory made anew only remembers; what it followed is remembered when it is
// encoded, and not before its kernel is compiled. A still scene pays no thread. And what it names,
// as the reference invalidates an instance: the box a placement leaves in the layer it was cached
// in, the box it enters in the layer it is cached in now (`castDiffWgsl.ts`, run in JavaScript).
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  SHADOW_CHANGE_BOXES,
  createShadowChanges,
} from '../../../../../sdk-core/src/scene/light/shadow/changes.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { encodeCastDiff, followRoots, prepareCastDiff } from './castDiff.ts'
import { CAST_DIFF_WGSL } from './castDiffWgsl.ts'
import {
  CAST_HEADER_WORDS,
  CAST_RECORD_WORDS,
  CAST_STATE_WORDS,
  CAST_VIEWS_WORD,
} from './castChanges.ts'
import { ROOT_BOX_DOUBLES } from '../../../placement/roots/rootWorldSends.ts'
import { createShadowMobility } from './mobility.ts'
import { ROOT_SECTION, ROOT_SECTIONS } from './rootWordsWgsl.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_DEFORMS,
  MOBILITY_HIDDEN_SHADOW,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_SHADOWLESS,
} from '../mobilityBits.ts'

/** A runtime of `roots` placements of one page each, their boxes and worlds on buffers, no world written yet. */
function runtime(roots = 6) {
  const { device } = fakeDevice()
  const selectionRoots = Array.from({ length: roots }, () => ({
    world: { elements: new Float64Array(16) },
    pages: [{}],
  }))
  const boxes = device.createBuffer({
    size: 64 * 8 * ROOT_BOX_DOUBLES,
    usage: GPUBufferUsage.STORAGE,
  })
  const worlds = device.createBuffer({ size: 64 * 8 * 16, usage: GPUBufferUsage.STORAGE })
  const rt = {
    layout: { selectionRoots, placement: { packedCount: roots } },
    lights: { mobility: createShadowMobility(), changes: createShadowChanges(SHADOW_CHANGE_BOXES) },
    rootWorlds: { held: roots, boxes, worlds },
    rootBoxes: { written: 0 },
    vis: { rootOffsets: { rowOf: () => undefined } },
    context: {},
    gpu: { device },
  } as unknown as WebgpuPagesRuntime
  return { rt, device, selectionRoots }
}

test('a memory made anew only remembers; later the diff is asked by what changed alone', async () => {
  const { rt, device, selectionRoots } = runtime()
  const { lights } = rt
  const encode = (ask: NonNullable<ReturnType<typeof followRoots>>) => {
    const steps = new ComputeRun().begin(device.createCommandEncoder())
    encodeCastDiff(rt, device, steps, ask)
    steps.end()
  }
  const first = followRoots(rt, device)
  assert.ok(first, 'the first frame asks')
  assert.equal(first.quiet, true, 'a memory made anew names no placement')
  assert.equal(lights.changes.count(), 1, 'and the pages every caster stands in go stale once')
  // The kernel compiling: nothing is remembered, the next frame asks again.
  encode(first)
  assert.equal(followRoots(rt, device)!.diff, true, 'not encoded: asked again')
  await prepareCastDiff(device)
  const again = followRoots(rt, device)!
  encode(again)
  assert.equal(followRoots(rt, device)!.diff, false, 'a still scene: no diff')
  // The roots pass wrote worlds: the placements it moved may have moved.
  rt.rootBoxes!.written = 1
  const moved = followRoots(rt, device)
  assert.ok(
    moved && !moved.quiet && moved.roots === 6,
    'a world written: the diff, over every placement',
  )
  assert.ok(lights.casts!.appended && lights.casts!.pending >= 12, 'room for two boxes each')
  encode(moved)
  assert.equal(followRoots(rt, device)!.diff, false)
  // A placement's word: it started moving, still at the same revision.
  lights.mobility.move(3, selectionRoots[3].world.elements, true)
  assert.equal(followRoots(rt, device)!.diff, true, 'a word written: the diff')
})

test('the roots grown ask the diff, and the memory keeps the placements it held', async () => {
  const { rt, device, selectionRoots } = runtime(4)
  await prepareCastDiff(device)
  const first = followRoots(rt, device)!
  const steps = new ComputeRun().begin(device.createCommandEncoder())
  encodeCastDiff(rt, device, steps, first)
  steps.end()
  assert.equal(followRoots(rt, device)!.diff, false)
  const memory = rt.lights.casts!.state
  selectionRoots.push({ world: { elements: new Float64Array(16) }, pages: [{}] })
  rt.rootWorlds!.held = 5
  const grown = followRoots(rt, device)
  assert.ok(grown && !grown.quiet, 'a new placement arrives: it is named')
  assert.ok(rt.lights.casts!.stateRoots >= 5, 'the memory holds room for it')
  assert.notEqual(rt.lights.casts!.state, memory, 'made larger')
})

// ---- what the diff names ----

/** A double as the GPU holds it: its high word, then its low. */
const double = (x: number) => {
  const words = new Uint32Array(new Float64Array([x]).buffer)
  return [words[1], words[0]]
}
const bits = new Float32Array(1),
  asBits = new Uint32Array(bits.buffer)
const floatOf = (word: number) => ((asBits[0] = word), bits[0])
const bitsOf = (x: number) => ((bits[0] = x), asBits[0])

/** The diff kernel over `ROOTS` placements, run in JavaScript on the shipped text: its boxes and
 *  words set by `place`, its memory kept from step to step, the records of each step returned. The
 *  box widening is left out (the interpreter rounds nothing to single precision, so a widened box
 *  would differ from its stored one by the last bits): the boxes are dyadic, exact. */
function diffKernel(roots: number, records = 16) {
  const rootBoxes: number[][] = Array.from({ length: roots * ROOT_BOX_DOUBLES }, () => double(0))
  const rootWorlds: number[][] = Array.from({ length: roots * 16 }, () => double(0))
  // The words, the instances' state, the squares of the offsets' distances, the reach (`ROOT_SECTIONS`).
  const rootWords = new Array<number>(ROOT_SECTIONS * roots).fill(0)
  const castState = new Array<number>(roots * CAST_STATE_WORDS).fill(0)
  const castChanges = new Array<number>(CAST_HEADER_WORDS + records * CAST_RECORD_WORDS).fill(0)
  // The arrivals: a bit a placement, `diff.arrivals` saying whether any is set.
  const arrived = new Array<number>(Math.max(1, Math.ceil(roots / 32))).fill(0)
  const diff = { roots, quiet: 0, views: 1, arrivals: 0 }
  const text = CAST_DIFF_WGSL.replace(/const BOX_SLACK:f32=[^;]+;/, 'const BOX_SLACK:f32=0.0;')
  const run = shaderRun<{
    castDiff: (id: number[], n: number[]) => void
    castInstanceState: (id: number[], n: number[]) => void
  }>(text, ['castDiff', 'castInstanceState'], {
    ...wgslConstants(text),
    diff,
    rootBoxes,
    rootWorlds,
    rootWords,
    castState,
    castChanges,
    arrived,
    arrayLength: (pointer: { get: () => unknown[] }) => pointer.get().length,
    atomicAdd: (p: { get: () => number; set: (v: number) => void }, v: number) => {
      const was = p.get()
      p.set(was + v)
      return was
    },
    atomicStore: (p: { set: (v: number) => void }, v: number) => p.set(v),
  })
  return {
    /** The diff's memory, `CAST_STATE_WORDS` words a placement. */
    castState,
    /** Placement `r` at the box `[lo, hi]` (none for `null`) with `word`, its offset stopping at
     *  `disableSq`. */
    place(r: number, box: number[] | null, word = 0, disableSq = 0) {
      const at = r * ROOT_BOX_DOUBLES
      for (let k = 0; k < 6; k++) rootBoxes[at + k] = double(box ? box[k] : 0)
      // The oriented box of the same bounds, along the world's axes: the centre (doubles 7..9), the
      // half axes (nine singles from double 11).
      const centre = box ? [0, 1, 2].map((a) => (box[a]! + box[3 + a]!) / 2) : [0, 0, 0]
      for (let a = 0; a < 3; a++) rootBoxes[at + 7 + a] = double(centre[a]!)
      const half = box ? [0, 1, 2].map((a) => (box[3 + a]! - box[a]!) / 2) : [0, 0, 0]
      const singles = new Uint32Array(10)
      const view = new Float32Array(singles.buffer)
      for (let c = 0; c < 3; c++) view[3 * c + c] = half[c]!
      for (let k = 0; k < 5; k++) rootBoxes[at + 11 + k] = [singles[2 * k]!, singles[2 * k + 1]!]
      rootWords[r] = word
      rootWords[2 * roots + r] = bitsOf(disableSq)
    },
    /** The instances' state per view over every placement, `arrivals` the ranks that arrived since
     *  it last ran; returns the state words (`ROOT_SECTION.state`) it wrote for the rootWords. */
    state(arrivals: number[] = []) {
      arrived.fill(0)
      for (const rank of arrivals) arrived[rank >> 5]! |= 1 << (rank & 31)
      diff.arrivals = arrivals.length ? 1 : 0
      for (let r = 0; r < roots; r++) run.castInstanceState([r, 0, 0], [roots, 1, 1])
      return rootWords.slice(ROOT_SECTION.state * roots, (ROOT_SECTION.state + 1) * roots)
    },
    /** The offset facts word of each record in the list so far, those the instances' state appended
     *  among them. */
    listedFacts() {
      const at = (k: number) => CAST_HEADER_WORDS + k * CAST_RECORD_WORDS
      return Array.from({ length: castChanges[0]! }, (_, k) => castChanges[at(k) + 11])
    },
    /** One diff, over every placement: the records it appended, each its box and moving flag, and
     *  beside them the offset facts each carries (the word bits, the distance's square); the
     *  header's overflow flag. */
    step(quiet = false, arrivals: number[] = []) {
      castChanges.fill(0)
      diff.quiet = quiet ? 1 : 0
      arrived.fill(0)
      for (const rank of arrivals) arrived[rank >> 5]! |= 1 << (rank & 31)
      diff.arrivals = arrivals.length ? 1 : 0
      for (let r = 0; r < roots; r++) run.castDiff([r, 0, 0], [roots, 1, 1])
      const out = [],
        facts = []
      for (let k = 0; k < Math.min(castChanges[0], records); k++) {
        const at = CAST_HEADER_WORDS + k * CAST_RECORD_WORDS
        const f = (i: number) => floatOf(castChanges[at + i])
        // The half axes lie along the world's: x at word 4, y at 8, z at 12.
        const ex = f(4),
          ey = f(9),
          ez = f(14)
        out.push({
          box: [f(0) - ex, f(1) - ey, f(2) - ez, f(0) + ex, f(1) + ey, f(2) + ez],
          moving: f(3) < 0,
        })
        facts.push({ offset: castChanges[at + 11], disableSq: f(15) })
      }
      return { records: out, facts, overflow: castChanges[1] !== 0 }
    },
  }
}

const A = [0, 0, 0, 2, 2, 2],
  B = [4, 0, 0, 6, 2, 2]

test('a memory made anew only remembers; a placement that did not change names nothing', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.place(1, B)
  assert.deepEqual(kernel.step(true).records, [], 'quiet: none named')
  assert.deepEqual(kernel.step().records, [], 'nothing changed: none')
})

test('a placement that arrives names its box, in the layer it is cached in', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(1, B, MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }])
  assert.deepEqual(kernel.step().records, [], 'once')
  kernel.place(1, null)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }], 'and when it leaves')
})

test('a placement that arrives where it was seen casting — a row seated on another mesh, the same box — names the box it leaves and the one it enters', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.place(1, B, MOBILITY_MOVING)
  kernel.step(true)
  assert.deepEqual(kernel.step().records, [], 'still: none')
  // Placement 0 is another primitive now, the same box: both of its ends are named, in the static layer.
  assert.deepEqual(kernel.step(false, [0]).records, [
    { box: A, moving: false },
    { box: A, moving: false },
  ])
  // Placement 1 left cached as dynamic and enters as a static one (a new primitive starts still): each end in its own layer.
  kernel.place(1, B, 0)
  assert.deepEqual(kernel.step(false, [1]).records, [
    { box: B, moving: true },
    { box: B, moving: false },
  ])
  assert.deepEqual(kernel.step().records, [], 'once')
})

test('a pinned placement that arrives where it was seen names its two boxes too, though its moves name none', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_CACHE_STATIC)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_CACHE_STATIC)
  assert.deepEqual(kernel.step().records, [], 'a pinned placement’s move names none')
  assert.deepEqual(kernel.step(false, [0]).records, [
    { box: B, moving: false },
    { box: B, moving: false },
  ])
})

test('a static placement’s first move stales the box it leaves in the static layer and the one it enters in the dynamic', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [
    { box: A, moving: false },
    { box: B, moving: true },
  ])
})

test('a moving placement’s moves stale the dynamic layer alone, at both ends', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_MOVING)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [
    { box: A, moving: true },
    { box: B, moving: true },
  ])
})

test('a placement that deforms is cached as dynamic: its arrival and its moves stale the dynamic layer alone', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A, MOBILITY_DEFORMS)
  kernel.step(true)
  kernel.place(1, B, MOBILITY_DEFORMS)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }], 'it arrives')
  kernel.place(0, B, MOBILITY_DEFORMS)
  assert.deepEqual(
    kernel.step().records,
    [
      { box: A, moving: true },
      { box: B, moving: true },
    ],
    'it moves',
  )
  // It begins to move and settles, and stays dynamic: the static layer is never staled.
  kernel.place(0, B, MOBILITY_DEFORMS | MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }], 'it begins to move')
  kernel.place(0, B, MOBILITY_DEFORMS)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }], 'it settles')
})

test('a placement that casts no shadow lists the box of its transition to dynamic, flagged for the stale to skip', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_SHADOWLESS)
  kernel.step(true)
  kernel.state()
  kernel.place(0, A, MOBILITY_SHADOWLESS | MOBILITY_DEFORMS)
  kernel.step()
  kernel.state()
  assert.deepEqual(kernel.listedFacts(), [MOBILITY_SHADOWLESS])
})

test('a box carries the offset facts of its placement and the square of its distance, at both ends of a move', () => {
  const kernel = diffKernel(2)
  const wears = MOBILITY_OFFSET_INVALIDATES | MOBILITY_OFFSET_ALWAYS
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(1, B, wears | MOBILITY_HIDDEN_SHADOW, 100)
  assert.deepEqual(kernel.step().facts, [{ offset: wears, disableSq: 100 }], 'it arrives')
  kernel.place(1, A, wears, 100)
  assert.deepEqual(
    kernel.step().facts,
    [
      { offset: wears, disableSq: 100 },
      { offset: wears, disableSq: 100 },
    ],
    'it moves',
  )
  kernel.place(0, B)
  assert.deepEqual(kernel.step().facts, [
    { offset: 0, disableSq: 0 },
    { offset: 0, disableSq: 0 },
  ])
})

test('a placement that settles stales the static layer under its box once, where it stands', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_MOVING)
  kernel.step(true)
  kernel.place(0, A, 0)
  assert.deepEqual(kernel.step().records, [{ box: A, moving: false }])
  assert.deepEqual(kernel.step().records, [])
})

test('a placement that stops or starts casting names its box, once', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(0, A, MOBILITY_SHADOWLESS)
  assert.deepEqual(kernel.step().records, [{ box: A, moving: false }], 'it stopped')
  kernel.place(0, B, MOBILITY_SHADOWLESS)
  assert.deepEqual(kernel.step().records, [], 'moved while it casts nothing: none')
  kernel.place(0, B, 0)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: false }], 'it started')
  kernel.place(0, B, MOBILITY_HIDDEN_SHADOW)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: false }], 'it casts while hidden now')
})

test('a placement that pins its shadows is followed without a record for its moves', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_CACHE_STATIC)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_CACHE_STATIC)
  assert.deepEqual(kernel.step().records, [])
  kernel.place(0, null, MOBILITY_CACHE_STATIC)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: false }], 'it leaves, as any')
})

test('a box that stays within the one it leaves names both ends, as the previous bounds and the new', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A)
  kernel.step(true)
  const inside = [0.5, 0.5, 0.5, 1.5, 1.5, 1.5]
  kernel.place(0, inside)
  // The reference invalidates the bounds a moved instance had and the ones it has, each in full;
  // no step skips the new box for the old one's holding it.
  assert.deepEqual(kernel.step().records, [
    { box: A, moving: false },
    { box: inside, moving: false },
  ])
})

test('a list too small flags its overflow, never loses the fact that boxes were named', () => {
  const kernel = diffKernel(3, 2)
  kernel.step(true)
  for (let r = 0; r < 3; r++) kernel.place(r, [r * 8, 0, 0, r * 8 + 2, 2, 2])
  const { records, overflow } = kernel.step()
  assert.equal(records.length, 2, 'the room it had')
  assert.equal(overflow, true)
})

// The cache state of a rank that arrives is zeroed by the CPU's signal (`arriveRank`, `mobilityState.ts`),
// told to the state per view as one array of the ranks, not inferred by the diff from a word that
// stopped saying it casts nothing.
test('the diff leaves the cache state of a rank in any view alone, whatever its word did', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_SHADOWLESS)
  kernel.step(true)
  // What the placement that left the rank held: tracked and dynamic in two views (`CAST_VIEWS_WORD`).
  kernel.castState[CAST_VIEWS_WORD] = 0x00030003
  kernel.place(0, A)
  kernel.step()
  assert.equal(kernel.castState[CAST_VIEWS_WORD], 0x00030003, 'cast again after casting nothing')
})

test('a rank that arrived starts with no cache state in any view, the others keep theirs', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.place(1, B)
  kernel.step(true)
  // Both ranks held a placement cached as dynamic in the view, tracked; neither deforms now.
  for (const r of [0, 1]) kernel.castState[r * CAST_STATE_WORDS + CAST_VIEWS_WORD] = 0x00010001
  // A placement that stayed: its state turns to static (a transition). One that arrived: it held none,
  // so nothing turns.
  assert.deepEqual(
    kernel.state([1]).map((word) => word >>> 16),
    [1, 0],
    'rank 1 arrived',
  )
  // Told once: the next run, with no arrival, reads what the last run wrote.
  assert.deepEqual(
    kernel.state().map((word) => word >>> 16),
    [0, 0],
  )
  assert.equal(kernel.castState[CAST_VIEWS_WORD + CAST_STATE_WORDS], 1 << 16, 'tracked from now on')
})
