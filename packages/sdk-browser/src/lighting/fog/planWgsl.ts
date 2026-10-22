import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ndcToUv, perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'
import { FOG_SURFACE_WGSL } from './gridWgsl.ts'

/**
 * WHAT A CELL DOES THIS IMAGE, one reading for every pass that works on its samples (`fogCellPlan`): the
 * scatter that lights them and the static term's pass that adds the baked light to them (`staticWgsl.ts`)
 * take the same samples because they read the same plan. The program declares the frame (`frame`), the
 * furthest depth of this image and of the one before (`fogFurthest`, `fogPreviousFurthest`) and the scene's
 * depth (`fogDepth`).
 *
 * A cell wholly behind the surfaces of its pixels — the furthest depth over its pixels and half a cell
 * around them (`fogFurthest`) is nearer than the cell, half a cell toward the eye — is hidden: it holds
 * nothing, light or extinction. The history of a cell is the previous volume at where the cell's centre
 * was in the previous image: its point through the previous view-projection, the slice of its depth. It is
 * dropped where that falls outside the volume, or where the surfaces of the previous image hid it
 * (`fogRepairHistory`: the four cells around the read are tested against the previous image's furthest
 * depth; one that failed moves the read toward the side that passed, none that passed drops the history).
 * A cell whose history is dropped takes `frame.blend.y` samples, one for each of the offsets of the images
 * before, and averages them, so that a cell the camera just uncovered is as smooth as one the blend has
 * kept; any other takes one, at the offset the image's jitter names (`fogSampleOffset`).
 */
export const FOG_PLAN_WGSL = wgslBlock(
  'FOG_PLAN_WGSL',
  [FOG_SURFACE_WGSL, ndcToUv, perspectiveDivide],
  `
/** Where the cell at \`P\` was in the previous volume, in its texture coordinates. */
fn fogHistoryUV(P:vec3f)->vec3f{
 let clip=frame.prevViewProj*vec4f(P,1.0);
 let uvw=vec3f(ndcToUv(perspectiveDivide(clip).xy),fogSliceAtDepth(clip.w)*frame.sliceMap.w);
 return min(uvw*vec3f(frame.previous.xy,1.0),vec3f(1.0));
}
/** The four texels of the previous furthest depth around \`uv\`, in the order a gather returns
 *  them: bottom-left, bottom-right, top-right, top-left. */
fn fogPreviousAround(uv:vec2f)->vec4f{
 let last=vec2i(frame.texture.xy)-vec2i(1);
 let at=vec2i(floor(uv*frame.texture.xy-0.5));
 let w=textureLoad(fogPreviousFurthest,clamp(at,vec2i(0),last),0).r;
 let z=textureLoad(fogPreviousFurthest,clamp(at+vec2i(1,0),vec2i(0),last),0).r;
 let x=textureLoad(fogPreviousFurthest,clamp(at+vec2i(0,1),vec2i(0),last),0).r;
 let y=textureLoad(fogPreviousFurthest,clamp(at+vec2i(1,1),vec2i(0),last),0).r;
 return vec4f(x,y,z,w);
}
struct FogHistory{uv:vec2f,valid:bool,}
/** The read \`uv\` of the previous volume moved off the cells the previous image's surfaces hid: the
 *  cell's depth \`z\` before (device) against the furthest depth around the four cells it falls
 *  between. */
fn fogRepairHistory(uv:vec2f,z:f32)->FogHistory{
 let size=frame.texture.xy;
 let full=uv*size;
 let at=max(floor(full-0.5),vec2f(0.0));
 let inside=full-at;
 let seen=fogPreviousAround(min((at+1.0)/size/frame.previous.xy,frame.previous.zw))<vec4f(z);
 if(all(seen)){return FogHistory(uv,true);}
 if(all(seen.wz)){return FogHistory((at+vec2f(inside.x,0.5))/size,true);}
 if(all(seen.xy)){return FogHistory((at+vec2f(inside.x,1.5))/size,true);}
 if(all(seen.wx)){return FogHistory((at+vec2f(0.5,inside.y))/size,true);}
 if(all(seen.zy)){return FogHistory((at+vec2f(1.5,inside.y))/size,true);}
 if(seen.x){return FogHistory((at+vec2f(0.5,1.5))/size,true);}
 if(seen.y){return FogHistory((at+vec2f(1.5,1.5))/size,true);}
 if(seen.w){return FogHistory((at+vec2f(0.5,0.5))/size,true);}
 if(seen.z){return FogHistory((at+vec2f(1.5,0.5))/size,true);}
 return FogHistory(uv,false);
}
/** What a cell does this image (\`fogCellPlan\`): whether the surfaces of its pixels hide it, the weight of
 *  its history, how many samples it takes, and where its history lies in the previous volume. */
struct FogPlan{hidden:bool,alpha:f32,samples:u32,history:vec3f,}
/** The cell's plan: hidden where it lies wholly behind the surfaces of its pixels; else its history
 *  dropped where it falls outside the previous volume or was hidden, and the samples one for each
 *  offset of the images before where the history is missing. */
fn fogCellPlan(cell:vec3u)->FogPlan{
 let flags=u32(frame.medium.w);
 let reproject=(flags&${FOG_VOLUME_FLAG.usesHistory}u)!=0u;
 let skipHidden=(flags&${FOG_VOLUME_FLAG.skipHidden}u)!=0u;
 var back=vec4f(0.0);
 if(skipHidden){
  back=vec4f(fogCellPoint(cell,vec3f(0.5,0.5,-0.5)).xyz,1.0);
  let clip=frame.depthViewProj*back;
  let furthest=textureLoad(fogFurthest,vec2i(min(cell.xy,vec2u(frame.grid.xy)-vec2u(1u))),0).r;
  if(furthest>clip.z/clip.w){return FogPlan(true,0.0,0u,vec3f(0.0));}
 }
 var historyUV=fogHistoryUV(fogCellPoint(cell,vec3f(0.5)).xyz);
 var valid=true;
 if(skipHidden&&reproject){
  let before=frame.prevViewProj*back;
  let moved=fogRepairHistory(historyUV.xy,before.z/before.w);
  historyUV=vec3f(moved.uv,historyUV.z);
  valid=moved.valid;
 }
 var alpha=frame.blend.x;
 var samples=1u;
 if(reproject){
  if(any(historyUV<vec3f(0.0))||any(historyUV>=vec3f(1.0))||!valid){alpha=0.0;}
  if(alpha<0.001&&frame.blend.y>1.0){samples=u32(frame.blend.y);}
 }
 return FogPlan(false,alpha,samples,historyUV);
}
`,
)
