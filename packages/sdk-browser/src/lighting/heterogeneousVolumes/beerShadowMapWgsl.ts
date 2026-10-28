import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { HV_RAY_MARCH_WGSL } from './liveShadingWgsl.ts'

/**
 * THE BEER SHADOW MAP (`r.HeterogeneousVolumes.Shadows` with the shadow type 1, the default): for a light that
 * casts a volumetric shadow, each texel of a map in the light's view holds where the volumes along its ray begin
 * and end and the transmittance at those two places (`FBeerShadowMapData`, `HeterogeneousVolumesBeerShadowMapUtils.ush`):
 * the light-space distance of the first and of the last place with extinction (`T0`, `T1`) and the transmittance
 * at each (`Tau0`, `Tau1`), in the four channels. Between them the transmittance falls as an exponential fitted to the
 * two (`Interpolate`, `HeterogeneousVolumesAdaptiveVolumetricShadowMapSampling.ush:94-129`).
 *
 * A map is a strip of `faces` square images (one for a directional light and a spot, six for a point light: the faces
 * of a cube, in the order -x, +x, -y, +y, -z, +z of the light's space). A face is a basis: its `origin`, its `forward`,
 * `right` and `up` axes; a directional light's face is orthographic, the box of its volumes' bounding sphere
 * of radius `scale.x`; a local light's is a perspective of a half angle of 45 degrees.
 *
 * The reference holds the faces' projection as matrices (built from the light's shadow info) and inverts them for the rays;
 * here the same projections are written as the basis they are made of, which gives the ray of a texel and the texel of a
 * point without a matrix, and from the light buffer alone: a spot light takes the six faces of a point light, not its cone's
 * perspective. The light-space axes are this engine's, the same in the building and in the reading.
 */

/** The faces of a map: six for a local light, one for a directional light. */
export const HV_SHADOW_FACES = 6

/** The map of one light: how many faces, whether it is directional, the faces' size in texels, the light's rank in the light
 *  buffer; and the bounding sphere of the volumes (centre and radius) a directional light's face is the box of, and the
 *  distance from which a local light's rays start (`packShadow`, `beerShadowMapGpu.ts`). */
const HV_SHADOW = wgslStruct(
  'HvShadow',
  [],
  `struct HvShadow{
 info:vec4u,
 sphere:vec4f,
 near:vec4f,
}`,
)

/** The basis of a face of the map of the light light: its origin, its forward, right and up axes. A directional light looks along its
 *  direction from the back of the sphere; a local light looks from its position along the face's axis (-x, +x, -y, +y, -z, +z). */
const BEER_BASIS_WGSL = wgslBlock(
  'BEER_BASIS_WGSL',
  [HV_SHADOW],
  `
struct BeerBasis{origin:vec3f,forward:vec3f,right:vec3f,up:vec3f,}
fn beerBasis(s:HvShadow,light:DirectLight,face:u32)->BeerBasis{
 var b:BeerBasis;
 var reference=vec3f(0.0,1.0,0.0);
 if(s.info.y!=0u){
  b.forward=normalize(light.directionCone.xyz);
  b.origin=s.sphere.xyz-b.forward*s.sphere.w;
 }else{
  let axis=face/2u;
  let sign=select(-1.0,1.0,(face&1u)==1u);
  b.forward=select(select(vec3f(0.0,0.0,sign),vec3f(0.0,sign,0.0),axis==1u),vec3f(sign,0.0,0.0),axis==0u);
  b.origin=light.positionRange.xyz;
 }
 if(abs(b.forward.y)>0.99){reference=vec3f(0.0,0.0,1.0);}
 b.right=normalize(cross(reference,b.forward));
 b.up=cross(b.forward,b.right);
 return b;
}
`,
)

/** The data of a texel and the ways of combining two. The reference's expansion takes the larger of the entry
 *  transmittances of its first argument twice (max(Data0.Tau[0], Data0.Tau[0])): it takes the larger of the two. */
