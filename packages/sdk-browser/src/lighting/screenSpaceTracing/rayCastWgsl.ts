import { wgslBlock, wgslVariants } from '../../../../math/src/wgsl/decl.ts'
import { screenEdgeVignette } from '../../../../math/src/wgsl/projection.ts'
import { clampToExtent } from '../../../../math/src/wgsl/sampling.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { VECTOR_CODEC_WGSL } from '../../post/taa/velocityWgsl.ts'
import { LOBE_AXIS_WGSL } from '../lobeAxisWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { SURFACE_MODEL_MASK, UNLIT_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import {
  SCREEN_SPACE_GROUP,
  SCREEN_SPACE_VIEW_BINDING,
  SCREEN_SPACE_VIEW_WGSL,
} from './screenSpaceView.ts'

/** The bindings of the group every pass of the screen-space traces reads its inputs from. The depth pyramid takes three, from `hiz`. */
export const SCREEN_SPACE_BINDINGS = {
  view: SCREEN_SPACE_VIEW_BINDING,
  hiz: 1,
  normals: 4,
  flags: 5,
  lobes: 6,
  color: 7,
  colorSampler: 8,
  vectors: 9,
  out: 10,
  outSecond: 11,
  list: 12,
} as const
const B = SCREEN_SPACE_BINDINGS

/** The view, the depth pyramid and the surface the passes read, declared once. */
export const SCREEN_SPACE_INPUTS_WGSL = wgslBlock(
  'SCREEN_SPACE_INPUTS_WGSL',
  [SCREEN_SPACE_VIEW_WGSL, hizDepthWgsl(SCREEN_SPACE_GROUP, B.hiz), clampToExtent],
  `@group(${SCREEN_SPACE_GROUP}) @binding(${B.view}) var<uniform> ssView:ScreenSpaceView;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.normals}) var surfaceNormals:texture_2d<f32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.flags}) var surfaceFlags:texture_2d<u32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.lobes}) var surfaceLobes:texture_2d<u32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.color}) var colorImage:texture_2d<f32>;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.colorSampler}) var colorSampler:sampler;
@group(${SCREEN_SPACE_GROUP}) @binding(${B.vectors}) var colorVectors:texture_2d<u32>;
const SS_PI:f32=3.14159265358979;
fn ssPerspective()->bool{return ssView.camera.w!=0.0;}
/** The view depth of a device depth z (the projection's inverse). */
fn ssSceneDepth(z:f32)->f32{
 let d=ssView.depth;
 return (d.y-d.w*z)/(d.z*z-d.x);
}
/** The pixel's world radius at the view depth depth. */
fn ssPixelRadius(depth:f32)->f32{return ssView.pixelRadius.x*depth+ssView.pixelRadius.y;}
/** The world point of a screen position p (−1..1, y up) at a device depth z. */
fn ssWorldAt(p:vec2f,z:f32)->vec3f{
 let w=ssView.clipToWorld*vec4f(p,z,1.0);
 return w.xyz/w.w;
}
/** The screen position (−1..1, y up) of the centre of the pixel p of a view size pixels across. */
fn ssScreenOfPixel(p:vec2f)->vec2f{return (p*ssView.size.zw)*vec2f(2.0,-2.0)+vec2f(-1.0,1.0);}
/** The direction from the eye to a point of the translated world. */
fn ssCameraVector(P:vec3f)->vec3f{
 return select(ssView.forward.xyz,normalize(P-ssView.camera.xyz),ssPerspective());
}
fn ssFarDepth(z:f32)->bool{return z<=0.0;}
/** Whether a pixel of flags flags wears the unlit model: no light reaches it, none is traced for it. */
fn ssUnlit(flags:u32)->bool{return (flags&${SURFACE_MODEL_MASK}u)==${UNLIT_FLAG}u;}`,
)

/** The structs of a screen-space ray and of its cast: shared by the traces of the screen-space module and by the screen probes' fixed-step trace. */
const CAST_STRUCTS_WGSL = wgslBlock(
  'CAST_STRUCTS_WGSL',
  [],
  `struct SsRay{start:vec3f,step:vec3f,tolerance:f32,clipped:bool,}
struct SsCast{hit:vec3f,level:f32,found:bool,uncertain:bool,}`,
)

