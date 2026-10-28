import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../../gpu/core/textureLimits.ts'
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

/** The channels a value of the network carries: one (a scalar), two, three (a colour) or four. */
export type Channels = 1 | 2 | 3 | 4

/**
 * THE WIDTHS THE NETWORK'S OPERATORS ARE MADE FOR, by operator: a value is worked on at the number
 * of channels it really carries, and a channel nobody reads is not worked on at all. Four channels
 * where the four are used: the translucency's blur (the colour and its coverage), the energy past
 * the clamp and the raw rejection (`measureRejection`). The names of the operators of width 4 are
 * those of the text (`minMax3x3`); of another width, the name ends in `W` and the width
 * (`minMax3x3W3`).
 */
export const NETWORK_WIDTHS = {
  extrema: [4, 3, 2, 1],
  sums: [4, 3, 2, 1],
  median: [4, 2],
  statistics: [3],
  boxAndPlus: [2],
  pairs: [3],
} as const satisfies Record<string, readonly Channels[]>

/** The suffix a width gives the names of the network: none at four channels. */
export const widthSuffix = (n: Channels) => (n === 4 ? '' : `W${n}`)

/** The text of `line(r)` for each row `r` of a lane's column, one line each, the row written out:
 *  the operators below index their arrays by constants alone. */
const eachRow = (line: (r: number) => string) =>
  Array.from({ length: LANE_ROWS }, (_, r) => line(r)).join('\n')

/** The type of a value of `n` channels in precision `p`. */
const typeOf = (p: Precision, n: Channels) => [p.F, p.V2, p.V3, p.V4][n - 1]

/** The cell of the network's memory (four channels) holding a value of `n` channels `expr`, zeroing
 *  the channels it does not have. */
const toCell = (p: Precision, n: Channels, expr: string) =>
  n === 4 ? expr : `${p.V4}(${expr}${',0.0'.repeat(4 - n)})`
/** The value of `n` channels a cell holds. */
const fromCell = (n: Channels, expr: string) => (n === 4 ? expr : `${expr}.${'xyzw'.slice(0, n)}`)

/** The text of `fold(c, r)` for each row, under the column `dx` of the shared values loaded as
 *  `c`, in a scope of its own: the column is dropped once the rows are folded. The lane's own column
 *  (`dx` 0) takes its four rows from the operator's argument `v`, the values it shared, and reads
 *  from workgroup memory only the row above and the row below. */
const overColumn = (n: Channels, dx: number, fold: (r: number) => string) => {
  const w = widthSuffix(n)
  return ` {let c=${dx === 0 ? `ownColumn${w}(v,s)` : `column${w}(v,${dx},s)`};\n${eachRow(fold)}\n }`
}

/** The cells the operators read around a lane's column, the variant's own: the two rows beside it
 *  (`above`, `below`, a column `dx` across), the four rows of a column across (`across`), and the
 *  exchange that makes them readable (`share`, and `share2` of two values at once where the memory
 *  holds both). A reader takes the slot `s` of the exchange its value is in: 0 of a `share`, 0 or 1
 *  of a `share2`. Everything else the network is made of is the same text, so both variants fold
 *  the same values in the same order. The cells hold four channels whatever the width of the value
 *  they carry (the memory is the same), a narrower one writing and reading its own. */
const SHARED_TILE_TEXT = `
var<private> laneX:i32;
var<private> laneRow:i32;`

/** The types and the column of the width `n`: the four texels of a lane (`Px`), the six rows its
 *  operators read (`Column`), the box (`Box`). */
