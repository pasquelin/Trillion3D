import { MAX_SPAN, SUBPIXEL_SAMPLES } from './contract.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { FLAG_BACK, FLAG_DOUBLE } from '../types.ts'
import { PAGE_POINTS_WGSL } from '../shader/pageGeometryWgsl.ts'

const S = SUBPIXEL_SAMPLES

/**
 * The software raster's triangle setup, and the only writing of it: the cluster raster sets each
 * of its triangles up from the corners it holds (`clusterWgsl.ts`), the tessellation each of its
 * micro-triangles (`../tessellation/diceWgsl.ts`).
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
 * A software cluster never crosses the near plane (`rasteredInHardware`, `../../geometry/dag/shader/visibleWgsl.ts`): no vertex here has to be clipped.
 *
 * The frame is the raster's (`rasterViewport`): the camera's viewport by default, the window of a
 * shadow map's page where the shadow raster sets its triangles up
 * (`../../lighting/shadows/vsm/render/renderSoftwareWgsl.ts`), its own declaration in place of the
 * default. So is the widest box a triangle keeps (`rasterSpan`, `MAX_SPAN` by default): the raster of
 * the surface cache's cards draws a whole page, up to 128 pixels, in software
 * (`../../lighting/surfaceCache/capture/cardRasterWgsl.ts`).
 */
export const RASTER_TRI_WGSL = wgslBlock(
  'RASTER_TRI_WGSL',
  [
    PAGE_POINTS_WGSL,
    wgslFn('rasterViewport', [], 'fn rasterViewport()->vec2f{return uni.viewport;}', {
      weak: true,
    }),
    wgslFn('rasterSpan', [], `fn rasterSpan()->i32{return ${MAX_SPAN};}`, { weak: true }),
  ],
  `
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
 let scale=vec2f(0.5,-0.5)*rasterViewport()*${S}.0;
 let bias=0.5*rasterViewport()*${S}.0+0.5;
 return vec4f(floor(s.xy*scale+bias),s.z,s.w);
}
/** The fill rule's share of edge \`e\`: one subpixel unit unless it is a top or a left edge. */
fn fillNudge(e:vec2f)->f32{return saturate(e.y+saturate(1.0-e.x));}
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
 t.maxPixel=min(vec2i(floor((hi-${S / 2 + 1}.0)*(1.0/${S}.0))),vec2i(rasterViewport())-vec2i(1));
 t.maxPixel=min(t.maxPixel,t.minPixel+vec2i(rasterSpan()));
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
/** A masked row's cutout at edge constants \`c\`: the corners' coordinate and alpha (\`ua\`, \`ub\`,
 *  \`uc\`) at the perspective-correct weights — the edge constants by the corners' \`1/w\`,
 *  normalised — and its footprint, their screen steps. */
struct TriCutout{at:vec3f,ddx:vec2f,ddy:vec2f,}
fn triCutout(t:Tri,c:vec3f)->TriCutout{
 let w=c*t.invW;let uvw=w*(1.0/(w.x+w.y+w.z));
 return TriCutout(t.ua*uvw.x+t.ub*uvw.y+t.uc*uvw.z,(t.ua*t.dx.x+t.ub*t.dx.y+t.uc*t.dx.z).xy,(t.ua*t.dy.x+t.ub*t.dy.y+t.uc*t.dy.z).xy);
}
`,
)

/** The camera's product of a page's world by its view-projection and the linear-part determinant,
 *  which depend only on the page: a cluster's group computes them once for its triangles
 *  (`clusterWgsl.ts`). */
export const RASTER_PAGE_TRANSFORM_WGSL = wgslBlock(
  'RASTER_PAGE_TRANSFORM_WGSL',
  [worldMatrix3],
  `fn pageTransform(page:PageInfo)->mat4x4f{return uni.viewProj*page.world;}
fn pageWinding(page:PageInfo)->f32{return determinant(worldMatrix3(page.world));}`,
)
