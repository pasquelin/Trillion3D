import { FINE_SPAN, MAX_SPAN, SUBPIXEL_SAMPLES, TILE } from './contract.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { FLAG_BACK, FLAG_DOUBLE } from '../types.ts'
import { PAGE_POINTS_WGSL } from '../shader/pageGeometryWgsl.ts'

const S = SUBPIXEL_SAMPLES

/**
 * The software raster's triangle setup, and the only writing of it: binning sets each triangle up
 * once to class it, the raster passes set the survivors up again from the same inputs and the same
 * operations, so the box a triangle was classed on is the one it is rastered on.
 *
 * The setup is the hardware rasterizers' own rule, step for step:
 * - **The vertices are snapped** to a grid of `SUBPIXEL_SAMPLES` samples a pixel side, rounded to
 *   the nearest (`subpixelOf`): the edges are then exact sums of whole samples.
 * - **The box is the nearest pixel centres inside**, inclusive, clipped to the frame, then held to
 *   `MAX_SPAN` past its first pixel; a triangle covering no pixel centre has none.
 * - **One-sided rows cull their back faces**, a mirrored placement turning which side is front
 *   (`det`); a kept triangle is turned to face inward, as a two-sided row's back face is.
 * - **The edge constants carry the fill rule**: a sample exactly on an edge goes to the triangle
 *   for which it is a top or a left edge — one subpixel unit taken off the others (`fillNudge`) —,
 *   so two triangles sharing an edge never both cover, nor both miss, a pixel.
 * - **Depth is the plane of the three snapped depths**, and the weights' per-pixel steps (`dx`,
 *   `dy`) are its screen derivatives, the masked cutout's footprint.
 * A software row never crosses the near plane (`binWgsl.ts`): no vertex here has to be clipped.
 */