const widthTypesText = (p: Precision, n: Channels) => {
  const w = widthSuffix(n),
    T = typeOf(p, n)
  return `
alias Px${w}=array<${T},${LANE_ROWS}>;
alias Column${w}=array<${T},${LANE_ROWS + 2}>;
/** The column \`dx\` texels across of the shared values, the rows from one above the lane's first to
 *  one below its last: each cell read once, for the lane's rows to share. Row \`r\` of the lane, \`dy\`
 *  rows down, is \`c[r+1+dy]\`. */
fn column${w}(v:Px${w},dx:i32,s:u32)->Column${w}{
 var c:Column${w};
 c[0]=above${w}(dx,s);
 let m=across${w}(v,dx,s);
${eachRow((r) => ` c[${r + 1}]=m[${r}];`)}
 c[${LANE_ROWS + 1}]=below${w}(dx,s);
 return c;
}
/** The lane's own column, the rows from one above its first to one below its last: the four it holds
 *  are its argument's \`v\`, which it has just shared, the two beside them are read. */
fn ownColumn${w}(v:Px${w},s:u32)->Column${w}{
 var c:Column${w};
 c[0]=above${w}(0,s);
${eachRow((r) => ` c[${r + 1}]=v[${r}];`)}
 c[${LANE_ROWS + 1}]=below${w}(0,s);
 return c;
}
struct Box${w}{lo:Px${w},hi:Px${w}}`
}

/** The cells of one value of an exchange: the tile's texels (the wave network's two halves of
 *  edge rows come to as many). */
const SLOT_CELLS = REJECT_SHADING_TILE * REJECT_SHADING_TILE

/** Whether the network's memory holds the two values of an exchange (`share2`): twice the tile in
 *  the precision's four-component values is within the guaranteed workgroup memory in 16 bits, not
 *  in 32, where an operator over two values is two exchanges. */
const holdsPairs = ({ F }: Precision) =>
  2 * SLOT_CELLS * 4 * (F === 'f16' ? 2 : 4) <= GUARANTEED_WORKGROUP_BYTES
const slotsOf = (p: Precision) => (holdsPairs(p) ? 2 : 1)

/** The exchanges of the width `n`: \`share(v)\` and, where the memory holds two values
 *  (\`holdsPairs\`), \`share2(a,b)\` — \`open\`, each value stored in its slot (\`store\`), \`close\`. */
const sharesText = (
  p: Precision,
  n: Channels,
  open: string,
  store: (value: string, slot: number) => string,
  close: string,
) => {
  const w = widthSuffix(n)
  return (holdsPairs(p) ? [['v'], ['a', 'b']] : [['v']])
    .map(
      (values) => `
fn share${values.length > 1 ? values.length : ''}${w}(${values.map((x) => `${x}:Px${w}`).join(',')}){
 ${open}
${values.map(store).join('\n')}
 ${close}
}`,
    )
    .join('')
}

/** The network's tile in workgroup memory, the cells every width reads. */
const networkTileText = (p: Precision) => `
var<workgroup> network:array<${p.V4},${slotsOf(p) * SLOT_CELLS}>;
fn networkAt(x:i32,y:i32,s:u32)->u32{return s*${SLOT_CELLS}u+u32((y&${REJECT_SHADING_TILE - 1})*${REJECT_SHADING_TILE}+(x&${REJECT_SHADING_TILE - 1}));}
/** The cell \`dx\` texels across and \`dy\` rows down from the lane's first, in slot \`s\`. */
fn cell(dx:i32,dy:i32,s:u32)->${p.V4}{return network[networkAt(laneX+dx,laneRow+dy,s)];}`

/** The exchanges and the reads of the width `n` over the tile in workgroup memory. */
const widthTileText = (p: Precision, n: Channels) => {
  const w = widthSuffix(n),
    T = typeOf(p, n)
  return `${sharesText(
    p,
    n,
    'workgroupBarrier();',
    (x, s) =>
      ` for(var r=0;r<${LANE_ROWS};r++){network[networkAt(laneX,laneRow+r,${s}u)]=${toCell(p, n, `${x}[r]`)};}`,
    'workgroupBarrier();',
  )}
fn above${w}(dx:i32,s:u32)->${T}{return ${fromCell(n, 'cell(dx,-1,s)')};}
fn below${w}(dx:i32,s:u32)->${T}{return ${fromCell(n, `cell(dx,${LANE_ROWS},s)`)};}
fn across${w}(v:Px${w},dx:i32,s:u32)->Px${w}{
 var o:Px${w};
 for(var r=0;r<${LANE_ROWS};r++){o[r]=${fromCell(n, 'cell(dx,r,s)')};}
 return o;
}`
}

