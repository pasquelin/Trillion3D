/**
 * WHAT THE TRANSLUCENT CASTERS LET THROUGH ALONG ONE SHADOW RAY (`traceWgsl.ts`): the ray of the
 * opaque march — its start on the receiver's plane, its far end, then on to the light as the march
 * reads past its far end, at the far end's UV — walked over every cell of 8 × 8 texels it crosses on
 * each map it lies in, the triangles each cell lists met exactly (`vsmTCellThrough`,
 * `transmissionReadWgsl.ts`). A missed ray's value, averaged over the missed rays as the opaque
 * misses are counted, is the light's colour through the panes: the penumbra and the panes' edges
 * follow the same rays.
 *
 * First, once a receiver and light (`vsmTPanedMaps`): the hull every ray of the receiver lies in
 * (a ball about its starts' dither square, one about its far ends: its cone at its reach) is
 * projected on each map the light has — a clipmap level's by the two centres' UVs widened, the
 * rays' own footprint; a local map's by the two balls' box —, and the
 * pages under it are asked whether a slice of panes is theirs (a page header a page); a map none of
 * whose pages holds one is walked by no ray, and a receiver no pane reaches walks nothing — every
 * pane a ray can meet lies in a page under the box, the line to the light keeping the far end's UV.
 *
 * The walk: the segment cut to the map's square (0 ≤ x, y ≤ w in its UV clip space, each linear
 * along it), then a line walk over the map's cells at its finest resolution (a clipmap level's, a
 * local map's finest mip), every cell from the first to the last; where the line passes within
 * 2⁻¹⁶ of a cell corner, the cell beside it too. Each cell is read on the page that maps it (a
 * coarser level or mip where its own is unmapped), in that page's texels; a coarser page's cell
 * spans several walked cells, read once (the last two read are kept). A crossing counts only in the
 * cell it lies in (`vsmTHitOf`), so a cell read twice or beside the line adds nothing twice. A
 * point light walks each face the box reaches, a crossing counted on the face it lies on.
 */
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { FLOAT32_MAX } from '../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { floorLog2 } from '../../../math/src/scalar/integers.ts'
import { VSM_PAGE_TEXELS } from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_LOOKUP_WGSL } from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from './projectionDataWgsl.ts'
import { vsmTraceMapWgsl } from './traceMapWgsl.ts'
import { vsmPageCacheWgsl } from './traceRayWgsl.ts'
import { VSM_TRANSMISSION_CELL, VSM_TRANSMISSION_CELLS } from './transmissionShared.ts'

const CELL = `${VSM_TRANSMISSION_CELL}.0`
const PAGE_SHIFT = floorLog2(VSM_PAGE_TEXELS)

/** The per-ray transmission over the pages of `pool`, reading the memory block `transmission`
 *  (`vsmTransmissionReadWgsl`). The host brings the light's struct and `vsm`. */
