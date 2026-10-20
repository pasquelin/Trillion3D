import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import {
  CELL_DRAW,
  LINK_HEADER,
  LINK_WORDS,
  PLACEMENT_BITS,
  WORLD_ROOT_MARK,
} from '../worldLinks.ts'

/**
 * The world's switch in the descent (`../worldLinks.ts`): per HLOD cell and instance, what the host
 * chose to draw there (`CELL_DRAW`, `../worldFollow.ts`). A placement whose HLOD 0 cell neither
 * draws nor asks for its placements opens nothing, and one that asks draws none; a world cluster
 * whose cell does not draw its actor is neither drawn nor asked for. Outside the level text, so a
 * descent of another shape reads the same words.
 */
export const DAG_WORLD_GATE_WGSL = wgslBlock(
  'DAG_WORLD_GATE_WGSL',
  [NO_INDEX],
  `/** The word of HLOD cell \`h\` of instance \`k\` (\`CELL_DRAW\`), behind the links' header. */
fn worldCellState(k:u32,h:u32)->u32{
 let links=views[0u].worldLinks;
 return coldAt(coldAt(links-${LINK_HEADER - 1}u)+k*coldAt(links-${LINK_HEADER - 2}u)+h);
}
/** The word of placement \`w\`'s HLOD 0 cell, its placements drawn for one in no cell — a node
 *  always loaded. Branched, not selected: a cut without a world reads no cold word for it. */
fn worldStateOf(w:u32)->u32{
 let links=views[0u].worldLinks;
 if(links==0u){return ${CELL_DRAW.placements}u;}
 let link=links+${LINK_WORDS}u*w;
 let h=coldAt(link);
 if(h==NO_INDEX){return ${CELL_DRAW.placements}u;}
 return worldCellState(coldAt(link+1u),h);
}
/** Whether placement \`w\` opens nothing: its cell neither draws nor asks for its placements. */
fn worldCovers(w:u32)->bool{return (worldStateOf(w)&${PLACEMENT_BITS}u)==0u;}
/** Whether placement \`w\` asks for its pages and draws none. */
fn worldWaits(w:u32)->bool{return (worldStateOf(w)&${PLACEMENT_BITS}u)==${CELL_DRAW.asking}u;}
/** Whether page \`i\` of placement \`w\` is a world cluster whose cell does not draw its actor:
 *  neither drawn nor asked for. */
fn worldHides(i:u32,w:u32)->bool{
 let links=views[0u].worldLinks;
 if(links==0u||(markOf(w)&${WORLD_ROOT_MARK}u)==0u){return false;}
 let h=coldAt(coldAt(links-${LINK_HEADER}u)+i-pageBaseOf(w));
 return (worldCellState(coldAt(links+${LINK_WORDS}u*w+1u),h)&${CELL_DRAW.hlod}u)==0u;
}
`,
)