/** The subgroups of a workgroup of the wave network: each holds one row of lanes, the tile's width. */
const EDGE_GROUPS = REJECT_SHADING_LANES / REJECT_SHADING_TILE

/** The cells of one exchange of the wave network: each subgroup's first and last row. */
const EDGE_CELLS = 2 * EDGE_GROUPS * REJECT_SHADING_TILE

/**
 * The wave network's tile: a subgroup is a row of the tile's lanes, so a column across is the
 * neighbouring lane's, which the lane takes from it by a shuffle (`across`, in the value's own type,
 * with no widening conversion), the lane at the tile's edge wrapping to its other side as the
 * workgroup memory's reads do; only the first and last row of each subgroup's rows go through workgroup
 * memory (`share`, `above`, `below`), the rows the subgroups above and below read. Two exchanges
 * alternate (`sharePhase`): an exchange writes the half the one before last was read from, and
 * every lane read that one before it reached the last exchange's barrier, so one barrier an
 * exchange is enough. A `share2` stores two values' rows, a slot each, in the one exchange.
 */
const waveTileText = (p: Precision) => `
var<workgroup> network:array<${p.V4},${2 * slotsOf(p) * EDGE_CELLS}>;
var<private> sharePhase:u32;
/** The shared first (\`bottom\` 0) or last row of the rows of subgroup \`group\`, at column \`x\`, in
 *  slot \`s\` of the half of the current exchange. */
fn edgeAt(group:i32,bottom:i32,x:i32,s:u32)->u32{return (sharePhase*${slotsOf(p)}u+s)*${EDGE_CELLS}u+u32(((group&${EDGE_GROUPS - 1})*2+bottom)*${REJECT_SHADING_TILE}+(x&${REJECT_SHADING_TILE - 1}));}`

/** The exchanges and the reads of the width `n` over the wave network's edge rows. */
const widthWaveText = (p: Precision, n: Channels) => {
  const w = widthSuffix(n),
    T = typeOf(p, n)
  return `${sharesText(
    p,
    n,
    'sharePhase^=1u;',
    (x, s) => ` network[edgeAt(laneRow/${LANE_ROWS},0,laneX,${s}u)]=${toCell(p, n, `${x}[0]`)};
 network[edgeAt(laneRow/${LANE_ROWS},1,laneX,${s}u)]=${toCell(p, n, `${x}[${LANE_ROWS - 1}]`)};`,
    'workgroupBarrier();',
  )}
fn above${w}(dx:i32,s:u32)->${T}{return ${fromCell(n, `network[edgeAt(laneRow/${LANE_ROWS}-1,1,laneX+dx,s)]`)};}
fn below${w}(dx:i32,s:u32)->${T}{return ${fromCell(n, `network[edgeAt(laneRow/${LANE_ROWS}+1,0,laneX+dx,s)]`)};}
fn across${w}(v:Px${w},dx:i32,s:u32)->Px${w}{
 var o:Px${w};
 let source=u32((laneX+dx)&${REJECT_SHADING_TILE - 1});
 for(var r=0;r<${LANE_ROWS};r++){o[r]=subgroupShuffle(v[r],source);}
 return o;
}`
}

/** One column's lowest and highest of the three texels around row `r`, as text. */
const columnExtrema = (r: number) =>
  [
    `min(min(c[${r}],c[${r + 1}]),c[${r + 2}])`,
    `max(max(c[${r}],c[${r + 1}]),c[${r + 2}])`,
  ] as const

/** The fold of the column `dx` into each texel's minimum and maximum over the 3×3: the first column seeds them
 *  (`seed`), the others take the least and the greatest. */
const foldColumn = (n: Channels, dx: number, seed: boolean) =>
  overColumn(n, dx, (r) => {
    const [lo, hi] = columnExtrema(r)
    return seed
      ? `  b.lo[${r}]=${lo};b.hi[${r}]=${hi};`
      : `  b.lo[${r}]=min(b.lo[${r}],${lo});b.hi[${r}]=max(b.hi[${r}],${hi});`
  })