export const RASTER_TRI_WGSL = wgslBlock(
  'RASTER_TRI_WGSL',
  [PAGE_POINTS_WGSL, worldMatrix3],
  `
// The \`viewProj * world\` product and the linear-part determinant depend only on the page: binning
// computes them once for the page's triangles, the raster passes per triangle — the same operands
// in the same order, the same floats.
fn pageTransform(page:PageInfo)->mat4x4f{return uni.viewProj*page.world;}
fn pageWinding(page:PageInfo)->f32{return determinant(worldMatrix3(page.world));}
/** A set-up triangle: its inclusive pixel box, its turned edges, the edge constants at the box's
 *  first pixel centre in pixels, its depth plane, \`1/w\` at its corners, the weights' steps, the
 *  cutout coordinate and vertex alpha at its corners (a masked row's), and what names it. */
struct Tri{minPixel:vec2i,maxPixel:vec2i,e01:vec2f,e12:vec2f,e20:vec2f,
 c:vec3f,depth:vec3f,invW:vec3f,dx:vec3f,dy:vec3f,ua:vec3f,ub:vec3f,uc:vec3f,
 corners:vec3u,row:u32,triangle:u32,ok:u32,}
/** A clip point on the subpixel grid: its framebuffer position in samples, rounded to the nearest,
 *  its device depth, and its \`1/w\`. */
fn subpixelOf(clip:vec4f)->vec4f{
 let s=vec4f(clip.xyz,1.0)/clip.w;
 let scale=vec2f(0.5,-0.5)*uni.viewport*${S}.0;
 let bias=0.5*uni.viewport*${S}.0+0.5;
 return vec4f(floor(s.xy*scale+bias),s.z,s.w);
}
/** The fill rule's share of edge \`e\`: one subpixel unit unless it is a top or a left edge. */
fn fillNudge(e:vec2f)->f32{return saturate(e.y+saturate(1.0-e.x));}
/** Triangle \`triangle\` of row \`row\` (\`page\`, its header \`h\`) under \`vp\`, the page's
 *  \`viewProj*world\`, \`det\` the determinant of its world's linear part; \`ok\` zero when it
 *  covers no pixel of the frame or faces away. */
fn setupTriangle(row:u32,page:PageInfo,h:ClusterHeader,triangle:u32,vp:mat4x4f,det:f32)->Tri{
 var t:Tri;t.ok=0u;t.row=row;t.triangle=triangle;
 if(triangle*3u+2u>=page.indexCount){return t;}
 t.corners=pageTriangle(page,h,triangle);
 let s0=subpixelOf(vp*vec4f(pagePosition(page,h,t.corners.x),1.0));
 let s1=subpixelOf(vp*vec4f(pagePosition(page,h,t.corners.y),1.0));
 let s2=subpixelOf(vp*vec4f(pagePosition(page,h,t.corners.z),1.0));
 return setupSubpixel(t,page,det,s0,s1,s2);
}
/** Triangle \`start\` — its row and triangle named, its corners where it has them — of \`page\`,
 *  set up from its three corners already on the subpixel grid (\`subpixelOf\`), \`det\` the
 *  determinant of its world's linear part: the rest of the setup, which the tessellation's
 *  micro-triangles take as the page's own do. */
fn setupSubpixel(start:Tri,page:PageInfo,det:f32,s0:vec4f,s1:vec4f,s2:vec4f)->Tri{
 var t=start;
 var e01=s0.xy-s1.xy;var e12=s1.xy-s2.xy;var e20=s2.xy-s0.xy;
 let area=e01.y*e20.x-e01.x*e20.y;
 // Flat on the grid, it covers no sample under the fill rule.
 if(area==0.0){return t;}
 // Counter-clockwise on the device is a negative area here; a mirrored placement swaps the sides.
 let front=select((area>0.0),(area<0.0),(det>=0.0));
 if((page.flags&${FLAG_DOUBLE}u)==0u){if((page.flags&${FLAG_BACK}u)!=0u){if(front){return t;}}else if(!front){return t;}}
 if(area>0.0){e01=-e01;e12=-e12;e20=-e20;}
 let lo=min(s0.xy,min(s1.xy,s2.xy));let hi=max(s0.xy,max(s1.xy,s2.xy));
 t.minPixel=max(vec2i(floor((lo+${S / 2 - 1}.0)*(1.0/${S}.0))),vec2i(0));
 t.maxPixel=min(vec2i(floor((hi-${S / 2 + 1}.0)*(1.0/${S}.0))),vec2i(uni.viewport)-vec2i(1));
 t.maxPixel=min(t.maxPixel,t.minPixel+vec2i(${MAX_SPAN}));
 if(any(t.minPixel>t.maxPixel)){return t;}
 let base=vec2f(t.minPixel)*${S}.0+${S / 2}.0;
 let v0=s0.xy-base;let v1=s1.xy-base;let v2=s2.xy-base;
 var c=vec3f(e12.y*v1.x-e12.x*v1.y,e20.y*v2.x-e20.x*v2.y,e01.y*v0.x-e01.x*v0.y);
 // The weights' scale is the sum before the fill rule, which can bring it to zero.
 let unit=${S}.0/(c.x+c.y+c.z);
 c=(c-vec3f(fillNudge(e12),fillNudge(e20),fillNudge(e01)))*(1.0/${S}.0);
 t.e01=e01;t.e12=e12;t.e20=e20;t.c=c;
 t.dx=vec3f(-e12.y,-e20.y,-e01.y)*unit;t.dy=vec3f(e12.x,e20.x,e01.x)*unit;
 t.depth=vec3f(s0.z,(s1.z-s0.z)*unit,(s2.z-s0.z)*unit);
 t.invW=vec3f(s0.w,s1.w,s2.w);
 t.ok=1u;
 return t;
}
/** The edge constants at pixel \`pixel\` of \`t\`'s box: the first pixel's, a whole edge step a
 *  pixel; covered when none is negative. */
fn edgesAt(t:Tri,pixel:vec2i)->vec3f{
 let d=vec2f(pixel-t.minPixel);
 return t.c+vec3f(t.e12.x,t.e20.x,t.e01.x)*d.y-vec3f(t.e12.y,t.e20.y,t.e01.y)*d.x;
}
/** Size class of a set-up box: the tile a thread group covers at once. */
fn triClass(t:Tri)->u32{
 let span=max(t.maxPixel.x-t.minPixel.x,t.maxPixel.y-t.minPixel.y);
 if(span<=${FINE_SPAN}){return 0u;}
 if(span<=${TILE - 1}){return 1u;}
 return 2u;
}
/** Eight-pixel tiles a box covers, in columns then in rows. */
fn tileCols(t:Tri)->u32{return u32(t.maxPixel.x-t.minPixel.x)/${TILE}u+1u;}
fn tileRows(t:Tri)->u32{return u32(t.maxPixel.y-t.minPixel.y)/${TILE}u+1u;}
`,
)
