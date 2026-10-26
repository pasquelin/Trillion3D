import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import type { Precision } from './colorSpaceWgsl.ts'
import type { Wave } from './waveOps.ts'

/** The side of the square of render texels a workgroup of the shading rejection works on, in its
 *  workgroup memory, and the texels of it each side that are only read — its operators' results
 *  there are wrong, the tile's neighbourhood wrapping around — so a workgroup writes the inner
 *  `REJECT_SHADING_STRIDE` square. */
export const REJECT_SHADING_TILE = 32
export const REJECT_SHADING_OVERSCAN = 3
export const REJECT_SHADING_STRIDE = REJECT_SHADING_TILE - 2 * REJECT_SHADING_OVERSCAN
/** The texels of a column each invocation holds: four, one above the other. A texel a lane, the
 *  tile's 1024 lanes, is past the 256 invocations a workgroup holds at most
 *  (`maxComputeInvocationsPerWorkgroup`, its default and the least an adapter grants): four a lane
 *  is the fewest that fit. */
export const LANE_ROWS = 4
/** The invocations of a workgroup. */
export const REJECT_SHADING_LANES = (REJECT_SHADING_TILE * REJECT_SHADING_TILE) / LANE_ROWS

/** The text of `line(r)` for each row `r` of a lane's column, one line each, the row written out:
 *  the operators below index their arrays by constants alone. */
const eachRow = (line: (r: number) => string) =>
  Array.from({ length: LANE_ROWS }, (_, r) => line(r)).join('\n')

/** The text of `fold(c, r)` for each row, under the column `dx` of the shared values loaded as
 *  `c`, in a scope of its own: the column is dropped once the rows are folded. The lane's own column
 *  (`dx` 0) takes its four rows from the operator's argument `v`, the values it shared, and reads
 *  from workgroup memory only the row above and the row below. */
const overColumn = (dx: number, fold: (r: number) => string) =>
  ` {let c=${dx === 0 ? 'ownColumn(v)' : `column(v,${dx})`};\n${eachRow(fold)}\n }`

/** The cells the operators read around a lane's column, the variant's own: the two rows beside it
 *  (`above`, `below`, a column `dx` across), the four rows of a column across (`across`), and the
 *  exchange that makes them readable (`share`). Everything else the network is made of is the same
 *  text, so both variants fold the same values in the same order. */
const sharedTileText = ({ V4 }: Precision) => `
alias Px=array<${V4},${LANE_ROWS}>;
var<private> laneX:i32;
var<private> laneRow:i32;
alias Column=array<${V4},${LANE_ROWS + 2}>;
/** The column \`dx\` texels across of the shared values, the rows from one above the lane's first to
 *  one below its last: each cell read once, for the lane's rows to share. Row \`r\` of the lane, \`dy\`
 *  rows down, is \`c[r+1+dy]\`. */
fn column(v:Px,dx:i32)->Column{
 var c:Column;
 c[0]=above(dx);
 let m=across(v,dx);
${eachRow((r) => ` c[${r + 1}]=m[${r}];`)}
 c[${LANE_ROWS + 1}]=below(dx);
 return c;
}
/** The lane's own column, the rows from one above its first to one below its last: the four it holds
 *  are its argument's \`v\`, which it has just shared, the two beside them are read. */
fn ownColumn(v:Px)->Column{
 var c:Column;
 c[0]=above(0);
${eachRow((r) => ` c[${r + 1}]=v[${r}];`)}
 c[${LANE_ROWS + 1}]=below(0);
 return c;
}
struct Box{lo:Px,hi:Px}`

/** The network's tile in workgroup memory: its lanes, their exchange and the neighbours' reads. */
const networkTileText = ({ V4 }: Precision) => `
var<workgroup> network:array<${V4},${REJECT_SHADING_TILE * REJECT_SHADING_TILE}>;
fn networkAt(x:i32,y:i32)->u32{return u32((y&${REJECT_SHADING_TILE - 1})*${REJECT_SHADING_TILE}+(x&${REJECT_SHADING_TILE - 1}));}
fn share(v:Px){
 workgroupBarrier();
 for(var r=0;r<${LANE_ROWS};r++){network[networkAt(laneX,laneRow+r)]=v[r];}
 workgroupBarrier();
}
/** The shared value \`dx\` texels across and \`dy\` rows down from the lane's first. */
fn cell(dx:i32,dy:i32)->${V4}{return network[networkAt(laneX+dx,laneRow+dy)];}
fn above(dx:i32)->${V4}{return cell(dx,-1);}
fn below(dx:i32)->${V4}{return cell(dx,${LANE_ROWS});}
fn across(v:Px,dx:i32)->Px{
 var o:Px;
 for(var r=0;r<${LANE_ROWS};r++){o[r]=cell(dx,r);}
 return o;
}`