/** The fold of the column `dx` into the box and the plus (`boxAndPlus3x3`): the left column seeds the
 *  box and the plus with its middle row, the own column folds its three into both, the right its
 *  three into the box and its middle row into the plus. */
const foldBoxAndPlus = (n: Channels, dx: number) =>
  overColumn(n, dx, (r) => {
    const [lo, hi] = columnExtrema(r)
    const [plusLo, plusHi] = dx === 0 ? ['l', 'h'] : [`c[${r + 1}]`, `c[${r + 1}]`]
    return dx === -1
      ? `  box.lo[${r}]=${lo};box.hi[${r}]=${hi};plus.lo[${r}]=c[${r + 1}];plus.hi[${r}]=c[${r + 1}];`
      : `  {let l=${lo};let h=${hi};box.lo[${r}]=min(box.lo[${r}],l);box.hi[${r}]=max(box.hi[${r}],h);plus.lo[${r}]=min(plus.lo[${r}],${plusLo});plus.hi[${r}]=max(plus.hi[${r}],${plusHi});}`
  })

/** The network's minima and maxima over the 3×3: the first column seeds each texel's, the others
 *  fold into it. Each operator is the fold over a value already shared (`...Shared`, in slot `s`)
 *  and the exchange that shares it. */
const networkExtremaText = (n: Channels) => {
  const w = widthSuffix(n)
  return `fn minMaxShared${w}(v:Px${w},s:u32)->Box${w}{
 var b:Box${w};
${foldColumn(n, -1, true)}
${foldColumn(n, 0, false)}
${foldColumn(n, 1, false)}
 return b;
}
fn minMax3x3${w}(v:Px${w})->Box${w}{share${w}(v);return minMaxShared${w}(v,0u);}
fn min3x3${w}(v:Px${w})->Px${w}{return minMax3x3${w}(v).lo;}
fn max3x3${w}(v:Px${w})->Px${w}{return minMax3x3${w}(v).hi;}`
}

/** The box over the 3×3 and the one over the texel and its four nearest, of one share and one pass
 *  over the columns: the plus takes the middle row of the columns beside and the own column's three. */
const networkBoxAndPlusText = (n: Channels) => {
  const w = widthSuffix(n)
  return `struct BoxAndPlus${w}{box:Box${w},plus:Box${w}}
fn boxAndPlus3x3${w}(v:Px${w})->BoxAndPlus${w}{
 share${w}(v);
 let s=0u;
 var box:Box${w};var plus:Box${w};
${foldBoxAndPlus(n, -1)}
${foldBoxAndPlus(n, 0)}
${foldBoxAndPlus(n, 1)}
 return BoxAndPlus${w}(box,plus);
}`
}

/** The weighted sum of the column `c` around row `r` by the column weights `w`, as text. */
const columnSum = (r: number) => `(c[${r + 1}]*w.y+c[${r + 2}]*w.z+c[${r}]*w.x)`

/** The network's weighted sums over the 3×3 and what is made of them: the own column weighted by
 *  `h.y` first, then the right one's by `h.z` and the left one's by `h.x` added. */
const networkSumsText = ({ V3 }: Precision, n: Channels) => {
  const w = widthSuffix(n)
  return `fn weightedSumShared${w}(v:Px${w},h:${V3},w:${V3},s:u32)->Px${w}{
 var o:Px${w};
${overColumn(n, 0, (r) => `  o[${r}]=${columnSum(r)}*h.y;`)}
${overColumn(n, 1, (r) => `  o[${r}]=o[${r}]+${columnSum(r)}*h.z;`)}
${overColumn(n, -1, (r) => `  o[${r}]=o[${r}]+${columnSum(r)}*h.x;`)}
 return o;
}
fn weightedSum3x3${w}(v:Px${w},h:${V3},w:${V3})->Px${w}{share${w}(v);return weightedSumShared${w}(v,h,w,0u);}
fn blurShared${w}(v:Px${w},s:u32)->Px${w}{return weightedSumShared${w}(v,${V3}(0.25,0.5,0.25),${V3}(0.25,0.5,0.25),s);}
fn blur3x3${w}(v:Px${w})->Px${w}{share${w}(v);return blurShared${w}(v,0u);}
fn sum3x3${w}(v:Px${w})->Px${w}{return weightedSum3x3${w}(v,${V3}(1.0),${V3}(1.0));}
fn totalVariationShared${w}(v:Px${w},s:u32)->Px${w}{
 let sum=weightedSumShared${w}(v,${V3}(1.0),${V3}(0.125),s);
 var o:Px${w};
 for(var r=0;r<${LANE_ROWS};r++){o[r]=1.125*v[r]-sum[r];}
 return o;
}
fn totalVariation3x3${w}(v:Px${w})->Px${w}{share${w}(v);return totalVariationShared${w}(v,0u);}`
}

