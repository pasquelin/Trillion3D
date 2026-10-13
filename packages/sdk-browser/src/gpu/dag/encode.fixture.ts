/**
 * The cut's witness, read off the kit's encoder. What the GPU pays between two kernels is
 * counted in COMMANDS, not threads — each compute pass and each copy outside a pass empties its
 * queue and caches —, and two test files hold that contract: `live.test.ts` for the list
 * each kernel walks, `encode.test.ts` for the command count.
 */
import assert from 'node:assert/strict'
import type { encodeDagKernels } from './encode.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

/** `list`: the list whose armed record the dispatch reads, `-1` when no arming ran before it in
 *  its pass; `rows`: the rows of a flat dispatch past one row (`../dispatch/grid.ts`). */
type Dispatch = { kernel: string; groups: number | 'indirect'; list?: number; rows?: number }

export const LIVE = 1234,
  CAND = 3000,
  DRAWN = 4000,
  /** Descent queue `q`'s record: `QUEUE + q`. */
  QUEUE = 5000
/** The list each argument record of `dispatchArgs` holds once armed (`DAG_ARGS`). */
const LIST_OF_RECORD = new Map<number, number>([
  [DAG_ARGS.drawn, DRAWN],
  [DAG_ARGS.cand, CAND],
  [DAG_ARGS.live, LIVE],
  ...DAG_ARGS.queues.map((record, q): [number, number] => [record, QUEUE + q]),
])
/** Nodes of each stage: the upper bound on which that level's pass dispatches flat. */
export const ETAGES = [2, 9, 40, 150, 600]

/** One of the kit's encoders, and `read()`: what the cut encoded on it — which kernel, dispatched
 *  flat or on which list. The arming kernel is not a launch of the cut's: `armements` holds, for
 *  each run, the launches before it. */
export function witnessEncoder() {
  const kit = fakeDevice()
  const read = () => {
    const dispatches: Dispatch[] = []
    const armements: number[] = []
    /** Each bind group a pass sets, in order. */
    const boundGroups: unknown[] = []
    for (const { commands } of kit.computePasses) {
      let kernel = '',
        arme = false
      for (const [name, args] of commands) {
        if (name === 'setBindGroup') boundGroups.push(args[1])
        if (name === 'setPipeline') kernel = (args[0] as { entryPoint: string }).entryPoint
        if (name === 'dispatchWorkgroups') {
          const [groups, rows = 1] = args as number[]
          if (kernel === 'dagArm') {
            assert.equal(groups, 1, 'one workgroup arms the three lists')
            armements.push(dispatches.length)
            arme = true
          } else dispatches.push({ kernel, groups, ...(rows > 1 && { rows }) })
        }
        if (name === 'dispatchWorkgroupsIndirect') {
          const [buffer, decalage] = args as [{ nom: string }, number]
          assert.equal(buffer.nom, 'dispatchArgs')
          const list = arme ? (LIST_OF_RECORD.get(decalage) ?? -1) : -1
          dispatches.push({ kernel, groups: 'indirect', list })
        }
      }
    }
    const passes = kit.computePasses.map(({ label }) => label)
    return {
      dispatches,
      copies: [...kit.copies, ...kit.textureCopies],
      passes,
      armements,
      boundGroups,
    }
  }
  return { encoder: kit.device.createCommandEncoder(), read }
}

/** A stage named as the witness will see it pass: `encode.ts` destructures these fields
 *  by name, and writing them here makes them searchable from it. */
const step = (entryPoint: string) => ({ entryPoint })

export function cutResources(levelCount = 3, pageCount = 4096) {
  return {
    pageCount,
    nodeCount: 64,
    // A placement's entry for each node it reads (`levelWgsl.ts`).
    entryCount: 64,
    worldCount: 2,
    blockCount: 64,
    levelSizes: Uint32Array.from(ETAGES.slice(0, levelCount)),
    work: { nom: 'work' },
    dispatchArgs: { nom: 'dispatchArgs' },
    packed: {},
    ranges: [{ first: 0, count: 2, bindGroup: {} }],
    armPipeline: step('dagArm'),
    armGroup: { nom: 'armGroup' },
    rootLevelPipeline: step('dagRootLevel'),
    levelPipelines: [step('dagLevel0'), step('dagLevel1'), step('dagLevel2')],
    preparePipeline: step('dagPrepare'),
    clearDrawnPipeline: step('dagClearDrawn'),
    wantedPipeline: step('dagWanted'),
    maskPipeline: step('dagMask'),
    drawPrefixPipeline: step('dagDrawPrefix'),
    drawScatterPipeline: step('dagDrawScatter'),
    commitPipeline: step('dagCommitMask'),
    requestSortPipeline: step('dagSortRequests'),
    evictPipeline: step('dagListEvictions'),
  } as unknown as Parameters<typeof encodeDagKernels>[1]
}