export const BEER_DATA_WGSL = wgslBlock(
  'BEER_DATA_WGSL',
  [],
  `
fn beerValid(d:vec4f)->bool{return d.g>d.r;}
fn beerExpand(a:vec4f,b:vec4f)->vec4f{
 return vec4f(min(a.r,b.r),max(a.g,b.g),max(a.b,b.b),min(a.a,b.a));
}
fn beerCombine(a:vec4f,b:vec4f)->vec4f{
 if(!beerValid(a)){return b;}
 if(!beerValid(b)){return a;}
 return beerExpand(a,b);
}
/** The transmittance at the distance z along the ray of a texel: one before its first extinction, the exponential
 *  fitted to its two ends between them and after the last. */
fn beerInterpolate(d:vec4f,z:f32)->f32{
 if(z<=d.r){return 1.0;}
 let delta=max(d.g-d.r,0.0);
 let sigma=-log(d.a/max(d.b,1e-8))/max(delta,1e-8);
 let x=clamp(z-d.r,0.0,delta);
 return saturate(d.b*exp(-x*sigma));
}
`,
)

/**
 * The building of a map by one volume (RenderVolumetricShadowMapForLightWithLiveShadingCS, the Beer type,
 * HeterogeneousVolumesLiveShadingShadows.usf:534-647): a thread a texel of a face, the ray of the light through it
 * marched through the volume with the volume's shadow step, and the texel combined with what the volumes before
 * this one left in hvBeerPrevious. The program declares hvShadow (a uniform of HvShadow), hvBeerPrevious
 * (a texture of the strip), hvBeerOut (a storage texture of the strip) and the volume's reads (liveShadingWgsl.ts).
 */
export const BEER_BUILD_WGSL = wgslBlock(
  'BEER_BUILD_WGSL',
  [HV_SHADOW, BEER_BASIS_WGSL, BEER_DATA_WGSL, HV_RAY_MARCH_WGSL],
  `
fn beerRayOf(face:u32,uv:vec2f)->array<vec3f,2>{
 let b=beerBasis(hvShadow,directLights.items[hvShadow.info.w],face);
 let x=uv.x*2.0-1.0;
 let y=1.0-uv.y*2.0;
 if(hvShadow.info.y!=0u){
  // Orthographic: the same direction from a point of the face's plane.
  return array<vec3f,2>(b.origin+(b.right*x+b.up*y)*hvShadow.sphere.w,b.forward);
 }
 let d=normalize(b.forward+b.right*x+b.up*y);
 return array<vec3f,2>(b.origin+d*hvShadow.near.x,d);
}
@compute @workgroup_size(8,8,1)
fn hvBeerShadowMain(@builtin(global_invocation_id) id:vec3u){
 hvInit();
 if(id.x>=hvShadow.info.z||id.y>=hvShadow.info.z||id.z>=hvShadow.info.x){return;}
 // A light that casts no shadow into the fog has no map.
 let casting=directLights.items[hvShadow.info.w];
 if(!castsShadow(casting)||!shadowsFog(casting)){return;}
 let face=id.z;
 let uv=(vec2f(id.xy)+vec2f(0.5))/vec2f(f32(hvShadow.info.z));
 let ray=beerRayOf(face,uv);
 let worldOrigin=ray[0];
 let worldDirection=ray[1];
 let worldEnd=worldOrigin+worldDirection*hv.limits.x;
 let localOrigin=(hv.worldToLocal*vec4f(worldOrigin,1.0)).xyz;
 let localEnd=(hv.worldToLocal*vec4f(worldEnd,1.0)).xyz;
 var localDirection=localEnd-localOrigin;
 let localLength=length(localDirection);
 localDirection/=localLength;
 var data=vec4f(hv.limits.x,0.0,1.0,1.0);
 let span=hvIntersectAabb(localOrigin,localDirection,0.0,localLength,hv.boundsOrigin.xyz-hv.boundsExtent.xyz,hv.boundsOrigin.xyz+hv.boundsExtent.xyz);
 if(span.y-span.x>0.0){
  let jitter=select(0.0,hvBlueNoise(id.xy),hv.limits.w>0.5);
  var ray2=hvMakeRay(localOrigin,localDirection,span.x,span.y,worldOrigin,worldDirection,jitter,hvShadowStepSize(localDirection),u32(hv.limits.z),false,false);
  let count=hvStepCount(&ray2);
  var step=ray2.stepSize;
  let jitterSize=step*jitter;
  var transmittance=vec3f(1.0);
  var first=true;
  var lastT=span.x*ray2.toWorldScale;
  for(var i=0u;i<count;i++){
   var localT=min(span.x+ray2.stepSize*(jitter+f32(i)),span.y);
   if(i==count-1u){step=span.y-(localT-jitterSize);}
   let worldT=localT*ray2.toWorldScale;
   let local=localOrigin+localDirection*localT;
   let world=worldOrigin+worldDirection*worldT;
   let extinction=hvSampleExtinction(local,world);
   transmittance*=exp(-extinction*step);
   if(any(extinction>vec3f(0.0))){
    lastT=worldT;
    if(first){data.r=worldT;data.b=dot(transmittance,vec3f(0.2126,0.7152,0.0722));first=false;}
   }
   if(all(transmittance<vec3f(1.0e-7))){transmittance=vec3f(0.0);break;}
  }
  data.g=lastT;
  data.a=saturate(dot(transmittance,vec3f(0.2126,0.7152,0.0722)));
 }
 let at=vec2i(i32(face*hvShadow.info.z+id.x),i32(id.y));
 textureStore(hvBeerOut,at,beerCombine(textureLoad(hvBeerPrevious,at,0),data));
}
`,
)

