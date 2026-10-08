import v8 from 'node:v8'
import vm from 'node:vm'
import { quantileFloorOf } from '../../../math/src/scalar/quantile.ts'

/**
 * Bytes a run of the render-scale control allocates, as the optimiser compiles it — the measure
 * of the `scaleControlAlloc*.test.ts` files. Each imports it
 * first, in its own process, one kind of control a file: a control's code optimised for one
 * path (GPU times, frame intervals), then run on another,
 * is reoptimised, and the second shows that code's boxes under a loaded machine, not its own
 * path's — a page runs one kind of control.
 */
// What the code creates, not what the optimiser may remove: escape analysis off, so an object
// made and dropped within a step is still made. The code the engine settles on, the optimiser's:
// the middle tier (Maglev), which hot code passes through, boxes numbers its own way, and a step
// it still runs while measured counts its boxes, not the code's; and the optimiser compiles on
// the test's own thread — its optimised code, its loops replaced while they run (OSR) and its
// baseline code alike —, so no compile a loaded machine finished late lands in a measure. Set
// before any step is compiled; each test file runs in its own process.
v8.setFlagsFromString('--expose-gc')
v8.setFlagsFromString('--no-turbo-escape')
v8.setFlagsFromString('--no-maglev')
v8.setFlagsFromString('--no-concurrent-recompilation')
v8.setFlagsFromString('--no-concurrent-osr')
v8.setFlagsFromString('--no-concurrent-sparkplug')
v8.setFlagsFromString('--allow-natives-syntax')
const gc = vm.runInNewContext('gc') as () => void
const optimize = new Function(
  'f',
  '%PrepareFunctionForOptimization(f); f(0); f(1); %OptimizeFunctionOnNextCall(f); f(2);',
) as (f: (i: number) => void) => void
/** Marks `f` to be compiled by the optimiser at its next call. */
const prepare = new Function(
  'f',
  '%PrepareFunctionForOptimization(f); %OptimizeFunctionOnNextCall(f);',
) as (f: unknown) => void

/** Runs a measure counts: enough that the heap's own accounting — read at the granularity of its
 *  allocation buffers, a few kilobytes either way on a loaded machine — weighs under a byte a run,
 *  while one object a run weighs sixteen at least. */
export const SAMPLES = 10_000
/** Runs before a measure: enough for the optimiser to take the functions the run calls, as an
 *  engine that ran for some minutes has them. */
const WARM = 30_000

/** Rounds a measure takes, and the middle one: a round may also hold what a lower tier boxes,
 *  which only adds, or a collection, which only takes away; the median is neither. A loaded
 *  machine may leave the code in a lower tier for the first rounds: the rounds go on until the
 *  last `SETTLED` read alike — the code settled —, `MOST_ROUNDS` at most, and the last `ROUNDS`
 *  are read. */
const ROUNDS = 5,
  SETTLED = 3,
  MOST_ROUNDS = 25
/** Whether the last `SETTLED` rounds of `bytes` read alike. */
const settled = (bytes: number[]) =>
  bytes.length >= ROUNDS && bytes.slice(-SETTLED).every((round) => round === bytes.at(-1))
const median = (bytes: number[]) => quantileFloorOf(bytes, 0.5) as number

/** Bytes the heap grew by over `SAMPLES` runs of `run`, less an empty run's, each compiled by the
 *  optimiser after a collection — a collection after it would drop code that holds objects the
 *  warm-up left —, with `hot`, the functions it calls, as an engine that ran for a while has
 *  them. `pick`: what the rounds give, their median by default. */
export function grown(
  run: (i: number) => void,
  hot: ((...args: never[]) => unknown)[] = [],
  pick: (bytes: number[]) => number = median,
) {
  const measure = (body: (i: number) => void) => {
    const bytes: number[] = []
    while (bytes.length < MOST_ROUNDS && !settled(bytes)) {
      for (let i = 0; i < WARM; i++) body(i)
      gc()
      for (const f of hot) prepare(f)
      optimize(body)
      const before = v8.getHeapStatistics().used_heap_size
      for (let i = 0; i < SAMPLES; i++) body(i)
      bytes.push(v8.getHeapStatistics().used_heap_size - before)
    }
    return pick(bytes.slice(-ROUNDS))
  }
  return measure(run) - measure(() => {})
}

// The harness's own first run — its closures compiled, its arrays grown — measured once and
// dropped, so the first measure of a file counts the run's bytes only.
grown(() => {})