/** The march of a cast: the ray's steps four at a time, up to the first hit (\`stopWhenUncertain\` ends it also where a sample lies behind a surface). */
const castMarchText = (
  stopWhenUncertain: boolean,
) => `fn ssCast(ray:SsRay,roughness:f32,numSteps:u32,stepOffset:f32,startMip:f32)->SsCast{
 let startUVz=vec3f(ray.start.xy*vec2f(0.5,-0.5)+vec2f(0.5),ray.start.z);
 let inverseSteps=1.0/f32(numSteps);
 let stepUVz=vec3f(ray.step.xy*vec2f(0.5,-0.5),ray.step.z)*inverseSteps;
 let tolerance=ray.tolerance*inverseSteps;
 let rayUVz=startUVz+stepUVz*stepOffset;
 var level=startMip;
 let mipStep=(8.0/f32(numSteps))*roughness;
 var lastDiff=0.0;
 var found=false;
 var uncertain=false;
 var i=0u;
 var diff=vec4f(0.0);
 var hits=vec4<bool>(false);
 loop{
  if(i>=numSteps){break;}
  var depths=vec4f(0.0);
  var zs=vec4f(0.0);
  var mips=vec4f(0.0);
  mips=vec4f(level,level,0.0,0.0);
  level+=mipStep;
  mips.z=level;mips.w=level;
  level+=mipStep;
  for(var j=0u;j<4u;j++){
   let t=f32(i)+f32(j+1u);
   let uv=rayUVz.xy+t*stepUVz.xy;
   zs[j]=rayUVz.z+t*stepUVz.z;
   depths[j]=ssFurthest(uv,mips[j]);
  }
  diff=zs-depths;
  hits=(abs(diff+vec4f(tolerance))<vec4f(tolerance))&(depths!=vec4f(0.0));
  let behind=(diff+vec4f(tolerance))<vec4f(-tolerance);
  for(var j=0u;j<4u;j++){
   found=found||hits[j];
   uncertain=uncertain||(behind[j]&&!found);
  }
  if(found${stopWhenUncertain ? '||uncertain' : ''}){break;}
  lastDiff=diff.w;
  i+=4u;
 }
 var hit=rayUVz+stepUVz*f32(i);
 if(found){
`

/** The hit's place: the first sample that hit (\`indirect\`), else the line through the two samples around it. */
const castHitText = (indirect: boolean) =>
  indirect
    ? ` let times=select(vec4f(5.0),vec4f(1.0,2.0,3.0,4.0),hits);
  let time=f32(i)+min(min(min(times.x,times.y),times.z),times.w);
  hit=rayUVz+stepUVz*time;`
    : ` var d0=diff.z;var d1=diff.w;var t0=3.0;
  if(hits.z){d0=diff.y;d1=diff.z;t0=2.0;}
  if(hits.y){d0=diff.x;d1=diff.y;t0=1.0;}
  if(hits.x){d0=lastDiff;d1=diff.x;t0=0.0;}
  t0+=f32(i);
  let lerpTime=saturate(d0/(d0-d1));
  hit=rayUVz+stepUVz*(t0+lerpTime);`

/** The end of the cast: the hit's block closed, the result returned. */
const CAST_RESULT_TEXT = `
 }
 return SsCast(hit,level,found,uncertain);
}`

/** The march of a ray over the furthest depth of the pyramid (\`ssCast\`), four steps at a time: it reads the pyramid through \`ssFurthest(uv, mip)\`, which its
 *  caller defines (the furthest depth of the pyramid it binds), and nothing else of the module's inputs. \`indirect\`: the hit is the first sample that hit,
 *  else the line through the two samples around it. */
export const castFunctionWgsl = (indirect: boolean, stopWhenUncertain = false) =>
  wgslBlock(
    `CAST_FUNCTION_WGSL(${indirect}, ${stopWhenUncertain})`,
    [CAST_STRUCTS_WGSL],
    castMarchText(stopWhenUncertain) + castHitText(indirect) + CAST_RESULT_TEXT,
  )

/** The furthest depth of the pyramid at a view texture coordinate `uv` and mip `mip` of a chain that starts at half the image's size,
 *  the nearest level of the pyramid (`hizCellFurthest`): what every cast over the furthest depth reads. */
export const SS_FURTHEST_WGSL = wgslBlock(
  'SS_FURTHEST_WGSL',
  [],
  `fn ssFurthest(uv:vec2f,mip:f32)->f32{
 let level=clamp(i32(floor(mip+0.5))+1,1,max(hizLevelCount()-1,1));
 let size=vec2f(hizLevels.level[level].yz);
 return hizCellFurthest(vec2i(floor(uv*size)),level);
}`,
)

