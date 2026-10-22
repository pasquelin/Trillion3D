import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { BOUNCE_GRID_HEAD_WGSL } from '../gridWgsl.ts'

/** Neighbours a probe is filtered with: the cells next to its own on each axis, both sides. */
const FILTER_NEIGHBOURS = 6
/** Bytes of workgroup memory the filter holds: for each neighbour its slot (a word) and the two vectors
 *  of its mean distances, 16 bytes each in an array. */
export const FILTER_BYTES = FILTER_NEIGHBOURS * (4 + 2 * 16)

/**
 * THE PROBES' SPATIAL FILTER (`BOUNCE_SETTINGS.filterProbes`): a probe's fresh estimate is averaged with its
 * six neighbours' — the cells beside its own on each axis, one level — before it is kept, so that the
 * field is not as many estimates as probes, each its own few rays' noise. Own estimate weighs one; a
 * neighbour's weighs the share of the probe's rays that, in their direction, ended where the neighbour's
 * ray ended: the angle between the probe's ray and the line from the probe to the point the neighbour's ray
 * in that direction ended at, taken at the shorter of the two ends, weighs `1 − angle / filterHitAngle`,
 * zero past it. Light from a surface the two probes see alike is shared; light from a surface close
 * to one and far from the other — a contact — is not. A neighbour no wall stands in the way of, on either
 * side, by the visibility test the field reads by (`probeDistance`, `visibilityMargin`) — a probe that
 * holds light, for this cell and this level — counts; a buried or empty one, none.
 *
 * A probe holds a basis, not a map of directions: its rays' shares are averaged into one weight a
 * neighbour, applied to the whole basis, and the weights are read from the six mean distances a probe
 * holds, never a distance a direction. The frozen atlas is read, so an update never sees a neighbour
 * half-written. Lane `n` of the update's group reads neighbour `n` (`filterRead`), each ray weighs the
 * six (`filterShares`), the sums gather with the group's (`PROBE_SUMS`), and the first lane weighs
 * each neighbour (`filterWeight`) and mixes its basis in.
 */
export const PROBE_FILTER_WGSL = wgslBlock(
  'PROBE_FILTER_WGSL',
  [BOUNCE_GRID_HEAD_WGSL],
  `
const PROBE_FILTER:bool=${BOUNCE_SETTINGS.filterProbes};
const FILTER_ANGLE:f32=${wgslF32(BOUNCE_SETTINGS.filterHitAngle)};
const FILTER_NEIGHBOURS:u32=${FILTER_NEIGHBOURS}u;
/** Neighbour \`n\`'s slot in the pool plus one, or zero where it does not filter, and its two distance vectors. */
var<workgroup> filterSlot:array<u32,FILTER_NEIGHBOURS>;
var<workgroup> filterPositive:array<vec3f,FILTER_NEIGHBOURS>;
var<workgroup> filterNegative:array<vec3f,FILTER_NEIGHBOURS>;
struct FilterShares{low:vec3f,high:vec3f,}
/** The axis neighbour \`n\` lies along: x then y then z, below the probe first. */
fn filterAxis(n:u32)->vec3f{
 var axis=vec3f(0.0);
 axis[n>>1u]=select(-1.0,1.0,(n&1u)==1u);
 return axis;
}
/** Reads neighbour \`n\` of the probe whose cell is \`cell\` in \`level\`: it filters when the table names
 *  a probe that holds light for that cell and that level, and nothing stands between the two probes
 *  from where it looks. */
fn filterRead(n:u32,cell:vec3i,level:u32,spacing:f32){
 let axis=filterAxis(n);
 let next=cell+vec3i(axis);
 var slot=0u;
 var positive=vec3f(0.0);
 var negative=vec3f(0.0);
 let named=tableEntry(cellEntry(level,probeWrap(next)));
 if(named!=0u){
  let probe=poolProbe(named-1u);
  if(all(probeCell(probe)==next)&&probeLevel(probe)==level&&probeAt(probe,PROBE_VALID).w==PROBE_USABLE){
   positive=probeAt(probe,PROBE_DISTANCE_POSITIVE).xyz;
   negative=probeAt(probe,PROBE_DISTANCE_NEGATIVE).xyz;
   if(spacing<=distanceAlong(positive,negative,-axis)+BOUNCE_VISIBILITY*spacing){slot=named;}
  }
 }
 filterSlot[n]=slot;
 filterPositive[n]=positive;
 filterNegative[n]=negative;
}
/** The share of a neighbour's light that a ray of direction \`d\`, which ended at \`own\`, carries to the
 *  probe: \`1 − angle / FILTER_ANGLE\`, the angle between the ray and the line from the probe to the point
 *  the neighbour's ray in that direction ended at, \`neighbour\` along it — the shorter of the two ends,
 *  a contact kept — from a neighbour \`spacing\` away on \`axis\`. */
fn filterShare(axis:vec3f,spacing:f32,d:vec3f,own:f32,neighbour:f32)->f32{
 let toEnd=axis*spacing+d*min(own,neighbour);
 let angle=atan2(length(cross(d,toEnd)),dot(d,toEnd));
 return 1.0-saturate(angle/FILTER_ANGLE);
}
/** What a ray of direction \`d\`, which ended at \`own\`, shares of neighbour \`n\`: zero where it does not filter. */
fn filterShareOf(n:u32,d:vec3f,own:f32,spacing:f32)->f32{
 if(filterSlot[n]==0u){return 0.0;}
 return filterShare(filterAxis(n),spacing,d,own,distanceAlong(filterPositive[n],filterNegative[n],d));
}
/** What a ray shares of the six neighbours: the first three, then the last three. */
fn filterShares(d:vec3f,own:f32,spacing:f32)->FilterShares{
 return FilterShares(
  vec3f(filterShareOf(0u,d,own,spacing),filterShareOf(1u,d,own,spacing),filterShareOf(2u,d,own,spacing)),
  vec3f(filterShareOf(3u,d,own,spacing),filterShareOf(4u,d,own,spacing),filterShareOf(5u,d,own,spacing)));
}
/** Neighbour \`n\`'s weight in the probe's estimate: \`share\`, the mean of the shares of the rays that
 *  answered, kept where nothing stands between the probe and the neighbour from the probe's side either
 *  (\`positive\`, \`negative\`: the probe's own mean distances); zero where it does not filter. */
fn filterWeight(n:u32,share:f32,positive:vec3f,negative:vec3f,spacing:f32)->f32{
 if(filterSlot[n]==0u){return 0.0;}
 let sees=spacing<=distanceAlong(positive,negative,filterAxis(n))+BOUNCE_VISIBILITY*spacing;
 return select(0.0,share,sees);
}`,
)