/** The subgroups of a workgroup of the wave network: each holds one row of lanes, the tile's width. */
const EDGE_GROUPS = REJECT_SHADING_LANES / REJECT_SHADING_TILE

/**
 * The wave network's tile: a subgroup is a row of the tile's lanes, so a column across is the
 * neighbouring lane's, which the lane takes from it by a shuffle (`across`), the lane at the tile's
 * edge wrapping to its other side as the workgroup memory's reads do; only the first and last row of
 * each subgroup's rows go through workgroup memory (`share`, `above`, `below`), the rows the
 * subgroups above and below read.
 */
const waveTileText = ({ V4 }: Precision) => `
var<workgroup> network:array<${V4},${2 * EDGE_GROUPS * REJECT_SHADING_TILE}>;
/** The shared first (\`bottom\` 0) or last row of the rows of subgroup \`group\`, at column \`x\`. */
fn edgeAt(group:i32,bottom:i32,x:i32)->u32{return u32(((group&${EDGE_GROUPS - 1})*2+bottom)*${REJECT_SHADING_TILE}+(x&${REJECT_SHADING_TILE - 1}));}
fn share(v:Px){
 workgroupBarrier();
 network[edgeAt(laneRow/${LANE_ROWS},0,laneX)]=v[0];
 network[edgeAt(laneRow/${LANE_ROWS},1,laneX)]=v[${LANE_ROWS - 1}];
 workgroupBarrier();
}
fn above(dx:i32)->${V4}{return network[edgeAt(laneRow/${LANE_ROWS}-1,1,laneX+dx)];}
fn below(dx:i32)->${V4}{return network[edgeAt(laneRow/${LANE_ROWS}+1,0,laneX+dx)];}
fn across(v:Px,dx:i32)->Px{
 var o:Px;
 let source=u32((laneX+dx)&${REJECT_SHADING_TILE - 1});
 for(var r=0;r<${LANE_ROWS};r++){o[r]=${V4}(subgroupShuffle(vec4f(v[r]),source));}
 return o;
}`

/** One column's lowest and highest of the three texels around row `r`, as text. */
const columnExtrema = (r: number) =>
  [
    `min(min(c[${r}],c[${r + 1}]),c[${r + 2}])`,
    `max(max(c[${r}],c[${r + 1}]),c[${r + 2}])`,
  ] as const

/** The fold of the column `dx` into each texel's minimum and maximum over the 3×3: the first column seeds them
 *  (`seed`), the others take the least and the greatest. */
const foldColumn = (dx: number, seed: boolean) =>
  overColumn(dx, (r) => {
    const [lo, hi] = columnExtrema(r)
    return seed
      ? `  b.lo[${r}]=${lo};b.hi[${r}]=${hi};`
      : `  b.lo[${r}]=min(b.lo[${r}],${lo});b.hi[${r}]=max(b.hi[${r}],${hi});`
  })

/** The network's minima and maxima over the 3×3: the first column seeds each texel's, the others
 *  fold into it. */
const networkExtremaText = () => `fn minMax3x3(v:Px)->Box{
 share(v);
 var b:Box;
${foldColumn(-1, true)}
${foldColumn(0, false)}
${foldColumn(1, false)}
 return b;
}
fn min3x3(v:Px)->Px{return minMax3x3(v).lo;}
fn max3x3(v:Px)->Px{return minMax3x3(v).hi;}
fn minMaxPlus3x3(v:Px)->Box{
 share(v);
 let own=ownColumn(v);
 let west=across(v,-1);let east=across(v,1);
 var b:Box;
${eachRow(
  (
    r,
  ) => `  b.lo[${r}]=min(min(west[${r}],east[${r}]),min(min(own[${r + 2}],own[${r}]),own[${r + 1}]));
  b.hi[${r}]=max(max(west[${r}],east[${r}]),max(max(own[${r + 2}],own[${r}]),own[${r + 1}]));`,
)}
 return b;
}`

/** The weighted sum of the column `c` around row `r` by the column weights `w`, as text. */
const columnSum = (r: number) => `(c[${r + 1}]*w.y+c[${r + 2}]*w.z+c[${r}]*w.x)`

/** The network's weighted sums over the 3×3 and what is made of them: the own column weighted by
 *  `h.y` first, then the right one's by `h.z` and the left one's by `h.x` added. */
