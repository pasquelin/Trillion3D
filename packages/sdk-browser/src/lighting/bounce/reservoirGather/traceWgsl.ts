import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import {
  computeStorageEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { sceneTraceAvoidWgsl } from '../../rays/sceneTrace/avoidWgsl.ts'
import { sceneTraceLayoutEntries } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { surfaceHitCardsLayoutEntries } from '../../surfaceCache/hitWgsl.ts'
import { TRACE_TRACED_HIT, TRACE_TRACED_SCENE } from '../screen/traceTracedWgsl.ts'
import { tracedHitLightWgsl } from '../tracedHitWgsl.ts'
import { RESERVOIR_BINDINGS, RESERVOIR_WGSL } from './commonWgsl.ts'

const B = RESERVOIR_BINDINGS

/** The entry point of the ray kernel. */
export const RESERVOIR_TRACE_ENTRY = 'reservoirTrace'

/** The layout of the ray kernel's group 0: the parameters at a dynamic offset, the blue noise, the two pools, the normals, the cut's tables and the cards a hit reads (in the format `light`). */
export const reservoirTraceEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => [
  computeUniformEntry(B.params, { hasDynamicOffset: true }),
  computeTextureEntry(B.blue, 'float'),
  computeStorageEntry(B.poolA, true),
  computeStorageEntry(B.poolB, true),
  computeTextureEntry(B.normals, 'float'),
  ...dagReadLayoutEntries(),
  ...surfaceHitCardsLayoutEntries(TRACE_TRACED_HIT, light),
]
/** The layout of its scene trace group. */
export const reservoirTraceSceneEntries = () => sceneTraceLayoutEntries(TRACE_TRACED_SCENE.first)

/**
 * ONE RAY OF A RESERVOIR THROUGH THE SCENE'S TRIANGLES (`rsTrace`), the one text the first rays and the validation of the last image's share: the ray leaves the point moved off the surface along its
 * normal (the less the more the ray leans on it, a hundredth to five hundredths of a centimetre), avoiding the geometry it starts on as the setting says (`stTraceAvoiding`); a hit brings the light the
 * cards hold there, read over the footprint of the ray's cone (the eye's spread over the surface's depth, then the spread plus a turn over the hit's distance), a ray that leaves the scene the sky light,
 * and both the sky light that leaks at the distance reached; times the pre-exposure, held to the most a ray brings back. The hit's normal is turned toward the ray.
 */
const TRACE_RAY_WGSL = wgslBlock(
  'RESERVOIR_TRACE_RAY_WGSL',
  [],
  `/** The light the cards of the placement a hit met hold at its point, over the cone's footprint 'width' plus 'spread' times the distance (the reference's ray cone), as 'tracedHitLight' reads it over a share of the sphere: none for the back of a one-sided primitive or a hit nearer than the nearest that lights anything. */
fn rsHitLight(hit:StHit,origin:vec3f,d:vec3f,width:f32,spread:f32)->vec3f{
 let hitCm=hit.distance*f32(BOUNCE_CM);
 if((!hit.frontFace&&!hit.twoSided)||hitCm<rs.trace.y){return vec3f(0.0);}
 let placement=scPlacementMeshCards(scHitPlacement(hit.object));
 return scEvaluateMeshCards(placement,origin*f32(BOUNCE_CM)+d*hitCm,hit.normal,width+spread*hitCm,rs.trace.x,false,vec2u(0u)).radiance;
}
struct RsTrace{radiance:vec3f,distance:f32,normal:vec3f,hit:f32,}
fn rsTrace(P:vec3f,N:vec3f,d:vec3f,depth:f32)->RsTrace{
 let far=rs.exposure.w;
 let bias=mix(0.0005,0.0001,saturate(dot(N,d)));
 let origin=P+N*bias;
 let found=stTraceAvoiding(origin-view.display.yzw,d,0.0005,far,u32(rs.trace.z));
 var t:RsTrace;
 t.distance=far;
 t.normal=vec3f(0.0);
 t.hit=0.0;
 var radiance=vec3f(0.0);
 if(found.hit){
  t.hit=1.0;
  t.distance=found.distance;
  t.normal=select(-found.normal,found.normal,dot(found.normal,d)<0.0);
  let eye=reflectionView.eyeSpread;
  radiance=rsHitLight(found,origin,d,eye*depth*f32(BOUNCE_CM),eye+6.2831853);
 }else if(stComplete&&skyLightApplied()){
  radiance=skyLightReflection(d,0.0);
 }
 if(skyLightApplied()&&any(reflectionView.leak.xyz>vec3f(0.0))){
  radiance+=skyLightReflection(d,rs.leak.x)*reflectionView.leak.xyz*saturate(t.distance*rs.leak.y);
 }
 radiance*=rs.exposure.x;
 let most=max(radiance.x,max(radiance.y,radiance.z));
 if(most>rs.exposure.z){radiance*=rs.exposure.z/most;}
 t.radiance=radiance;
 return t;
}`,
)

/** The text of the ray kernel: the first rays of the reservoirs (mode 0) or the validation of the last image's (mode 1). */
const TRACE_KERNEL_WGSL = `@compute @workgroup_size(8,8)
fn ${RESERVOIR_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=rs.size.xy)){return;}
 let c=id.xy;
 if(rs.trace.w==0.0){
  let m=rsMaterial(rsPixel(c,rs.size.w));
  var r:RsReservoir;
  r.s=RsSample(vec3f(0.0),0.0,vec3f(0.0),0.0,vec3f(0.0),0.0);
  r.wSum=0.0;r.m=0.0;r.w=0.0;r.depth=0.0;r.surface=vec3f(0.0,0.0,1.0);
  if(m.valid){
   // A uniform direction of the hemisphere round the normal (the tangent basis of Frisvad), its density one over two pi.
   let e=blueNoiseVec2(c,rs.size.w);
   let phi=6.2831853*e.x;
   let st=sqrt(max(1.0-e.y*e.y,0.0));
   let local=vec3f(st*cos(phi),st*sin(phi),e.y);
   var tx=vec3f(0.0,-1.0,0.0);
   var ty=vec3f(-1.0,0.0,0.0);
   if(m.N.z>=-0.9999999){
    let a=1.0/(1.0+m.N.z);
    let b=-m.N.x*m.N.y*a;
    tx=vec3f(1.0-m.N.x*m.N.x*a,b,-m.N.x);
    ty=vec3f(b,1.0-m.N.y*m.N.y*a,-m.N.y);
   }
   let d=local.x*tx+local.y*ty+local.z*m.N;
   let t=rsTrace(m.P,m.N,d,m.depth);
   let aim=rsLuma(t.radiance);
   let pdf=0.15915494;
   r.s=RsSample(d,aim,t.radiance,t.distance,t.normal,t.hit);
   r.wSum=aim/pdf;
   r.m=1.0;
   r.w=r.wSum/max(r.m*aim,0.00001);
   r.depth=m.depth;
   r.surface=m.N;
  }
  rsStore(rs.sets.y,c,r);
 }else{
  var h=rsLoad(rs.sets.z,c);
  if(h.depth<=0.0){return;}
  // Where the reservoir's surface stood in the last image: its texel and depth through the last view-projection's inverse.
  let hp=rsPixel(c,rs.image.z);
  let ndc=pixelToNdc(vec2f(hp)+vec2f(0.5),reflectionView.radiance.xy);
  let clip=rs.previousInverse*vec4f(ndc,rsDevice(h.depth),1.0);
  let t=rsTrace(clip.xyz/clip.w,h.surface,h.s.dir,h.depth);
  if(abs(t.distance-h.s.distance)/h.s.distance<1.0){
   // The same hit: the light is the new light, the weights fall with the light that went.
   let old=rsLuma(h.s.radiance*rs.exposure.y);
   let now=rsLuma(t.radiance);
   h.s.radiance=t.radiance/rs.exposure.y;
   h.m*=clamp(old/max(now,1e-6),0.03,1.0);
   h.w*=clamp(old/max(now,1e-6)*10.0,0.01,1.0);
  }else{
   h.wSum=0.0;h.m=0.0;h.w=0.0;
  }
  rsStore(rs.sets.z,c,h);
 }
}`

/** The program of the ray kernel, the cards read in the format `light`. */
export const reservoirTraceProgram = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) =>
  wgslProgram(TRACE_KERNEL_WGSL, [
    RESERVOIR_WGSL,
    sceneTraceAvoidWgsl(TRACE_TRACED_SCENE.group, TRACE_TRACED_SCENE.first),
    tracedHitLightWgsl(TRACE_TRACED_HIT, TRACE_TRACED_SCENE, light),
    TRACE_RAY_WGSL,
  ])