/** The fold of the column `dx` into the box, the binomial blur and the eighth of the sum of the nine:
 *  the own column seeds them, weighing the blur by the middle weight, the right then the left added
 *  as `weightedSum3x3` adds them. */
const foldStatistics = (n: Channels, dx: number) =>
  overColumn(n, dx, (r) => {
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
const networkStatisticsText = (n: Channels) => {
  const w = widthSuffix(n)
  return `struct Statistics${w}{box:Box${w},blurred:Px${w},variation:Px${w}}
fn statisticsShared${w}(v:Px${w},s:u32)->Statistics${w}{
 var box:Box${w};var blurred:Px${w};var eighths:Px${w};
${foldStatistics(n, 0)}
${foldStatistics(n, 1)}
${foldStatistics(n, -1)}
 var o:Statistics${w};
 o.box=box;o.blurred=blurred;
 for(var r=0;r<${LANE_ROWS};r++){o.variation[r]=1.125*v[r]-eighths[r];}
 return o;
}
fn statistics3x3${w}(v:Px${w})->Statistics${w}{share${w}(v);return statisticsShared${w}(v,0u);}`
}

/** The text of the lowest, median and highest of the column around row `r`. */
const columnMids = (n: Channels, r: number) =>
  `lowMidHigh${widthSuffix(n)}(c[${r + 1}],c[${r + 2}],c[${r}])`

/** The network's median over the 3×3: each column's lowest, median and highest (`lowMidHigh`), the own
 *  column's, then the right one's, then the left one's. The lowests and highests fold as they come, into the
 *  greatest lowest and the least highest; the own and right medians are kept for the left one's, whose
 *  three give the median median. The texel's median is that of the greatest lowest, the median median and
 *  the least highest. */
const networkMedianText = (p: Precision, n: Channels) => {
  const w = widthSuffix(n),
    T = typeOf(p, n)
  return `fn lowMidHigh${w}(a:${T},b:${T},c:${T})->array<${T},3>{
 let x=min(b,c);let y=max(b,c);let z=max(a,x);
 return array<${T},3>(min(a,x),min(z,y),max(z,y));
}
fn medianShared${w}(v:Px${w},s:u32)->Px${w}{
 var low:Px${w};var high:Px${w};var ownMid:Px${w};var rightMid:Px${w};
 var o:Px${w};
${overColumn(
  n,
  0,
  (r) => `  {let k=${columnMids(n, r)};low[${r}]=k[0];ownMid[${r}]=k[1];high[${r}]=k[2];}`,
)}
${overColumn(
  n,
  1,
  (r) =>
    `  {let k=${columnMids(n, r)};low[${r}]=max(low[${r}],k[0]);rightMid[${r}]=k[1];high[${r}]=min(high[${r}],k[2]);}`,
)}
${overColumn(
  n,
  -1,
  (r) => `  {let k=${columnMids(n, r)};
   let mid=lowMidHigh${w}(ownMid[${r}],rightMid[${r}],k[1])[1];
   o[${r}]=lowMidHigh${w}(max(low[${r}],k[0]),mid,min(high[${r}],k[2]))[1];}`,
)}
 return o;
}
fn median3x3${w}(v:Px${w})->Px${w}{share${w}(v);return medianShared${w}(v,0u);}`
}

/** An operator of the network, by its name over one value (`single`, which shares it), its fold over a
 *  shared one (`shared`) and the type it gives. */
interface Operator {
  readonly single: string
  readonly shared: string
  readonly type: string
}
const operatorsOfWidth = (n: Channels) => {
  const w = widthSuffix(n)
  return {
    MIN_MAX: { single: `minMax3x3${w}`, shared: `minMaxShared${w}`, type: `Box${w}` },
    BLUR: { single: `blur3x3${w}`, shared: `blurShared${w}`, type: `Px${w}` },
    STATISTICS: {
      single: `statistics3x3${w}`,
      shared: `statisticsShared${w}`,
      type: `Statistics${w}`,
    },
    VARIATION: {
      single: `totalVariation3x3${w}`,
      shared: `totalVariationShared${w}`,
      type: `Px${w}`,
    },
  } satisfies Record<string, Operator>
}

/** The operator `name` of two operators over two independent values of `n` channels: where the memory
 *  holds both (`holdsPairs`) they go through one exchange (`share2`), else each through its own; the
 *  results are those of the operators over each value alone. */
const pairText = (p: Precision, n: Channels, name: string, first: Operator, second: Operator) => {
  const w = widthSuffix(n)
  return `struct ${name}Result${w}{first:${first.type},second:${second.type}}
fn ${name}${w}(a:Px${w},b:Px${w})->${name}Result${w}{${
    holdsPairs(p)
      ? `
 share2${w}(a,b);
 return ${name}Result${w}(${first.shared}(a,0u),${second.shared}(b,1u));`
      : `
 return ${name}Result${w}(${first.single}(a),${second.single}(b));`
  }
}`
}

/** The pairs of operators the rejection runs over values that are ready together: the boxes of two
 *  values, the statistics of one with the total variation of another, a blur with a box. */
const networkPairsText = (p: Precision, n: Channels) => {
  const { MIN_MAX, BLUR, STATISTICS, VARIATION } = operatorsOfWidth(n)
  return [
    pairText(p, n, 'minMaxPair', MIN_MAX, MIN_MAX),
    pairText(p, n, 'statisticsAndVariation', STATISTICS, VARIATION),
    pairText(p, n, 'blurAndMinMax', BLUR, MIN_MAX),
  ].join('\n')
}

/** The network's vote of the workgroup, in the first cell of its memory (all of the guaranteed
 *  workgroup memory in 32 bits, the exchange that comes next writes it again: the tile's exchange
 *  opens with a barrier, the wave one's does not, so its vote closes with one), and the
 *  interpolations the stages share. */
const networkReduceText = ({ F, V3, V4 }: Precision, wave: boolean) => `fn anyThread(x:bool)->bool{
 workgroupBarrier();
 if(laneX==0&&laneRow==0){network[0]=${V4}(0.0);}
 workgroupBarrier();
 if(x){network[0]=${V4}(1.0);}
 let voted=workgroupUniformLoad(&network[0]).x>0.0;${
   wave
     ? `
 // Every lane read the vote before any lane's next exchange writes its cell: the wave network's
 // exchanges open with no barrier of their own.
 workgroupBarrier();`
     : ''
 }
 return voted;
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
 * (`Px`, of the width its operator is made for, `NETWORK_WIDTHS`). An operator over the 3×3 of every
 * texel stores the tile's values once (`share`), then
 * streams the three columns around the lane's (`column`), one at a time, each folded into the
 * accumulators of the four texels and dropped — a cell of the 6 rows × 3 columns their
 * neighbourhoods cover is read once, not once for each texel that reads it, and no more than a
 * column is live at a time —: the column above and below first, then across, as a separable
 * convolution. Past the tile's edge the neighbourhood wraps around to its other side, so a value
 * `n` operators deep is exact only `n` texels in from the edge — the texels the workgroup only
 * reads (`REJECT_SHADING_OVERSCAN`) absorb that error.
 * - `minMax3x3`, `min3x3`, `max3x3`; `boxAndPlus3x3`, the box and the one over the texel and its
 *   four nearest, from one share;
 * - `weightedSum3x3` — the column weights `w` (above, own, below), then the row's `h` —, `blur3x3`,
 *   the binomial blur, `sum3x3`, and `totalVariation3x3`, 1.125 times the texel less the eighth of
 *   the nine's sum; `statistics3x3`, the box, the blur and the total variation of one value from one
 *   share;
 * - `median3x3`, each column's lowest, median and highest, then across: the median of the
 *   greatest lowest, the median median and the least highest;
 * - the pairs of independent values, one exchange for both (`share2`): `minMaxPair`,
 *   `statisticsAndVariation`, `blurAndMinMax`, `.first` and `.second` as the operators over each
 *   alone give them — in 32 bits, which the memory cannot hold twice, as two exchanges;
 * - `anyThread`, whether any invocation of the workgroup holds `x`, the same answer for all.
 *
 * The operators of a width fold the channels it has, each as the same operation in the same order
 * as the four-channel one, so a value gives the same bits at any width that holds its channels. The
 * memory is the four-channel cells whatever the width (a narrower value writes its channels and zeroes
 * the rest), so the memory and the barriers of an exchange are the same.
 *
 * Run as a `wave` of the tile's width (`rejectionWaveOf`), the horizontal exchange is a subgroup
 * shuffle and only each subgroup's first and last row go through workgroup memory (`waveTileText`);
 * the operators are the same text, so the two give the same values.
 *
 * The declarations in the order the program writes them, in precision `p`: the tile, which the others read, first.
 */
export const networkOf = (p: Precision, wave?: Wave) => {
  const W = NETWORK_WIDTHS
  const tile = wgslBlock(
    `REJECT_SHADING_NETWORK_TILE${wave ? '_WAVE' : ''}${p.S}_WGSL`,
    [...p.enable, ...(wave ? [waveDirectives(wave)] : [])],
    SHARED_TILE_TEXT + (wave ? waveTileText(p) : networkTileText(p)),
  )
  /** The types, the exchange and the reads of a width, the operators of it all read. */
  const widths = new Map<Channels, ReturnType<typeof wgslBlock>>()
  const widthOf = (n: Channels) => {
    let held = widths.get(n)
    if (!held)
      widths.set(
        n,
        (held = wgslBlock(
          `REJECT_SHADING_NETWORK_WIDTH${n}${wave ? '_WAVE' : ''}${p.S}_WGSL`,
          [tile],
          widthTypesText(p, n) + (wave ? widthWaveText(p, n) : widthTileText(p, n)),
        )),
      )
    return held
  }
  const block = (
    name: string,
    n: Channels,
    deps: readonly ReturnType<typeof wgslBlock>[],
    text: string,
  ) => wgslBlock(`REJECT_SHADING_NETWORK_${name}${n}${p.S}_WGSL`, [widthOf(n), ...deps], text)
  const extrema = new Map(
    W.extrema.map((n) => [n, block('EXTREMA', n, [], networkExtremaText(n))] as const),
  )
  const sums = new Map(W.sums.map((n) => [n, block('SUMS', n, [], networkSumsText(p, n))] as const))
  const statistics = new Map(
    W.statistics.map((n) => [n, block('STATISTICS', n, [], networkStatisticsText(n))] as const),
  )
  return [
    tile,
    ...extrema.values(),
    ...sums.values(),
    ...statistics.values(),
    ...W.median.map((n) => block('MEDIAN', n, [], networkMedianText(p, n))),
    ...W.boxAndPlus.map((n) => block('BOXPLUS', n, [], networkBoxAndPlusText(n))),
    ...W.pairs.map((n) =>
      block(
        'PAIRS',
        n,
        [extrema.get(n)!, sums.get(n)!, statistics.get(n)!],
        networkPairsText(p, n),
      ),
    ),
    wgslBlock(
      `REJECT_SHADING_NETWORK_REDUCE${wave ? '_WAVE' : ''}${p.S}_WGSL`,
      [tile],
      networkReduceText(p, !!wave),
    ),
  ]
}
