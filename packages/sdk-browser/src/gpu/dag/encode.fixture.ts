/**
 * Cut witness encoder: it dispatches nothing, it notes. What the GPU pays between two kernels is
 * counted in COMMANDS, not threads — each compute pass and each copy outside a pass empties its
 * queue and caches —, and two test files hold that contract: `live.test.ts` for the list
 * each kernel walks, `encode.test.ts` for the command count.
 */
import assert from 'node:assert/strict'
import type { encodeDagKernels } from './encode.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'

/** `list`: the list whose armed record the dispatch reads, `-1` when no arming ran before it in
 *  its pass; `rows`: the rows of a flat dispatch past one row (`shader/gridWgsl.ts`). */
type Dispatch = { kernel: string; groups: number | 'indirect'; list?: number; rows?: number }
type Copie = { de: string; vers: string; enPasse: boolean }

export const LIVE = 1234,
  CAND = 3000,
  DRAWN = 4000
/** The list each argument record of `dispatchArgs` holds once armed (`DAG_ARGS`). */
const LIST_OF_RECORD = new Map<number, number>([
  [DAG_ARGS.drawn, DRAWN],
  [DAG_ARGS.cand, CAND],
  [DAG_ARGS.live, LIVE],
])
/** Nodes of each stage: the upper bound on which that level's pass dispatches flat. */
export const ETAGES = [2, 9, 40, 150, 600]

/** An encoder that only notes: which kernel, dispatched flat or on which list. The arming kernel
 *  is not a launch of the cut's: `armements` holds, for each run, the launches before it. */
export function witnessEncoder() {
  const dispatches: Dispatch[] = []
  const copies: Copie[] = []
  const passes: string[] = []
  const armements: number[] = []
  /** Each bind group a pass sets, in order. */
  const boundGroups: unknown[] = []
  let kernel = ''
  let arme = false
  let ouverte = false
  const pass = {
    setBindGroup: (_: number, group: unknown) => void boundGroups.push(group),
    setPipeline(next: { entryPoint: string }) {
      kernel = next.entryPoint
    },
    dispatchWorkgroups(groups: number, rows = 1) {
      if (kernel === 'dagArm') {
        assert.equal(groups, 1, 'one workgroup arms the three lists')
        armements.push(dispatches.length)
        arme = true
        return
      }
      dispatches.push({ kernel, groups, ...(rows > 1 && { rows }) })
    },
    dispatchWorkgroupsIndirect(buffer: { nom: string }, decalage: number) {
      assert.equal(buffer.nom, 'dispatchArgs')
      const list = arme ? (LIST_OF_RECORD.get(decalage) ?? -1) : -1
      dispatches.push({ kernel, groups: 'indirect', list })
    },
    end() {
      ouverte = false
      arme = false
    },
  }
  const encoder = {
    beginComputePass(descriptor: { label: string }) {
      passes.push(descriptor.label)
      ouverte = true
      return pass
    },
    copyBufferToBuffer(de: { nom: string }, _d: number, vers: { nom: string }) {
      copies.push({ de: de.nom, vers: vers.nom, enPasse: ouverte })
    },
  }
  return { encoder, dispatches, copies, passes, armements, boundGroups }
}

/** A stage named as the witness will see it pass: `encode.ts` destructures these fields
 *  by name, and writing them here makes them searchable from it. */
const step = (entryPoint: string) => ({ entryPoint })

export function cutResources(levelCount = 3, pageCount = 4096) {
  return {
    pageCount,
    nodeCount: 64,
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
    requestSortPipeline: step('dagSortRequests'),
    evictPipeline: step('dagListEvictions'),
  } as unknown as Parameters<typeof encodeDagKernels>[1]
}
