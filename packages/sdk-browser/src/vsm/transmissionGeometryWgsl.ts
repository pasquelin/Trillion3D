import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { edgeFunction } from '../../../math/src/wgsl/barycentric.ts'
import {
  CELL_GROWTH,
  EDGE_SLACK,
  VSM_TRANSMISSION_CELL,
  VSM_TRANSMISSION_CELLS,
} from './transmissionShared.ts'

/**
 * The edge rule the read applies, one text for every caller. Edge (a, b) is evaluated in a
 * canonical direction — its endpoints ordered by x, then y — so two triangles sharing it compute
 * the same value to the bit and lie on opposite sides: a point is inside one alone. A point on the
 * edge (value exactly 0) belongs to the triangle on the left of the canonical direction, the same
 * as a point moved by an infinitesimal (−ε², ε): a shared vertex too belongs to exactly one
 * triangle of a closed fan. A triangle of zero area seen from the light holds nothing. The side of
 * each edge is that of its third corner, evaluated by the same function.
 */
export const VSM_TRANSMISSION_EDGE_WGSL = wgslBlock(
  'VSM_TRANSMISSION_EDGE_WGSL',
  [edgeFunction],
  `
fn vsmTEdge(a:vec2f,b:vec2f,p:vec2f)->f32{
 let swap=b.x<a.x||(b.x==a.x&&b.y<a.y);
 let lo=select(a,b,swap);let hi=select(b,a,swap);
 return edgeFunction(lo,hi,p);
}
fn vsmTEdgeHolds(a:vec2f,b:vec2f,third:vec2f,p:vec2f)->bool{
 let side=vsmTEdge(a,b,third);
 let e=vsmTEdge(a,b,p);
 return side!=0.0&&select((e<0.0),(e>=0.0),side>0.0);
}
fn vsmTInside(a:vec2f,b:vec2f,c:vec2f,p:vec2f)->bool{
 return vsmTEdgeHolds(a,b,c,p)&&vsmTEdgeHolds(b,c,a,p)&&vsmTEdgeHolds(c,a,b,p);
}
/** The barycentric weights of \`p\` (inside), each edge's value at \`p\` over its value at the
 *  opposite corner. */
fn vsmTWeights(a:vec2f,b:vec2f,c:vec2f,p:vec2f)->vec3f{
 return vec3f(vsmTEdge(b,c,p)/vsmTEdge(b,c,a),vsmTEdge(c,a,p)/vsmTEdge(c,a,b),vsmTEdge(a,b,p)/vsmTEdge(a,b,c));
}`,
)

/**
 * Whether triangle (a, b, c) of orientation \`s\` (±1) may cover a point of the cell [lo, hi]: no
 * edge leaves the whole cell outside (the cell's own axes are its bounding box's test). The cell
 * comes in grown by 2⁻¹⁰ texel and each edge's value is allowed 2⁻²⁰ of its terms' magnitude, so no
 * point the read finds inside (\`vsmTInside\`) misses its cell to rounding.
 */
export const VSM_TRANSMISSION_COVER_WGSL = wgslBlock(
  'VSM_TRANSMISSION_COVER_WGSL',
  [],
  `
fn vsmTEdgeMeets(a:vec2f,b:vec2f,s:f32,lo:vec2f,hi:vec2f)->bool{
 let d=b-a;
 let px=select(lo.x,hi.x,-s*d.y>0.0);
 let py=select(lo.y,hi.y,s*d.x>0.0);
 let u=d.x*(py-a.y);let v=d.y*(px-a.x);
 return s*(u-v)>=-(abs(u)+abs(v))*${EDGE_SLACK};
}
fn vsmTCovers(a:vec2f,b:vec2f,c:vec2f,s:f32,lo:vec2f,hi:vec2f)->bool{
 return vsmTEdgeMeets(a,b,s,lo,hi)&&vsmTEdgeMeets(b,c,s,lo,hi)&&vsmTEdgeMeets(c,a,s,lo,hi);
}
/** The cells a box [lo, hi] grown by 2⁻¹⁰ texel meets, first and last, on the page. */
fn vsmTCellRange(lo:vec2f,hi:vec2f)->vec4f{
 let grow=${CELL_GROWTH};
 let c0=clamp(floor((lo-grow)/${VSM_TRANSMISSION_CELL}.0),vec2f(0.0),vec2f(${VSM_TRANSMISSION_CELLS - 1}.0));
 let c1=clamp(floor((hi+grow)/${VSM_TRANSMISSION_CELL}.0),vec2f(0.0),vec2f(${VSM_TRANSMISSION_CELLS - 1}.0));
 return vec4f(c0,c1);
}
/** Whether triangle (a, b, c) of orientation \`s\` may cover cell \`cell\`: the cell grown by 2⁻¹⁰. */
fn vsmTCoversCell(a:vec2f,b:vec2f,c:vec2f,s:f32,cell:vec2f)->bool{
 let grow=${CELL_GROWTH};
 let lo=cell*${VSM_TRANSMISSION_CELL}.0-grow;
 return vsmTCovers(a,b,c,s,lo,lo+${VSM_TRANSMISSION_CELL}.0+2.0*grow);
}`,
)