const networkSumsText = ({ V3 }: Precision) => `fn weightedSum3x3(v:Px,h:${V3},w:${V3})->Px{
 share(v);
 var o:Px;
${overColumn(0, (r) => `  o[${r}]=${columnSum(r)}*h.y;`)}
${overColumn(1, (r) => `  o[${r}]=o[${r}]+${columnSum(r)}*h.z;`)}
${overColumn(-1, (r) => `  o[${r}]=o[${r}]+${columnSum(r)}*h.x;`)}
 return o;
}
fn blur3x3(v:Px)->Px{return weightedSum3x3(v,${V3}(0.25,0.5,0.25),${V3}(0.25,0.5,0.25));}
fn sum3x3(v:Px)->Px{return weightedSum3x3(v,${V3}(1.0),${V3}(1.0));}
fn totalVariation3x3(v:Px)->Px{
 let s=weightedSum3x3(v,${V3}(1.0),${V3}(0.125));
 var o:Px;
 for(var r=0;r<${LANE_ROWS};r++){o[r]=1.125*v[r]-s[r];}
 return o;
}`

/** The fold of the column `dx` into the box, the binomial blur and the eighth of the sum of the nine:
 *  the own column seeds them, weighing the blur by the middle weight, the right then the left added
 *  as `weightedSum3x3` adds them. */
const foldStatistics = (dx: number) =>
  overColumn(dx, (r) => {
    const [lo, hi] = columnExtrema(r)
    const blur = `(c[${r + 1}]*0.5+c[${r + 2}]*0.25+c[${r}]*0.25)`
    const eighth = `(c[${r + 1}]*0.125+c[${r + 2}]*0.125+c[${r}]*0.125)`
    return dx === 0
      ? `  box.lo[${r}]=${lo};box.hi[${r}]=${hi};blurred[${r}]=${blur}*0.5;eighths[${r}]=${eighth};`
      : `  box.lo[${r}]=min(box.lo[${r}],${lo});box.hi[${r}]=max(box.hi[${r}],${hi});blurred[${r}]=blurred[${r}]+${blur}*0.25;eighths[${r}]=eighths[${r}]+${eighth};`
  })

/** The network's box, blur and total variation of one value, from one share and one pass over the
 *  columns: what `minMax3x3`, `blur3x3` and `totalVariation3x3` give it, which each would share and
 *  read again. */
const networkStatisticsText = () => `struct Statistics{box:Box,blurred:Px,variation:Px}
fn statistics3x3(v:Px)->Statistics{
 share(v);
 var box:Box;var blurred:Px;var eighths:Px;
${foldStatistics(0)}
${foldStatistics(1)}
${foldStatistics(-1)}
 var s:Statistics;
 s.box=box;s.blurred=blurred;
 for(var r=0;r<${LANE_ROWS};r++){s.variation[r]=1.125*v[r]-eighths[r];}
 return s;
}`

/** The text of the lowest, median and highest of the column around row `r`. */
const columnMids = (r: number) => `lowMidHigh(c[${r + 1}],c[${r + 2}],c[${r}])`

/** The network's median over the 3×3: each column's lowest, median and highest (`lowMidHigh`), the own
 *  column's, then the right one's, then the left one's. The lowests and highests fold as they come, into the
 *  greatest lowest and the least highest; the own and right medians are kept for the left one's, whose
 *  three give the median median. The texel's median is that of the greatest lowest, the median median and
 *  the least highest. */
const networkMedianText = ({
  V4,
}: Precision) => `fn lowMidHigh(a:${V4},b:${V4},c:${V4})->array<${V4},3>{
 let x=min(b,c);let y=max(b,c);let z=max(a,x);
 return array<${V4},3>(min(a,x),min(z,y),max(z,y));
}
fn median3x3(v:Px)->Px{
 share(v);
 var low:Px;var high:Px;var ownMid:Px;var rightMid:Px;
 var o:Px;
${overColumn(
  0,
  (r) => `  {let k=${columnMids(r)};low[${r}]=k[0];ownMid[${r}]=k[1];high[${r}]=k[2];}`,
)}
${overColumn(
  1,
  (r) =>
    `  {let k=${columnMids(r)};low[${r}]=max(low[${r}],k[0]);rightMid[${r}]=k[1];high[${r}]=min(high[${r}],k[2]);}`,
)}
${overColumn(
  -1,
  (r) => `  {let k=${columnMids(r)};
   let mid=lowMidHigh(ownMid[${r}],rightMid[${r}],k[1])[1];
   o[${r}]=lowMidHigh(max(low[${r}],k[0]),mid,min(high[${r}],k[2]))[1];}`,
)}
 return o;
}`

