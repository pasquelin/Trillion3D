import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { recordTextureWgsl } from '../../gpu/core/recordTextureWgsl.ts'
import { STRUCTURE_HEAD, STRUCTURE_TABLE } from '../../gpu/dag/structureTable.ts'
import { STRUCTURE_WORD } from '../../gpu/dag/worlds.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { ROW_MAP_WGSL } from './rowMapWgsl.ts'
import { ROW_USE, ROW_USE_WORDS, ROW_WALK } from './rowWords.ts'
import { DAG_SEED_WGSL } from '../../gpu/dag/shader/seedWgsl.ts'

/** Group-1 bindings of the rows' closure in the cut's program: the page→row map, the rows' use
 *  words, the group structures (`rowClosure.ts` binds them). */
export const ROW_CLOSURE_BINDING = { rowMap: 0, rowUse: 1, structures: 2 } as const

const B = ROW_CLOSURE_BINDING

/**
 * THE ROWS' CLOSURE (#1527), two kernels of the cut's program run after `dagMask`
 * (`../../gpu/dag/encode.ts`): every page the cut drew, asked for or asked for ahead — its seeds
 * (`../../gpu/dag/shader/seedWgsl.ts`) — raises with `atomicMax` the use word of each row its
 * readiness needs: the rows of its group's members and, up to the roots, of the groups above it, in
 * ITS placement (`../../page/cut/groupClosure.ts`, `instances`), outside the frustum or not. A
 * drawn or asked page stamps the frame (`useClock`), one asked ahead the view ahead's clock
 * (`aheadClock`), as the pool's last uses do (`../../gpu/dag/shader/lastUseWgsl.ts`).
 *
 * The walk is the CPU's `reach`, on the primitive's structure as the packing compiled it
 * (`../../gpu/dag/structureTable.ts`), its base in the placement's frame words: a group popped,
 * its members stamped, each output's owner pushed — or the output stamped when nothing replaces
 * it. A (placement, group) is walked once a frame: its GATE is the walk word of the first member
 * holding a row, raised to the seed's clock — a walk that finds it as new already stops, a walker
 * at least as new covering exactly what it would. The words are maxima: whatever thread walks, the
 * same words. Its stack lies in workgroup memory, `ROW_STACK` a lane, the most any structure's walk
 * holds (`stackBound`); `ROW_LANES` lanes take the `WORKGROUP_THREADS` entries of a workgroup of
 * the list's dispatch, so a deep structure takes fewer lanes, never a stack cut short.
 */
export const ROW_CLOSURE_WGSL = wgslBlock(
  'ROW_CLOSURE_WGSL',
  [
    ROW_MAP_WGSL,
    recordTextureWgsl(STRUCTURE_TABLE, {
      name: 'structures',
      group: 1,
      binding: B.structures,
      access: 'read',
    }),
    DAG_SEED_WGSL,
    NO_INDEX,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ],
  `@group(1) @binding(${B.rowMap}) var<storage,read> rowMap:array<u32>;
@group(1) @binding(${B.rowUse}) var<storage,read_write> rowUse:array<atomic<u32>>;
${wgslConsts({ ROW_USE_WORDS, ROW_USE, ROW_WALK, STRUCTURE_HEAD, STRUCTURE_WORD })}
override ROW_LANES:u32=WORKGROUP_THREADS;
override ROW_STACK:u32=1u;
override ROW_STACK_WORDS:u32=WORKGROUP_THREADS;
var<workgroup> rowStack:array<u32,ROW_STACK_WORDS>;
fn structWord(k:u32)->u32{return structuresWord(k,0u).x;}
/** Packed page \`page\`'s row, if it holds one, used at \`v\`. */
fn rowStamp(page:u32,v:u32){let row=rowOfPage(page);if(row!=NO_INDEX){atomicMax(&rowUse[ROW_USE_WORDS*row+ROW_USE],v);}}
/** Packed page \`i\` of placement \`w\`, used at \`v\`, and every row its readiness needs. */
fn rowClose(i:u32,w:u32,v:u32,lane:u32){
 let b=framesWord(w,STRUCTURE_WORD);
 if(b==NO_INDEX){rowStamp(i,v);return;}
 let pageBase=pageBaseOf(w);let pages=structWord(b);let groups=structWord(b+1u);
 let owners=b+STRUCTURE_HEAD;let memberAt=owners+pages;let members=memberAt+groups+1u;
 let outputAt=members+structWord(memberAt+groups);let outputs=outputAt+groups+1u;
 let first=structWord(owners+i-pageBase);
 if(first==NO_INDEX){rowStamp(i,v);return;}
 let base=lane*ROW_STACK;var top=1u;rowStack[base]=first;
 loop{
  if(top==0u){break;}
  top--;let g=rowStack[base+top];
  let end=structWord(memberAt+g+1u);
  var m=structWord(memberAt+g);var gate=NO_INDEX;
  for(;m<end;m++){gate=rowOfPage(pageBase+structWord(members+m));if(gate!=NO_INDEX){m++;break;}}
  if(gate!=NO_INDEX){
   if(atomicMax(&rowUse[ROW_USE_WORDS*gate+ROW_WALK],v)>=v){continue;}
   atomicMax(&rowUse[ROW_USE_WORDS*gate+ROW_USE],v);
  }
  // The members before the gate hold no row.
  for(;m<end;m++){rowStamp(pageBase+structWord(members+m),v);}
  let last=structWord(outputAt+g+1u);
  for(var o=structWord(outputAt+g);o<last;o++){
   let output=structWord(outputs+o);let owner=structWord(owners+output);
   if(owner==NO_INDEX){rowStamp(pageBase+output,v);}
   else if(top<ROW_STACK){rowStack[base+top]=owner;top++;}
  }
 }
}
/** The candidates \`dagWanted\` marked asked, or asked ahead (\`markSeed\`). */
@compute @workgroup_size(ROW_LANES)
fn rowCloseAsked(@builtin(workgroup_id) id:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let first=flatIndex(id,n,1u)*WORKGROUP_THREADS;
 let count=min(atomicLoad(&work[candCounter()]),views[0u].candCap);
 for(var k=lane;k<WORKGROUP_THREADS;k+=ROW_LANES){
  let s=first+k;if(s>=count){break;}
  let entry=flagAt(candBase()+2u*s);let kind=entryView(entry);
  if(kind<ROW_SEED_ASKED){continue;}
  let v=select(aheadClock(),useClock(),kind==ROW_SEED_ASKED);
  rowClose(entryIndex(entry),flagAt(candBase()+2u*s+1u),v,lane);
 }
}
/** The live entries \`dagMask\` drew: the nearest resident ancestor standing in included. */
@compute @workgroup_size(ROW_LANES)
fn rowCloseDrawn(@builtin(workgroup_id) id:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let first=flatIndex(id,n,1u)*WORKGROUP_THREADS;
 let count=liveCount();
 for(var k=lane;k<WORKGROUP_THREADS;k+=ROW_LANES){
  let s=first+k;if(s>=count){break;}
  let i=entryIndex(liveAt(s));
  if((atomicLoad(&work[drawMaskWord(i)])&drawBit(i))==0u){continue;}
  rowClose(i,liveWorld(s),useClock(),lane);
 }
}
`,
)

/** The kernels of the rows' closure, in the order the cut runs them. */
export const ROW_CLOSURE_STAGES = ['rowCloseAsked', 'rowCloseDrawn'] as const
