import { wgslBlock, wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import {
  ACTOR_ROW,
  CELL_DRAW,
  LINK_HEADER,
  LINK_HEADER_AT,
  LINK_WORDS,
  WORLD_ROOT_MARK,
} from '../worlds/worldLinks.ts'
import { DAG_COLD_AT_WGSL } from './bindings.ts'
import { DAG_MARK_OF_WGSL, DAG_PAGE_BASE_OF_WGSL } from './levelWgsl.ts'

/** The header word `at` (`LINK_HEADER_AT`) behind the links a function's `links` starts. */
const header = (at: number) => `coldAt(links-${LINK_HEADER - at}u)`

/**
 * THE ONE VERDICT OF THE WORLD'S SWITCH on a placement, from the words it reads: whether a
 * placement draws, given its link's cell word `h` (`NO_INDEX` for none, `ACTOR_ROW` set for a row of
 * a cell's actor), the word of that cell in its instance — `cellWord`, zero without a cell or an
 * instance packed — and the word of its file — `fileWord`, zero without one (`CELL_DRAW`). A row of
 * a cell's actor draws while its cell draws that actor; any other while its file or its HLOD 0
 * cell draws its placements. The descent gates a placement by it (`worldCovers`, the cut's cold
 * words), and the blend pass its items (`../../../blend/verdict/verdictWgsl.ts`, `cellDraws`, the
 * frame's words); the host's twin is `placementDraws` (`../worlds/worldLinks.ts`).
 */
export const linkDrawsWgsl = wgslFn(
  'linkDraws',
  [NO_INDEX],
  `fn linkDraws(h:u32,cellWord:u32,fileWord:u32)->bool{
 if(h!=NO_INDEX&&(h&${ACTOR_ROW}u)!=0u){return (cellWord&${CELL_DRAW.hlod}u)!=0u;}
 return ((cellWord|fileWord)&${CELL_DRAW.placements}u)!=0u;
}`,
)

/** The cell's word and whether a placement opens nothing, or is one of the world DAG's. */
const worldCoversWgsl = (links: string) =>
  `/** The word of HLOD cell \`h\` of instance \`k\` (\`CELL_DRAW\`), behind the links' header. */
fn worldCellState(k:u32,h:u32)->u32{
 let links=${links};
 return coldAt(${header(LINK_HEADER_AT.states)}+k*${header(LINK_HEADER_AT.cells)}+h);
}
/** Whether placement \`w\` opens nothing: neither its file's word — its main cell visible — nor its
 *  HLOD 0 cell's draws its placements; one in neither — a node always loaded, a placement of the
 *  world DAG — always opens. A row of a cell's actor (\`ACTOR_ROW\`) opens while its cell draws
 *  that actor, never in an instance not packed. Branched, not selected: a cut without a world
 *  reads no cold word. */
fn worldCovers(w:u32)->bool{
 let links=${links};
 if(links==0u){return false;}
 let link=links+${LINK_WORDS}u*w;
 let h=coldAt(link);
 let f=coldAt(link+2u);
 if(h==NO_INDEX&&f==NO_INDEX){return false;}
 var cellWord=0u;
 if(h!=NO_INDEX){
  let k=coldAt(link+1u);
  if(k!=NO_INDEX){cellWord=worldCellState(k,h&~${ACTOR_ROW}u);}
 }
 var fileWord=0u;
 if(f!=NO_INDEX){fileWord=coldAt(${header(LINK_HEADER_AT.files)}+f);}
 return !linkDraws(h,cellWord,fileWord);
}
/** Whether placement \`w\` is one of the world DAG's: its actors' switches gate it. */
fn worldPlaced(w:u32)->bool{
 let links=${links};
 return links!=0u&&(markOf(w)&${WORLD_ROOT_MARK}u)!=0u;
}
`

/** Whether a world actor or a node of its subtree is hidden, and the verdict on a resident page. */
const worldHidesWgsl = (links: string) =>
  `/** Whether the actor of HLOD cell \`h\`, in world placement \`w\`'s instance, is not drawn: its cell
 *  does not draw it. \`NO_INDEX\` — several actors' — hides nothing. */
fn worldActorHidden(w:u32,h:u32)->bool{
 if(h==NO_INDEX){return false;}
 let links=${links};
 return (worldCellState(coldAt(links+${LINK_WORDS}u*w+1u),h)&${CELL_DRAW.hlod}u)==0u;
}
/** Whether page \`i\` of placement \`w\` is a world cluster whose cell does not draw its actor. */
fn worldHides(i:u32,w:u32)->bool{
 if(!worldPlaced(w)){return false;}
 let links=${links};
 return worldActorHidden(w,coldAt(${header(LINK_HEADER_AT.ranks)}+i-pageBaseOf(w)));
}
/** Whether node \`c\` of placement \`w\` lies in the subtree of a world actor whose cell does not draw
 *  it: neither opened, nor drawn, nor asked for. */
fn worldNodeHides(c:u32,w:u32)->bool{
 if(!worldPlaced(w)){return false;}
 let links=${links};
 return worldActorHidden(w,coldAt(${header(LINK_HEADER_AT.nodes)}+c));
}
/** Whether resident page \`i\` of placement \`w\` draws as the switch has it: its placement opens and,
 *  a world cluster, its cell draws its actor. The one verdict a pass beside the descent reads of
 *  the switch. */
fn worldDraws(i:u32,w:u32)->bool{return !worldCovers(w)&&!worldHides(i,w);}
`

/**
 * The world's switch in the descent (`../worlds/worldLinks.ts`): per HLOD cell and instance, and
 * per cell file, what the host chose to draw there (`CELL_DRAW`, `../worlds/worldFollow.ts`). A
 * placement neither its file — shown as its main cell — nor its HLOD 0 cell draws opens nothing; a
 * node of the world DAG in the subtree of an actor whose cell does not draw it is not opened
 * (`worldNodeHides`), as nothing of an actor not shown is: every page under such a node is that
 * actor's (`hlod/chain/merge.rs`). Outside the level text, so a descent of another shape reads the
 * same words, and a pass beside the descent the same switch on a resident page (`worldDraws`): the
 * shadow casters (`../../../lighting/shadows/vsm/render/renderCandidatesWgsl.ts`), so that what the
 * view does not draw casts nothing.
 *
 * `links` is the WGSL expression of the cold word the placements' links start at, zero for a cut
 * that follows no world: the descent's uniform (`DAG_WORLD_GATE_WGSL`), or a pass's own. Its
 * variants share one name: a program holding two is refused. Its host binds the cut's cold words
 * as `cold` and its frame words as `frames`, read through `coldAt`, `markOf` and `pageBaseOf`.
 */
export const worldGateWgsl = (links: string) =>
  wgslBlock(
    'worldGateWgsl',
    [NO_INDEX, linkDrawsWgsl, DAG_COLD_AT_WGSL, DAG_MARK_OF_WGSL, DAG_PAGE_BASE_OF_WGSL],
    worldCoversWgsl(links) + worldHidesWgsl(links),
  )

/** The descent's gate, the links' first word on its uniform (`../viewLayout.ts`, `worldLinks`). */
export const DAG_WORLD_GATE_WGSL = worldGateWgsl('cutView.worldLinks')
