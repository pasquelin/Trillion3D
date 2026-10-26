import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { VECTOR_CODEC_WGSL } from '../../../post/taa/velocityWgsl.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { HORIZON_BINDINGS as B, HORIZON_SPATIAL_FORMAT } from './layout.ts'
import { HORIZON_COMMON_WGSL } from './searchWgsl.ts'
import {
  HORIZON_BORDER,
  HORIZON_GROUP,
  HORIZON_PLANE_WEIGHT,
  HORIZON_TILE,
  HORIZON_TILE_TEXELS,
} from './tables.ts'

/**
 * WHAT THE FILTERS READ OF THE LAST PASS (`aoIn`, bound at `HORIZON_BINDINGS.input`): a texel of it by its coordinates, zero
 * outside the rectangle it was drawn in, and its value at a position of the picture, blended from the four texels about it
 * with the weights of a linear sampler, the position held within the rectangle's edge texels.
 */
const INPUT_WGSL = wgslBlock(
  'HORIZON_INPUT_WGSL',
  [HORIZON_COMMON_WGSL],
  `@group(0) @binding(${B.input}) var aoIn:texture_2d<f32>;
fn hzInputAt(p:vec2i)->f32{
 if(any(p<vec2i(0))||any(p>=vec2i(view.input.xy))){return 0.0;}
 return textureLoad(aoIn,p,0).r;
}
fn hzInputLinear(uv:vec2f,size:vec2f)->f32{
 let q=uv*size-vec2f(0.5);
 let f=floor(q);
 let w=q-f;
 let last=vec2i(size)-vec2i(1);
 let a=textureLoad(aoIn,clamp(vec2i(f),vec2i(0),last),0).r;
 let b=textureLoad(aoIn,clamp(vec2i(f)+vec2i(1,0),vec2i(0),last),0).r;
 let c=textureLoad(aoIn,clamp(vec2i(f)+vec2i(0,1),vec2i(0),last),0).r;
 let d=textureLoad(aoIn,clamp(vec2i(f)+vec2i(1,1),vec2i(0),last),0).r;
 return mix(mix(a,b,w.x),mix(c,d,w.x),w.y);
}`,
)

/**
 * THE SPATIAL FILTER (`hzSpatialMain`), a compute pass: each pixel a mean of the texels of the square the filter reaches,
 * weighed by how near each lies to the plane of the pixel's own surface — the plane the depths of the neighbours either side of
 * it, whichever extrapolates better, give, in device depth, a weight of `1 − |Δ| · 20000` held from 0 to 1 —, raised back to the
 * integral's scale, then to the power and weighed by the intensity, and held from 0 to 1 as the target it is stored in holds it:
 * a pixel the search left whole (the sky, anything past the fade) comes back above 1, which the filters would read linearly into
 * the pixels beside it. Texels and depths outside the picture are zero. The depths are those of the pixels the texels stand
 * for (the search's reduction apart). A workgroup of 16 × 8 pixels loads the occlusion
 * and the depth of its tile — its pixels and two texels of border — into the group's memory once (`hzLoadTile`, two texels a
 * thread), and every pixel of the group reads its square and its slopes from there (`hzSpatialAt`).
 */
