import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import { GROUP_GRID_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { TESS_DECLARATIONS as D } from './bindings.ts'
import {
  ARG_END,
  ARG_LEVEL,
  ARG_QUEUE,
  ARG_START,
  ARG_VISIBLE,
  DISPATCH_DICE,
  DISPATCH_SPLIT,
  MAX_SPLIT_LEVELS,
} from './contract.ts'
import { TESS_STATE_WGSL } from './queueWgsl.ts'

/**
 * THE LEVELS' ARGUMENTS, one thread between two splits: the patches of the next level are those
 * the queue holds past the last one's, `start` to `end`, whose dispatch it writes as the split's own
 * (`groupGrid`); the level counts up from the seeding's zero, to `MAX_SPLIT_LEVELS`. A patch a last
 * level cut again is queued and no level takes it up: no triangle asks for so many.
 */
const PLAN = `@compute @workgroup_size(1) fn tessPlan(){
 let level=tw(tu.args+${ARG_LEVEL}u);
 let start=select(0u,tw(tu.args+${ARG_END}u),level>0u);
 let end=max(min(tw(tu.args+${ARG_QUEUE}u),tu.maxCandidate),start);
 atomicStore(&tess[tu.args+${ARG_START}u],start);
 atomicStore(&tess[tu.args+${ARG_END}u],end);
 let grid=groupGrid(ceilDiv(end-start,WORKGROUP_THREADS));
 dispatch[tu.dispatch+${DISPATCH_SPLIT}u]=grid.x;
 dispatch[tu.dispatch+${DISPATCH_SPLIT + 1}u]=grid.y;
 dispatch[tu.dispatch+${DISPATCH_SPLIT + 2}u]=1u;
 atomicStore(&tess[tu.args+${ARG_LEVEL}u],min(level+1u,${MAX_SPLIT_LEVELS}u));
}`

/**
 * THE DICING'S ARGUMENTS, one thread once the levels are down: the workgroups of the dicing,
 * one for each `patchesPerGroup` of the patches the visible list was asked for, held to its
 * capacity, in rows (`groupGrid`).
 */
const VISIBLE_ARGS = `@compute @workgroup_size(1) fn tessVisibleArgs(){
 let visible=min(tw(tu.args+${ARG_VISIBLE}u),tu.maxVisible);
 let grid=groupGrid(ceilDiv(visible,tu.patchesPerGroup));
 dispatch[tu.dispatch+${DISPATCH_DICE}u]=grid.x;
 dispatch[tu.dispatch+${DISPATCH_DICE + 1}u]=grid.y;
 dispatch[tu.dispatch+${DISPATCH_DICE + 2}u]=1u;
}`

const PROGRAM = `${D.tessUniform}
${D.tess}
${D.dispatch}`

/**
 * The arguments' program: its entry points `tessPlan` and `tessVisibleArgs`, the only ones that write the
 * `dispatch` buffer. It binds neither the geometry nor the pages, and the kernels the dispatches it
 * writes launch bind no `dispatch`: a buffer a dispatch reads its size from is never bound writable
 * to the same dispatch.
 */
export const planSource = () =>
  wgslProgram(`${PROGRAM}\n${PLAN}\n${VISIBLE_ARGS}`, [
    TESS_STATE_WGSL,
    GROUP_GRID_WGSL,
    WORKGROUP_THREADS_WGSL,
    ceilDivWgsl,
  ])