/**
 * THE READ OF A MAP (BeerShadowMap_SampleTransmittance, HeterogeneousVolumesAdaptiveVolumetricShadowMapSampling.ush:767-888):
 * the transmittance of the volumes between a point and its light. The face is the cube face of the largest axis of the point
 * from the light (a local light) or the one orthographic face (a directional light); the four texels around the point are
 * read and interpolated bilinearly, each by the exponential fit at the point's distance. The program declares
 * beerFetch(s, face, coord) -> vec4f, a texel of the strip of the map s (`beerShadowReadWgsl.ts`).
 */
export const BEER_READ_WGSL = wgslBlock(
  'BEER_READ_WGSL',
  [HV_SHADOW, BEER_BASIS_WGSL, BEER_DATA_WGSL],
  `
fn hvBeerTransmittance(s:HvShadow,light:DirectLight,P:vec3f)->f32{
 if(s.info.z==0u){return 1.0;}
 var face=0u;
 if(s.info.y==0u&&s.info.x>1u){
  let d=P-light.positionRange.xyz;
  let a=abs(d);
  var axis=select(0u,1u,a.y>a.x);
  axis=select(axis,2u,a.z>select(a.x,a.y,axis==1u));
  face=axis*2u+select(0u,1u,d[axis]>0.0);
 }
 let b=beerBasis(s,light,face);
 var uv:vec2f;
 var z:f32;
 if(s.info.y!=0u){
  let local=P-b.origin;
  uv=vec2f(0.5+0.5*dot(local,b.right)/s.sphere.w,0.5-0.5*dot(local,b.up)/s.sphere.w);
  z=dot(local,b.forward);
 }else{
  let d=P-b.origin;
  let depth=dot(d,b.forward);
  if(depth<=0.0){return 1.0;}
  uv=vec2f(0.5+0.5*dot(d,b.right)/depth,0.5-0.5*dot(d,b.up)/depth);
  z=length(d);
 }
 if(any(uv<=vec2f(0.0))||any(uv>=vec2f(1.0))){return 1.0;}
 let coord=uv*f32(s.info.z);
 let base=vec2i(coord);
 let w=fract(coord);
 let t00=beerInterpolate(beerFetch(s,face,base),z);
 let t10=beerInterpolate(beerFetch(s,face,base+vec2i(1,0)),z);
 let t01=beerInterpolate(beerFetch(s,face,base+vec2i(0,1)),z);
 let t11=beerInterpolate(beerFetch(s,face,base+vec2i(1,1)),z);
 return mix(mix(t00,t10,w.x),mix(t01,t11,w.x),w.y);
}
`,
)