export const HORIZON_SPATIAL_WGSL = wgslProgram(
  `
@group(0) @binding(${B.spatialOut}) var spatialOut:texture_storage_2d<${HORIZON_SPATIAL_FORMAT},write>;
var<workgroup> tileAo:array<f32,${HORIZON_TILE_TEXELS}>;
var<workgroup> tileZ:array<f32,${HORIZON_TILE_TEXELS}>;
fn hzZAt(p:vec2i)->f32{
 let q=p*i32(view.fade.w);
 if(any(q<vec2i(0))||any(q>=vec2i(view.lens.zw))){return 0.0;}
 return hizOpaqueDepth(q);
}
fn hzSlope(m2:f32,m1:f32,z:f32,p1:f32,p2:f32)->f32{
 let before=abs((m1+(m1-m2))-z);
 let after=abs((p1+(p1-p2))-z);
 return select(p2-p1,m1-m2,before<after);
}
fn hzTile(l:vec2i,o:vec2i)->u32{return u32((l.y+${HORIZON_BORDER}+o.y)*${HORIZON_TILE[0]}+l.x+${HORIZON_BORDER}+o.x);}
fn hzSpatialAt(l:vec2i)->f32{
 let z=tileZ[hzTile(l,vec2i(0,0))];
 let dx=hzSlope(tileZ[hzTile(l,vec2i(-2,0))],tileZ[hzTile(l,vec2i(-1,0))],z,tileZ[hzTile(l,vec2i(1,0))],tileZ[hzTile(l,vec2i(2,0))]);
 let dy=hzSlope(tileZ[hzTile(l,vec2i(0,-2))],tileZ[hzTile(l,vec2i(0,-1))],z,tileZ[hzTile(l,vec2i(0,1))],tileZ[hzTile(l,vec2i(0,2))]);
 let first=i32(view.tail.z);
 let last=i32(view.tail.w);
 var sum=0.0;
 var weights=0.0;
 for(var y=first;y<=last;y++){
  for(var x=first;x<=last;x++){
   let at=hzTile(l,vec2i(x,y));
   let plane=z+dx*f32(x)+dy*f32(y);
   let weight=1.0-saturate(abs(plane-tileZ[at])*${wgslF32(HORIZON_PLANE_WEIGHT)});
   sum+=tileAo[at]*weight;
   weights+=weight;
  }
 }
 let open=sum/weights*0.5*PI;
 return saturate(1.0-(1.0-pow(abs(open),view.tail.x))*view.tail.y);
}
fn hzLoadTile(index:u32,origin:vec2i){
 if(index>=${HORIZON_TILE_TEXELS}u){return;}
 let p=origin+vec2i(i32(index%${HORIZON_TILE[0]}u),i32(index/${HORIZON_TILE[0]}u));
 tileAo[index]=hzInputAt(p);
 tileZ[index]=hzZAt(p);
}
@compute @workgroup_size(${HORIZON_GROUP[0]},${HORIZON_GROUP[1]})
fn hzSpatialMain(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) index:u32){
 let corner=vec2i(group.xy)*vec2i(${HORIZON_GROUP[0]},${HORIZON_GROUP[1]});
 hzLoadTile(index*2u,corner-vec2i(${HORIZON_BORDER}));
 hzLoadTile(index*2u+1u,corner-vec2i(${HORIZON_BORDER}));
 workgroupBarrier();
 let p=corner+vec2i(local.xy);
 if(any(p>=vec2i(view.rects.xy))){return;}
 textureStore(spatialOut,p,vec4f(hzSpatialAt(vec2i(local.xy)),0.0,0.0,0.0));
}`,
  [INPUT_WGSL, PI],
)

/**
 * THE HISTORY (`HORIZON_HISTORY_WGSL`), bound at `HORIZON_BINDINGS.history`, and the motion that finds a pixel in it: a texel
 * by its coordinates, WHITE (no occlusion) outside the rectangle the history was drawn in — the border colour of the sampler the
 * history is read through, and the history of an image with none is one white texel —; the history's value at a position,
 * blended from the four texels about it after each is held between two bounds; the position in the last image of a point of
 * this one — the camera's own motion (`view.clip`) with the point's depth, or, where the pixel moves by itself (its vector says
 * so, `hasOwnMotion`) and the velocity stage measured the image (`view.delta.w`), the vector — with the device depth it had there.
 */
const HISTORY_WGSL = wgslBlock(
  'HORIZON_HISTORY_WGSL',
  [HORIZON_COMMON_WGSL, VECTOR_CODEC_WGSL],
  `@group(0) @binding(${B.history}) var historyTex:texture_2d<f32>;
@group(0) @binding(${B.vectors}) var vectors:texture_2d<u32>;
fn hzHistoryAt(p:vec2i)->f32{
 if(any(p<vec2i(0))||any(p>=vec2i(view.history.xy))){return 1.0;}
 return textureLoad(historyTex,p,0).r;
}
fn hzHistoryClamped(uv:vec2f,low:f32,high:f32)->f32{
 let q=uv*view.history.xy-vec2f(0.5);
 let f=floor(q);
 let w=q-f;
 let base=vec2i(f);
 let a=clamp(hzHistoryAt(base),low,high);
 let b=clamp(hzHistoryAt(base+vec2i(1,0)),low,high);
 let c=clamp(hzHistoryAt(base+vec2i(0,1)),low,high);
 let d=clamp(hzHistoryAt(base+vec2i(1,1)),low,high);
 return a*(1.0-w.x)*(1.0-w.y)+b*w.x*(1.0-w.y)+c*(1.0-w.x)*w.y+d*w.x*w.y;
}
fn hzReproject(uv:vec2f,deviceZ:f32)->vec3f{
 let ndc=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0);
 let before=view.clip*vec4f(ndc,deviceZ,1.0);
 var screen=before.xy/before.w;
 if(view.delta.w>0.5){
  let pixel=clamp(aoPixelAt(uv),vec2i(0),vec2i(view.lens.zw)-vec2i(1));
  let word=textureLoad(vectors,pixel,0).r;
  if(hasOwnMotion(word)){screen=ndc-decodeVector(word);}
 }
 return vec3f(screen.x*0.5+0.5,0.5-screen.y*0.5,before.z/before.w);
}`,
)