export const vsmTransmissionRayWgsl = (pool: WgslDecl, transmission: WgslDecl) =>
  wgslBlock(
    'vsmTransmissionRayWgsl',
    [
      FLOAT32_MAX,
      vsmTraceMapWgsl(pool),
      vsmPageCacheWgsl(pool),
      transmission,
      VSM_HANDLE_WGSL,
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
    ],
    `
/** A page of a map as the walk reads it (\`vsmTPageOf\`): whether a level or mip maps it, its
 *  physical page, its texels of a map UV (\`uv·scale + offset\`) and its slices' first blocks
 *  (\`vsmTransmissionBlocks\`, none for a page not mapped); and the last one looked up
 *  (\`VsmPageCache\`, at the map's finest mip), kept while one ray or the gate reads. */
struct VsmTPage{valid:bool,page:vec2u,scale:f32,offset:vec2f,blocks:vec2u,}
struct VsmTPages{cache:VsmPageCache,last:VsmTPage,}
fn vsmTPageOf(pages:ptr<function,VsmTPages>,h:VsmHandle,clipmap:bool,uv:vec2f)->VsmTPage{
 let key=vsmPageKey(clipmap,h.finestMip,uv);
 if(vsmPageKept((*pages).cache,h,key)){return (*pages).last;}
 let read=vsmPageRead(h,clipmap,h.finestMip,key);
 var r:VsmTPage;
 var mapTexel=vec2u(0u);var poolTexel=vec2u(0u);
 if(clipmap){
  let page=read.page;
  let t=vsmClipmapTexel(h,page,uv);
  r.valid=t.valid;poolTexel=t.poolTexel;mapTexel=t.mapTexelXY;
  let texels=f32(vsmTexelsAtLevel(0u));
  r.scale=texels;
  if(page.levelHandle.id!=h.id){r.scale=texels*page.toLevel.scale;r.offset=page.toLevel.bias.xy*texels;}
 }else{
  let page=vsmLocalPageFrom(read.page.entry,uv,h.finestMip);
  r.valid=page.valid;poolTexel=page.poolTexel;mapTexel=page.mapTexelXY;
  r.scale=f32(vsmTexelsAtLevel(page.coarserLevels));
 }
 r.offset-=vec2f((mapTexel>>vec2u(${PAGE_SHIFT}u))<<vec2u(${PAGE_SHIFT}u));
 r.page=poolTexel>>vec2u(${PAGE_SHIFT}u);
 r.blocks=vec2u(${NO_INDEX}u);
 if(r.valid){r.blocks=vsmTransmissionBlocks(r.page);}
 (*pages).cache=read;(*pages).last=r;
 return r;
}
/** The maps of light \`light\` a ray of its map \`m\` (\`vsmLightMapAt\`) walks: a sun's level, a spot's
 *  map, or a point light's six cube faces — map \`f\` its face \`f\`. */
fn vsmTMapCount(light:VsmProjectionLight,m:VsmLightMap)->u32{return select(6u,1u,m.clipmap||light.kind==LIGHT_KIND_SPOT);}
fn vsmTMapAt(light:VsmProjectionLight,m:VsmLightMap,f:u32)->VsmHandle{
 if(vsmTMapCount(light,m)==1u){return m.handle;}
 return vsmHandleOffset(vsmHandleFromId(u32(light.mapId)),i32(f));
}
/** Whether a page of map \`h\` under the rays of a receiver — the hull of the ball of radius \`r0\`
 *  about \`p0\` and that of radius \`r1\` about \`p1\` (the map's shifted frame) — holds a slice of
 *  panes: none where they lie outside the map's square; every one where part of them lies behind
 *  the map's eye or they span more than 16 pages. A clipmap level's map is affine (w = 1): the hull
 *  maps within the rect of the two centres' UVs widened by each radius times the length of the UV
 *  row, the rays' own footprint — a sun's ray runs along its map's axis, which no UV moves along.
 *  A local map is projective: the balls' box, its corners projected. */
fn vsmTMapPaned(pages:ptr<function,VsmTPages>,h:VsmHandle,clipmap:bool,p0:vec3f,r0:f32,p1:vec3f,r1:f32)->bool{
 let M=vsmProjectionData[h.id].shiftedToMapUv;
 var uvLo=vec2f(FLOAT32_MAX);var uvHi=vec2f(-FLOAT32_MAX);
 if(clipmap){
  let rows=vec2f(length(vec3f(M[0].x,M[1].x,M[2].x)),length(vec3f(M[0].y,M[1].y,M[2].y)));
  let a=(M*vec4f(p0,1.0)).xy;let b=(M*vec4f(p1,1.0)).xy;
  uvLo=min(a-r0*rows,b-r1*rows);uvHi=max(a+r0*rows,b+r1*rows);
  if(any(uvHi<vec2f(0.0))||any(uvLo>vec2f(1.0))){return false;}
 }else{
  let lo=min(p0-r0,p1-r1);let hi=max(p0+r0,p1+r1);
  // Bit e set while every corner lies outside the square's edge e (x < 0, x > w, y < 0, y > w).
  var outside=15u;var behind=false;
  for(var k=0u;k<8u;k++){
   let corner=vec3f(select(lo.x,hi.x,(k&1u)!=0u),select(lo.y,hi.y,(k&2u)!=0u),select(lo.z,hi.z,(k&4u)!=0u));
   let c=M*vec4f(corner,1.0);
   outside&=select(0u,1u,c.x<0.0)|select(0u,2u,c.w-c.x<0.0)|select(0u,4u,c.y<0.0)|select(0u,8u,c.w-c.y<0.0);
   if(c.w>0.0){uvLo=min(uvLo,c.xy/c.w);uvHi=max(uvHi,c.xy/c.w);}else{behind=true;}
  }
  if(outside!=0u){return false;}
  if(behind){return true;}
 }
 let side=VSM_LEVEL0_PAGES>>select(h.finestMip,0u,clipmap);
 let q0=vec2u(saturate(uvLo)*f32(side));
 let q1=min(vec2u(saturate(uvHi)*f32(side)),vec2u(side-1u));
 if((q1.x-q0.x+1u)*(q1.y-q0.y+1u)>16u){return true;}
 for(var y=q0.y;y<=q1.y;y++){
  for(var x=q0.x;x<=q1.x;x++){
   let page=vsmTPageOf(pages,h,clipmap,(vec2f(f32(x),f32(y))+0.5)/f32(side));
   if(page.valid&&any(page.blocks!=vec2u(${NO_INDEX}u))){return true;}
  }
 }
 return false;
}
/** The maps of light \`light\` (its map \`m\`, \`vsmLightMapAt\`) a pane under its rays (the hull of
 *  two balls, \`vsmTMapPaned\`) may lie in, bit f for cube face f (bit 0: a sun's level, a spot's
 *  map): none without translucent casters. \`pages\` is the receiver's one page cache, which its
 *  rays' walks read on (\`vsmRayThrough\`). */
fn vsmTPanedMaps(pages:ptr<function,VsmTPages>,light:VsmProjectionLight,m:VsmLightMap,p0:vec3f,r0:f32,p1:vec3f,r1:f32)->u32{
 if(!vsmTranslucentCasters()){return 0u;}
 var maps=0u;
 for(var f=0u;f<vsmTMapCount(light,m);f++){if(vsmTMapPaned(pages,vsmTMapAt(light,m,f),m.clipmap,p0,r0,p1,r1)){maps|=1u<<f;}}
 return maps;
}
/** The walk's state: the product so far and the last two cells read (physical page and cell,
 *  packed). */
struct VsmTWalk{through:vec3f,read:vec2u,}
/** Reads walked cell \`cell\` of map \`h\` (\`texels\` a side) into \`w\` along \`s\`. */
fn vsmTVisit(w:ptr<function,VsmTWalk>,pages:ptr<function,VsmTPages>,s:ptr<function,VsmTSegment>,h:VsmHandle,clipmap:bool,texels:f32,cell:vec2i){
 let uv=(vec2f(cell)+0.5)*${CELL}/texels;
 let page=vsmTPageOf(pages,h,clipmap,uv);
 if(!page.valid){return;}
 // The segment's page texels follow the page's frame, set again only once it moves.
 if(page.scale!=(*s).scale||any(page.offset!=(*s).offset)){
  (*s).scale=page.scale;(*s).offset=page.offset;
  if((*s).directional){(*s).pA=vsmTPageAt(*s,(*s).c0);(*s).pB=vsmTPageAt(*s,(*s).c1);}
 }
 let local=uv*page.scale+page.offset;
 let pageCell=min(vec2u(max(floor(local/${CELL}),vec2f(0.0))),vec2u(${VSM_TRANSMISSION_CELLS - 1}u));
 let key=((page.page.y*vsm.poolPagesXY.x+page.page.x)<<8u)|(pageCell.y*${VSM_TRANSMISSION_CELLS}u+pageCell.x);
 if(key==(*w).read.x||key==(*w).read.y){return;}
 (*w).read=vec2u(key,(*w).read.x);
 if(all(page.blocks==vec2u(${NO_INDEX}u))){return;}
 (*w).through*=vsmTCellThrough(page.blocks,*s,pageCell);
}
/** What the panes of map \`h\` (a clipmap level, else a local map: \`face\` its cube face, −1 a spot's)
 *  let through along the segment from \`x0\` to \`x1\` (the map's shifted frame) and on to the light. */
fn vsmTWalkMap(pages:ptr<function,VsmTPages>,h:VsmHandle,clipmap:bool,x0:vec3f,x1:vec3f,face:i32)->vec3f{
 let M=vsmProjectionData[h.id].shiftedToMapUv;
 let c0=M*vec4f(x0,1.0);let c1=M*vec4f(x1,1.0);
 // The part of the segment inside the map's square: 0 ≤ x ≤ w and 0 ≤ y ≤ w, each linear along it.
 let e0=vec4f(c0.x,c0.w-c0.x,c0.y,c0.w-c0.y);let e1=vec4f(c1.x,c1.w-c1.x,c1.y,c1.w-c1.y);
 var lo=0.0;var hi=1.0;
 for(var k=0;k<4;k++){
  let a=e0[k];let b=e1[k];
  if(a<0.0&&b<0.0){return vec3f(1.0);}
  if(a<0.0){lo=max(lo,a/(a-b));}else if(b<0.0){hi=min(hi,a/(a-b));}
 }
 if(!(lo<=hi)){return vec3f(1.0);}
 var s:VsmTSegment;
 s.directional=clipmap;s.c0=c0;s.c1=c1;s.x0=x0;s.x1=x1;s.x0Length=length(x0);s.face=face;
 if(clipmap){
  let axis=normalize(vec3f(M[0].z,M[1].z,M[2].z));
  let shift=dot(vsmProjectionData[h.id].originShiftHigh,axis)+dot(vsmProjectionData[h.id].originShiftLow,axis);
  s.r=vec2f(dot(x0,axis),dot(x1,axis))-shift;
 }
 let texels=f32(select(vsmTexelsAtLevel(h.finestMip),vsmTexelsAtLevel(0u),clipmap));
 let cl=mix(c0,c1,lo);let ch=mix(c0,c1,hi);
 let gA=cl.xy/cl.w*texels/${CELL};let gB=ch.xy/ch.w*texels/${CELL};
 let top=vec2i(i32(texels/${CELL})-1);
 var cell=clamp(vec2i(floor(gA)),vec2i(0),top);
 let last=clamp(vec2i(floor(gB)),vec2i(0),top);
 let d=gB-gA;
 let stepDir=select(vec2i(-1),vec2i(1),d>=vec2f(0.0));
 let moving=d!=vec2f(0.0);
 // Ray time to the next cell edge on each axis, and between two edges (none on an axis it keeps).
 let never=vec2f(FLOAT32_MAX);
 let delta=select(never,1.0/abs(d),moving);
 var edge=select(never,(vec2f(cell+max(stepDir,vec2i(0)))-gA)/d,moving);
 var left=abs(last-cell);
 var w=VsmTWalk(vec3f(1.0),vec2u(${NO_INDEX}u));
 vsmTVisit(&w,pages,&s,h,clipmap,texels,cell);
 let steps=left.x+left.y;
 for(var i=0;i<steps;i++){
  let alongX=left.y==0||(left.x>0&&edge.x<=edge.y);
  // Within 2⁻¹⁶ of a corner the cell beside the line is read too: rounding never skips one.
  if(left.x>0&&left.y>0&&abs(edge.x-edge.y)<=${wgslF32(2 ** -16)}*max(1.0,max(edge.x,edge.y))){
   vsmTVisit(&w,pages,&s,h,clipmap,texels,cell+select(vec2i(stepDir.x,0),vec2i(0,stepDir.y),alongX));
  }
  if(alongX){cell.x+=stepDir.x;edge.x+=delta.x;left.x-=1;}
  else{cell.y+=stepDir.y;edge.y+=delta.y;left.y-=1;}
  vsmTVisit(&w,pages,&s,h,clipmap,texels,cell);
 }
 return w.through;
}
/** What the translucent casters let through along a ray of light \`light\` from \`x0\` to \`x1\` (the
 *  shifted frame of its map \`m\`, \`vsmLightMapAt\`) and on to the light, over the maps \`paned\`
 *  (\`vsmTPanedMaps\`): a sun's level, a spot's map, a point light's faces, read through the
 *  receiver's one page cache \`pages\`. */
fn vsmRayThrough(pages:ptr<function,VsmTPages>,light:VsmProjectionLight,m:VsmLightMap,x0:vec3f,x1:vec3f,paned:u32)->vec3f{
 if(paned==0u){return vec3f(1.0);}
 let cube=vsmTMapCount(light,m)>1u;
 var through=vec3f(1.0);
 for(var f=0u;f<vsmTMapCount(light,m);f++){
  if((paned&(1u<<f))!=0u){through*=vsmTWalkMap(pages,vsmTMapAt(light,m,f),m.clipmap,x0,x1,select(-1,i32(f),cube));}
 }
 return through;
}
`,
  )