/** The factor that clips the step of a screen ray from start at the screen's border (above 1 when the step ends inside it): the one declaration the march's rays and the clip points' rays (ssRayOfClip) share. */
export const SS_STEP_FACTOR_WGSL = wgslBlock(
  'SS_STEP_FACTOR_WGSL',
  [],
  `
/** The factor that clips the step of a ray from start at the screen's border. */
fn ssStepFactor(start:vec2f,step:vec2f)->f32{
 let inverse=0.5*length(step);
 let s=vec2f(1.0)-max(abs(step+start*inverse)-vec2f(inverse),vec2f(0.0))/abs(step);
 return min(s.x,s.y)/inverse;
}`,
)

/**
 * The screen ray through two clip points of a view (`ssRayOfClip`), from `startClip` to `endClip`: the step taken to the screen's border (`extend`: stretched to it, else held
 * inside it, the ray then `clipped` when the border or `limited` — its length cut by the depth — ended it), its tolerance the greater of its own depth step and `slope` times the
 * depth the start gains over the ray (`deeper`, the device depth at its end), in a perspective; that gain alone in an orthographic view. The translucent surfaces' reflection trace makes its rays by it; the march's own `ssRayFromWorld` (`SCREEN_SPACE_CAST_WGSL`) does the same sum in its own text, which the default programs keep as it is, and both take `ssStepFactor` from the one block.
 */
export const SS_RAY_OF_CLIP_WGSL = wgslBlock(
  'SS_RAY_OF_CLIP_WGSL',
  [CAST_STRUCTS_WGSL, SS_STEP_FACTOR_WGSL],
  `fn ssRayOfClip(startClip:vec4f,endClip:vec4f,deeper:f32,slope:f32,perspective:bool,extend:bool,limited:bool)->SsRay{
 let start=startClip.xyz/startClip.w;
 var step=endClip.xyz/endClip.w-start;
 var factor=ssStepFactor(start.xy,step.xy);
 var clipped=true;
 if(!extend){
  clipped=factor<1.0||limited;
  factor=min(factor,1.0);
 }
 step=step*factor;
 let gain=(start.z-deeper)*slope;
 return SsRay(start,step,select(max(0.0,gain),max(abs(step.z),gain),perspective),clipped);
}`,
)

/**
 * The march of a screen-space ray, the one both traces share. A ray is its start and its step in the screen (x, y in −1..1, z the
 * device depth) and the tolerance a sample may lie from the surface by. ssRayFromWorld makes it from a world ray, clipped at the
 * screen's border (extend: stretched to it) or at the view depth of its start; ssRayFromView from a view-space direction, for
 * the indirect light's cosine rays. ssCast samples the furthest depth of the pyramid four steps at a time, the mip level growing
 * with the roughness, and gives the hit's texture coordinate and depth: a hit lies where a sample is within the tolerance in front of
 * its cell and the cell is not the far plane; the ray is uncertain where a sample lies behind a surface before any hit. A hit of the
 * reflections is refined by the line through the two samples around it, one of the indirect light's is the first sample that hit.
 */
export const SCREEN_SPACE_CAST_WGSL = wgslVariants((indirect: boolean) =>
  wgslBlock(
    `SCREEN_SPACE_CAST_WGSL(${indirect})`,
    [
      SCREEN_SPACE_INPUTS_WGSL,
      CAST_STRUCTS_WGSL,
      castFunctionWgsl(indirect),
      SS_FURTHEST_WGSL,
      SS_STEP_FACTOR_WGSL,
    ],
    `fn ssRayFromWorld(origin:vec3f,dir:vec3f,tMax:f32,sceneDepth:f32,slope:f32,extend:bool)->SsRay{
 let limit=min(tMax,10000.0);
 let viewDir=(ssView.worldToView*vec4f(dir,0.0)).xyz;
 let endDistance=select(limit,min(-0.95*sceneDepth/viewDir.z,limit),viewDir.z<0.0);
 let startClip=ssView.worldToClip*vec4f(origin,1.0);
 let endClip=ssView.worldToClip*vec4f(origin+dir*endDistance,1.0);
 let start=startClip.xyz/startClip.w;
 let end=endClip.xyz/endClip.w;
 let depthClip=startClip+vec4f(0.0,0.0,ssView.depth.x*endDistance,ssView.depth.z*endDistance);
 let depthScreen=depthClip.xyz/depthClip.w;
 var step=end-start;
 var factor=ssStepFactor(start.xy,step.xy);
 var clipped=true;
 if(!extend){
  clipped=factor<1.0||endDistance!=limit;
  factor=min(factor,1.0);
 }
 step=step*factor;
 let tolerance=select(max(0.0,(start.z-depthScreen.z)*slope),max(abs(step.z),(start.z-depthScreen.z)*slope),ssPerspective());
 return SsRay(start,step,tolerance,clipped);
}
fn ssRayFromView(screen:vec2f,z:f32,viewDir:vec3f)->SsRay{
 let scale=ssView.pixelRadius.zw;
 let endClip=vec4f(viewDir.xy*scale,viewDir.z*ssView.depth.x,viewDir.z)+vec4f(screen,z,1.0);
 let start=vec3f(screen,z);
 let end=endClip.xyz/endClip.w;
 let depthScreen=0.5*(start+vec3f(0.0,0.0,ssView.depth.x));
 var step=end-start;
 step=step*ssStepFactor(start.xy,step.xy);
 let tolerance=max(abs(step.z),(start.z-depthScreen.z)*${indirect ? '2.0' : '4.0'});
 return SsRay(start,step,tolerance,true);
}`,
  ),
)

