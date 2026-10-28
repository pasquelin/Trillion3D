import { type WgslDecl, wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../../../math/src/wgsl/projection.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { VSM_CONSTANTS_WGSL, VSM_LEVEL0_TEXELS, VSM_UNIT_PER_CM } from '../vsm/constants.ts'
import { vsmTraceRayWgsl } from '../vsm/trace/traceRayWgsl.ts'
import { CLASSIC_PCF_WGSL } from './pcfWgsl.ts'
import { BIAS_FACTOR_MAX, CLASSIC_SUN_SLOTS } from './classicView.ts'

/** The constants of the classic trace and the taps of the disc. */
const classicConstantsText = () => `
const CLASSIC_UNIT_PER_CM:f32=${VSM_UNIT_PER_CM};
const CLASSIC_SUN_SLOTS:u32=${CLASSIC_SUN_SLOTS}u;
const CLASSIC_MAX_CASCADES:u32=10u;
var<private> CLASSIC_DISC=array<vec2f,29>(${DISC});`

/** The depth of a map at a point, the filter over it and its biases. */
const classicFilterText =
  () => `/** The stored depth at a point (\`uv\`) of map \`h\` at \`mip\`: (1, depth) where a page holds it, (0, 0) where none does. */
fn classicDepthAt(h:VsmHandle,clipmap:bool,mip:u32,uv:vec2f)->vec2f{
 var ray:VsmRay;
 ray.clipmap=clipmap;
 ray.mip=mip;
 ray.pages.map=NO_INDEX;
 let t=vsmRayTexel(&ray,h,uv);
 if(!t.valid){return vec2f(0.0,0.0);}
 return vec2f(1.0,vsmClipmapTexelDepth(t,vsmPoolDepth(t.poolTexel)));
}
/** The share of the 5 by 5 window around \`uv\` of map \`h\` at \`mip\` that the receiver at map depth \`receiver\` sees the light through, the ramp of \`ramp\` map-depth units, after the correction of the filter's blur. A texel no page holds lets the light through. */
fn classicFiltered(h:VsmHandle,clipmap:bool,mip:u32,uv:vec2f,receiver:f32,transitionScale:f32)->f32{
 let size=f32(vsmTexelsAtLevel(mip));
 let position=uv*size-0.5;
 let fraction=fract(position);
 let first=floor(position)-2.0;
 var values:array<f32,36>;
 for(var y=0u;y<6u;y++){
  for(var x=0u;x<6u;x++){
   let at=(first+vec2f(f32(x),f32(y))+0.5)/size;
   let stored=classicDepthAt(h,clipmap,mip,at);
   values[y*6u+x]=select(1.0,classicTransitionVisibility(1.0-stored.y,1.0-receiver,transitionScale),stored.x>0.5);
  }
 }
 return classicOverBlurCorrection(classicPcf5x5(fraction,values));
}
fn classicAccumulated(exponent:f32,index:u32,count:u32)->f32{
 if(index==0u){return 0.0;}
 var current=1.0;var taken=0.0;var total=0.0;
 for(var i=0u;i<count;i++){
  if(i<index){taken+=current;}
  total+=current;
  current*=exponent;
 }
 return taken/total;
}
/** The slope of a surface whose normal makes the cosine \`nol\` with the light's axis, held to \`maxSlope\` (\`ShadowDepthVertexShader.usf:97-107\`). */
fn classicSlope(nol:f32,maxSlope:f32)->f32{
 return clamp(select(maxSlope,sqrt(saturate(1.0-nol*nol))/nol,nol>0.0),0.0,maxSlope);
}
/** The light's own factors on the constant bias (x) and the slope bias (y), unpacked from the word the source's size gives way to in a classic view (\`classicBiasWord\`). */
fn classicUserBias(light:VsmProjectionLight)->vec2f{
 return unpack2x16unorm(bitcast<u32>(light.sourceRadius))*${BIAS_FACTOR_MAX}.0;
}`

/** The shadow of a sun, by the cascades of the view. */
const classicSunText =
  () => `/** The shadow of the sun \`light\` (the cascades of the view's words) at the receiver \`P\`: lit where it has none. Biases and ramp in distance, as \`classicBias.ts\` has them. */
fn classicSun(light:VsmProjectionLight,P:vec3f,n:vec3f,axis:vec3f)->f32{
 if(vsmView.isOrtho!=0u){return 1.0;}
 var slot=CLASSIC_SUN_SLOTS;
 for(var i=0u;i<CLASSIC_SUN_SLOTS;i++){
  if(i32(vsmView.classic[2u*i+1u].x)==light.mapId){slot=i;break;}
 }
 if(slot==CLASSIC_SUN_SLOTS){return 1.0;}
 let sun=vsmView.classic[2u*slot];
 let more=vsmView.classic[2u*slot+1u];
 let bias=vsmView.classic[16];
 let near=vsmView.classic[19].x;
 let maxSlope=vsmView.classic[19].y;
 let user=classicUserBias(light);
 let count=min(u32(sun.w),CLASSIC_MAX_CASCADES);
 let depth=dot(vsmView.viewForward,P-vsmView.shiftedEye);
 let tanX=1.0/vsmView.viewToClip[0][0];
 let tanY=1.0/vsmView.viewToClip[1][1];
 let nol=saturate(dot(n,axis));
 let slope=classicSlope(abs(dot(n,axis)),maxSlope);
 let base=vsmHandleFromId(u32(light.mapId));
 var visible=1.0;
 for(var k=0u;k<count;k++){
  let low=near+classicAccumulated(sun.y,k,count)*(sun.x-near);
  let split=near+classicAccumulated(sun.y,k+1u,count)*(sun.x-near);
  let fade=(split-low)*sun.z;
  let last=k+1u==count;
  let high=select(split+fade,split,last);
  let plane=select(split,split-fade,last);
  if(depth<low){break;}
  if(depth>=high){continue;}
  // The sphere that bounds the cascade's slice of the view, and the level it is drawn in.
  let span=high-low;
  let farDiagonal=(tanX*high)*(tanX*high)+(tanY*high)*(tanY*high);
  let nearDiagonal=(tanX*low)*(tanX*low)+(tanY*low)*(tanY*low);
  let centre=clamp(high-((nearDiagonal-farDiagonal)/(2.0*span)+span*0.5),low,high);
  let radius=max(sqrt(max(farDiagonal+(high-centre)*(high-centre),nearDiagonal+(centre-low)*(centre-low))),CLASSIC_UNIT_PER_CM);
  let absolute=ceil(log2(radius/CLASSIC_UNIT_PER_CM*${VSM_LEVEL0_TEXELS / 2}.0/bias.w));
  let levels=vsmProjectionOf(base).levelsLeft;
  let level=clamp(i32(absolute-more.y),0,max(levels-1,0));
  let h=vsmHandleOffset(base,level);
  var placed:VsmLightMap;
  vsmLightMapOn(&placed,h,P);
  // The constant bias and the ramp are the settings' times a texel of the sphere; the slope adds its share of the bias (the range of the cascade's depth cancels).
  let ramp=bias.x*(radius/bias.w)*user.x;
  let biasWorld=ramp*(1.0+bias.y*user.y*slope);
  let scale=vsmMapDepthScale(placed);
  let transition=classicReceiverTransitionScale(scale/max(ramp,0.00001),bias.z,nol);
  let receiver=placed.mapPoint.z+biasWorld*scale;
  let shadow=classicFiltered(h,true,0u,placed.mapPoint.xy,receiver,transition);
  visible=min(visible,mix(1.0,shadow,classicCascadeBlend(depth,plane,high-plane)));
 }
 return visible;
}`

/** The finest resident mip of a map at a point and a tap of it. */
const classicResidentText =
  () => `/** The finest mip of map \`h\` a page of which is resident at \`uv\`, from the map's own finest. */
fn classicResidentMip(h:VsmHandle,finest:u32,uv:vec2f)->u32{
 var mip=finest;
 for(;mip<VSM_MIPS-1u;mip++){
  if(classicDepthAt(h,false,mip,uv).x>0.5){break;}
 }
 return mip;
}
/** One tap of a point light's disc: the 2 by 2 texels around \`uv\` of map \`h\`, each lit where it holds nothing nearer the light than \`compare\`, weighed as the hardware's comparison filter weighs them. */
fn classicTap(h:VsmHandle,mip:u32,uv:vec2f,compare:f32)->f32{
 let size=f32(vsmTexelsAtLevel(mip));
 let position=uv*size-0.5;
 let fraction=fract(position);
 let first=floor(position);
 var lit=0.0;
 for(var y=0u;y<2u;y++){
  for(var x=0u;x<2u;x++){
   let stored=classicDepthAt(h,false,mip,(first+vec2f(f32(x),f32(y))+0.5)/size);
   let weight=select(1.0-fraction.x,fraction.x,x==1u)*select(1.0-fraction.y,fraction.y,y==1u);
   lit+=weight*select(1.0,select(1.0,0.0,stored.y>compare),stored.x>0.5);
  }
 }
 return lit;
}`

/** The shadow of a point light. */
const classicPointText =
  () => `/** The shadow of the point light \`light\` at the receiver \`P\`: the 29 taps of the reference's disc (\`ShadowProjectionCommon.ush:89-120,222-235\`) around the direction, each compared with the receiver's depth moved toward the light by the bias its tap's radius scales. */
fn classicPoint(light:VsmProjectionLight,P:vec3f,n:vec3f,axis:vec3f,dist:f32)->f32{
 let params=vsmView.classic[17];
 let user=classicUserBias(light);
 let rel=P-light.shiftedPosition;
 let h=vsmHandleOffset(vsmHandleFromId(u32(light.mapId)),i32(vsmCubeFace(rel)));
 var placed:VsmLightMap;
 vsmLightMapOn(&placed,h,P);
 let pd=vsmProjectionOf(h);
 let ndc=perspectiveDivide(placed.mapPoint);
 let mip=classicResidentMip(h,pd.finestMip,ndc.xy);
 let texels=f32(vsmTexelsAtLevel(mip));
 let nol=saturate(dot(n,axis));
 let zAlong=max(abs(rel.x),max(abs(rel.y),abs(rel.z)));
 // The bias in the reference's depth, over the distance along the face's axis, brought back to a shift toward the light.
 let depthBias=params.x*512.0/texels*2.0*user.x;
 let numerator=depthBias+(1.0-nol)*depthBias*params.y*user.y;
 let near=0.1*CLASSIC_UNIT_PER_CM;
 let projection=near*light.radius/max(light.radius-near,near);
 let perDistance=vsmDepthPerDistance(pd,dist*dist);
 let direction=normalize(rel);
 let side=normalize(cross(direction,vec3f(0.0,0.0,1.0)));
 let up=cross(side,direction);
 var sum=0.0;
 for(var i=0u;i<29u;i++){
  let tap=CLASSIC_DISC[i];
  let shift=zAlong*numerator*length(tap)/(projection+numerator*length(tap)*zAlong);
  let around=normalize(direction+(side*tap.x+up*tap.y)/texels);
  var there:VsmLightMap;
  let faceHere=vsmHandleOffset(vsmHandleFromId(u32(light.mapId)),i32(vsmCubeFace(around)));
  vsmLightMapOn(&there,faceHere,light.shiftedPosition+around*dist);
  let at=perspectiveDivide(there.mapPoint);
  sum+=classicTap(faceHere,mip,at.xy,ndc.z+shift*perDistance);
 }
 return classicOverBlurCorrection(sum/29.0);
}`

/** The shadow of a spot light, and the dispatch by the light's kind. */
const classicSpotText =
  () => `/** The shadow of the spot light \`light\` at the receiver \`P\`, \`dist\` from it: the 5 by 5 window of its map's finest resident mip. */
fn classicSpot(light:VsmProjectionLight,P:vec3f,n:vec3f,axis:vec3f,dist:f32)->f32{
 let params=vsmView.classic[18];
 let maxSlope=vsmView.classic[19].y;
 let user=classicUserBias(light);
 let h=vsmHandleFromId(u32(light.mapId));
 var placed:VsmLightMap;
 vsmLightMapOn(&placed,h,P);
 let pd=vsmProjectionOf(h);
 let ndc=perspectiveDivide(placed.mapPoint);
 let mip=classicResidentMip(h,pd.finestMip,ndc.xy);
 let texels=f32(vsmTexelsAtLevel(mip));
 let nol=saturate(dot(n,axis));
 // The slope is that of the surface against the cone's axis, as the depth pass reads it (the light's direction points to the light).
 let slope=classicSlope(abs(dot(n,light.direction)),maxSlope);
 let perDistance=vsmDepthPerDistance(pd,dist*dist);
 let near=0.1*CLASSIC_UNIT_PER_CM;
 // Both biases are the reference's, over the spot's depth range (its range less the near plane), which cancels from the depth bias.
 let depthWorld=params.x*512.0/texels*CLASSIC_UNIT_PER_CM*2.0*user.x*(1.0+params.y*user.y*slope);
 let ramp=(light.radius-near)*2.0*user.x/max(params.z,0.0001);
 let receiver=ndc.z+depthWorld*perDistance;
 let transition=classicReceiverTransitionScale(perDistance/max(ramp,0.00001),params.w,nol);
 return classicFiltered(h,false,mip,ndc.xy,receiver,transition);
}
/** The classic shadow of a light at a receiver, 1 where it is lit. */
fn vsmClassicShadow(light:VsmProjectionLight,P:vec3f,n:vec3f,axis:vec3f,dist:f32,directional:bool)->f32{
 if(directional){return classicSun(light,P,n,axis);}
 if(light.kind==LIGHT_KIND_SPOT){return classicSpot(light,P,n,axis,dist);}
 return classicPoint(light,P,n,axis,dist);
}
`

/**
 * THE CLASSIC SHADOW OF ONE LIGHT AT ONE RECEIVER (`shadowVirtualEnable` off), in place of the soft rays' trace (`vsmTraceWgsl`, `classic`): the filter of
 * `pcf.ts` over the dense maps the dense marking asked (`vsmMarkDense`), the view's words `vsmView.classic` (`classicView.ts`) saying how.
 *
 * - A SUN is drawn in cascades by the view's depth: the splits, the fade and the sphere that bounds each are `cascadeSplits.ts`' in the shader, the clipmap level its
 *   sphere takes the one `denseEntries.ts` asked pages of. A receiver in two cascades — a cascade is drawn past its split by its fade — takes the least of their shadows, each
 *   brought back toward light by its weight (`classicCascadeBlend`); past the last cascade it is lit. An orthographic view has no cascade.
 * - A LOCAL LIGHT reads its map (a cube face, or the spot's) at the finest mip the dense marking made resident at the receiver.
 *
 * The biases are the reference's, in the units of the map: a depth bias and a transition (the ramp the visibility falls over) in distance — a sun's the settings' times a texel
 * of the cascade's sphere, a point light's a share of its range, a spot's centimetres —, a slope bias of the settings' times a texel times the receiver's slope, and
 * the transition widened where the surface turns from the light (`classicReceiverTransitionScale`). The filter's result is squared (`classicOverBlurCorrection`).
 */
const CLASSIC_PROGRAM = (pool: WgslDecl) =>
  wgslBlock(
    'CLASSIC_TRACE_WGSL',
    [VSM_CONSTANTS_WGSL, CLASSIC_PCF_WGSL, vsmTraceRayWgsl(pool), perspectiveDivide, NO_INDEX],
    `${classicConstantsText()}\n${classicFilterText()}\n${classicSunText()}\n${classicResidentText()}\n${classicPointText()}\n${classicSpotText()}`,
  )

/** The 29 taps of a point light's disc, radius 2.5, in texels of its map (`ShadowProjectionCommon.ush:89-120`). */
const DISC_TAPS = [
  [0.0, 2.5],
  [1.016842, 2.283864],
  [1.857862, 1.672826],
  [2.377641, 0.772542],
  [2.486305, -0.261321],
  [2.165063, -1.25],
  [1.469463, -2.022543],
  [0.519779, -2.445369],
  [-0.519779, -2.445369],
  [-1.469463, -2.022542],
  [-2.165064, -1.25],
  [-2.486305, -0.261321],
  [-2.377641, 0.772543],
  [-1.857862, 1.672827],
  [-1.016841, 2.283864],
  [0.091021, -0.642186],
  [0.698035, 0.10094],
  [0.959731, -1.169393],
  [-1.05388, 1.18038],
  [-1.479156, -0.606937],
  [-0.839488, -1.320002],
  [1.438566, 0.705359],
  [0.067064, -1.605197],
  [0.728706, 1.344722],
  [1.521424, -0.380184],
  [-0.199515, 1.590091],
  [-1.524323, 0.36401],
  [-0.692694, -0.086749],
  [-0.082476, 0.654088],
]
const DISC = DISC_TAPS.map(([x, y]) => `vec2f(${x.toFixed(6)},${y.toFixed(6)})`).join(',')

export const classicTraceWgsl = CLASSIC_PROGRAM