/** The network's vote of the workgroup, and the interpolations the stages share. */
const networkReduceText = ({ F, V3, V4 }: Precision) => `fn anyThread(x:bool)->bool{
 workgroupBarrier();
 if(laneX==0&&laneRow==0){network[0]=${V4}(0.0);}
 workgroupBarrier();
 if(x){network[0]=${V4}(1.0);}
 return workgroupUniformLoad(&network[0]).x>0.0;
}
fn lerpOf(a:${F},b:${F},t:${F})->${F}{return a+t*(b-a);}
fn lerp3(a:${V3},b:${V3},t:${F})->${V3}{return a+t*(b-a);}`

/** The wave variant the network runs as on `wave`, none where its subgroup is not the tile's width
 *  (`REJECT_SHADING_TILE`): a row of the tile's lanes is the subgroup the layout needs. */
export const rejectionWaveOf = (wave: Wave | undefined) =>
  wave?.lanes === REJECT_SHADING_TILE ? wave : undefined

/** The directives of the wave variant: its subgroup operations, and its size where it is pinned
 *  (`Wave.pinned`); subgroup uniformity is left unchecked, as the history update's. */
const waveDirectives = ({ pinned }: Wave) =>
  wgslBlock(
    `REJECT_SHADING_WAVE${pinned ? '_PINNED' : ''}_WGSL`,
    [],
    `enable subgroups;\n${pinned ? 'enable subgroup_size_control;\n' : ''}diagnostic(off,subgroup_uniformity);`,
  )

/**
 * The convolution network of the shading rejection, in workgroup memory: a workgroup holds a
 * `REJECT_SHADING_TILE` square of render texels, each invocation a column of `LANE_ROWS` of them
 * (`laneX`, `laneRow`, its first); a value of the network is an array of the four texels' values
 * (`Px`). An operator over the 3×3 of every texel stores the tile's values once (`share`), then
 * streams the three columns around the lane's (`column`), one at a time, each folded into the
 * accumulators of the four texels and dropped — a cell of the 6 rows × 3 columns their
 * neighbourhoods cover is read once, not once for each texel that reads it, and no more than a
 * column is live at a time —: the column above and below first, then across, as a separable
 * convolution. Past the tile's edge the neighbourhood wraps around to its other side, so a value
 * `n` operators deep is exact only `n` texels in from the edge — the texels the workgroup only
 * reads (`REJECT_SHADING_OVERSCAN`) absorb that error.
 * - `minMax3x3`, `min3x3`, `max3x3`; `minMaxPlus3x3`, over the texel and its four nearest;
 * - `weightedSum3x3` — the column weights `w` (above, own, below), then the row's `h` —, `blur3x3`,
 *   the binomial blur, `sum3x3`, and `totalVariation3x3`, 1.125 times the texel less the eighth of
 *   the nine's sum; `statistics3x3`, the box, the blur and the total variation of one value from one
 *   share;
 * - `median3x3`, each column's lowest, median and highest, then across: the median of the
 *   greatest lowest, the median median and the least highest;
 * - `anyThread`, whether any invocation of the workgroup holds `x`, the same answer for all.
 *
 * Run as a `wave` of the tile's width (`rejectionWaveOf`), the horizontal exchange is a subgroup
 * shuffle and only each subgroup's first and last row go through workgroup memory (`waveTileText`);
 * the operators are the same text, so the two give the same values.
 *
 * The declarations in the order the program writes them, in precision `p`: the tile, which the others read, first.
 */
export const networkOf = (p: Precision, wave?: Wave) => {
  const tile = wgslBlock(
    `REJECT_SHADING_NETWORK_TILE${wave ? '_WAVE' : ''}${p.S}_WGSL`,
    [...p.enable, ...(wave ? [waveDirectives(wave)] : [])],
    sharedTileText(p) + (wave ? waveTileText(p) : networkTileText(p)),
  )
  return [
    tile,
    wgslBlock(`REJECT_SHADING_NETWORK_EXTREMA${p.S}_WGSL`, [tile], networkExtremaText()),
    wgslBlock(`REJECT_SHADING_NETWORK_SUMS${p.S}_WGSL`, [tile], networkSumsText(p)),
    wgslBlock(`REJECT_SHADING_NETWORK_STATISTICS${p.S}_WGSL`, [tile], networkStatisticsText()),
    wgslBlock(`REJECT_SHADING_NETWORK_MEDIAN${p.S}_WGSL`, [tile], networkMedianText(p)),
    wgslBlock(`REJECT_SHADING_NETWORK_REDUCE${p.S}_WGSL`, [tile], networkReduceText(p)),
  ]
}