/**
 * What a hit of the reflections reads of the image held: the screen position it stood at there, by the camera's motion or, where the
 * surface moves by itself, by its vector (hasOwnMotion, decodeVector: this position less the last), and the vignette that fades the
 * hits near the border of this image and of the last. Read as the current image (reflection.w is the correction; tiles.z set), a hit is
 * not moved. ssColorAt is the colour at a texture coordinate of the image held, negative and not-a-number values made black.
 */
export const SCREEN_SPACE_REPROJECT_WGSL = wgslBlock(
  'SCREEN_SPACE_REPROJECT_WGSL',
  [SCREEN_SPACE_INPUTS_WGSL, VECTOR_CODEC_WGSL, screenEdgeVignette],
  `
struct SsReprojected{uv:vec2f,vignette:f32,}
fn ssReprojectHit(hitUVz:vec3f)->SsReprojected{
 let thisScreen=(hitUVz.xy-vec2f(0.5))*vec2f(2.0,-2.0);
 let thisClip=vec4f(thisScreen,hitUVz.z,1.0);
 let prevClip=ssView.clipToPrevClip*thisClip;
 var prevScreen=prevClip.xy/prevClip.w;
 let size=vec2i(textureDimensions(colorVectors));
 let words=textureLoad(colorVectors,clampToExtent(vec2i(floor(hitUVz.xy*vec2f(size))),size),0);
 if(hasOwnMotion(words.r)){prevScreen=thisClip.xy-decodeVector(words.r);}
 if(ssView.tiles.z!=0.0){prevScreen=thisScreen;}
 return SsReprojected(prevScreen*ssView.previous.xy+ssView.previous.zw,min(screenEdgeVignette(thisScreen),screenEdgeVignette(prevScreen)));
}
fn ssColorAt(uv:vec2f)->vec4f{
 let rgb=textureSampleLevel(colorImage,colorSampler,uv,0.0).rgb;
 return vec4f(-min(-rgb,vec3f(0.0)),1.0);
}
/** The squared distance from origin to the world point a hit lies at. */
fn ssHitSquaredDistance(origin:vec3f,hitUVz:vec3f)->f32{
 let screen=(hitUVz.xy-vec2f(0.5))*vec2f(2.0,-2.0);
 let d=origin-ssWorldAt(screen,hitUVz.z);
 return dot(d,d);
}`,
)

/** The surface at a pixel as both traces read it: its normal, its roughness (a clear coat's blended in by the coat's share), whether a ray is
 *  traced for it (a lit pixel with a surface), its flags. */
export const SCREEN_SPACE_SURFACE_WGSL = wgslBlock(
  'SCREEN_SPACE_SURFACE_WGSL',
  [SCREEN_SPACE_INPUTS_WGSL, LOBE_AXIS_WGSL],
  `
struct SsSurface{N:vec3f,roughness:f32,flags:u32,valid:bool,}
fn ssSurfaceAt(p:vec2i)->SsSurface{
 let size=vec2i(textureDimensions(surfaceNormals));
 let c=clampToExtent(p,size);
 let normal=textureLoad(surfaceNormals,c,0);
 let flags=textureLoad(surfaceFlags,c,0).r;
 var roughness=normal.a;
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){
  let coat=packedCoat(textureLoad(surfaceLobes,c,0));
  roughness=mix(roughness,coat.y,coat.x);
 }
 return SsSurface(normalize(normal.xyz),roughness,flags,!ssUnlit(flags));
}`,
)