/**
 * THE TEMPORAL FILTER (`hzTemporalMain`): this image's occlusion, read linearly, blended into the history. The history is
 * read where the pixel's point was in the last image, each of its four texels held to a range about this image's value —
 * a tenth either side, none where the pixel moves fast — and where the pixel stands, the two weighed by how alike the motion
 * of the pixel and of what the last image's depth there moved are; the result takes `view.delta.z` of this image's value.
 */
export const HORIZON_TEMPORAL_WGSL = wgslProgram(
  `
@fragment fn hzTemporalMain(@builtin(position) at:vec4f)->@location(0) vec4f{
 let p=vec2i(floor(at.xy));
 let uv=(vec2f(p)+vec2f(0.5))/view.rects.xy+vec2f(0.125)/view.lens.zw;
 let current=hzInputLinear(uv,view.input.xy);
 let z=hizOpaqueDepth(aoPixelAt(uv));
 let before=hzReproject(uv,z);
 let moved=uv-before.xy;
 let speed=saturate(length(moved)*100.0);
 let there=hizOpaqueDepth(aoPixelAt(fract(before.xy)));
 let behind=before.xy-hzReproject(before.xy,there).xy;
 let alike=1.0-saturate(abs((moved-behind).x+(moved-behind).y)*100.0);
 let range=mix(0.1,0.0,speed);
 let low=saturate(current-range);
 let high=saturate(current+range);
 let history=mix(clamp(hzHistoryAt(p),low,high),hzHistoryClamped(before.xy,low,high),alike);
 return vec4f(mix(history,current,view.delta.z),0.0,0.0,1.0);
}`,
  [INPUT_WGSL, HISTORY_WGSL, FULLSCREEN_VERTEX],
)

/**
 * THE UPSAMPLE (`hzUpsampleMain`): the last pass's result read linearly at four positions a quarter of its texel from the
 * pixel's, the least of the four (a conservative filter: the occlusion of a pixel is never lighter than its neighbourhood's).
 * Where the spatial filter is off (`view.mode.x`) it is also the pass that finishes the occlusion: the integral, which an
 * unoccluded surface brings to two over π, is taken back to one, raised to the power and weighed by the intensity, as the
 * spatial filter does.
 */
export const HORIZON_UPSAMPLE_WGSL = wgslProgram(
  `
@fragment fn hzUpsampleMain(@builtin(position) at:vec4f)->@location(0) vec4f{
 let uv=floor(at.xy)/view.rects.xy+vec2f(0.5)/view.rects.xy;
 let size=view.input.xy;
 let off=vec2f(0.25)/size;
 let a=saturate(hzInputLinear(uv+vec2f(-off.x,-off.y),size));
 let b=saturate(hzInputLinear(uv+vec2f(off.x,-off.y),size));
 let c=saturate(hzInputLinear(uv+vec2f(-off.x,off.y),size));
 let d=saturate(hzInputLinear(uv+vec2f(off.x,off.y),size));
 let least=min(min(a,b),min(c,d));
 let finished=1.0-(1.0-pow(abs(least*0.5*PI),view.tail.x))*view.tail.y;
 return vec4f(select(least,finished,view.mode.x>0.5),0.0,0.0,1.0);
}`,
  [INPUT_WGSL, PI, FULLSCREEN_VERTEX],
)
