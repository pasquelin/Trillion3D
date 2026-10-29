import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import {
  computeStorageEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { RESERVOIR_BINDINGS, RESERVOIR_PAST_WGSL, RESERVOIR_WGSL } from './commonWgsl.ts'

const B = RESERVOIR_BINDINGS

/** The entry points of the resampling kernels. */
export const RESAMPLE_ENTRIES = {
  clear: 'reservoirClear',
  temporal: 'reservoirTemporal',
  spatial: 'reservoirSpatial',
} as const

/** The layout of the resampling kernels' group 0: the parameters at a dynamic offset, the blue noise, the two pools, the normals and the vectors. */
export const resampleEntries = () => [
  computeUniformEntry(B.params, { hasDynamicOffset: true }),
  computeTextureEntry(B.blue, 'float'),
  computeStorageEntry(B.poolA, true),
  computeStorageEntry(B.poolB, true),
  computeTextureEntry(B.normals, 'float'),
  computeTextureEntry(B.vectors, 'uint'),
]

/**
 * THE JACOBIAN of a neighbour's sample for the pixel in hand (`rsJacobian`): the ratio of the solid angles the hit subtends from the neighbour's point and from this one — the cosine at the hit over
 * the squared distance, new over old —, zero where it is not a number or lies outside a tenth to ten (the fireflies of extreme reweights); one for a ray that missed. The reference
 * tells a miss by a normal of zero, which a real normal can sum to; the sample says it hit.
 */
const JACOBIAN_WGSL = wgslBlock(
  'RESERVOIR_JACOBIAN_WGSL',
  [],
  `fn rsJacobian(receiver:vec3f,neighbour:vec3f,s:RsSample)->f32{
 if(s.hit<0.5){return 1.0;}
 let hitPoint=neighbour+s.dir*s.distance;
 let away=neighbour-hitPoint;
 let was=length(away);
 let wasCos=saturate(dot(s.normal,away/was));
 let toward=receiver-hitPoint;
 let now=length(toward);
 let nowCos=saturate(dot(s.normal,toward/now));
 var j=(nowCos*was*was)/(wasCos*now*now);
 if(!(j>=0.0&&j<1e30)){j=0.0;}
 if(j>10.0||j<0.1){j=0.0;}
 return j;
}`,
)

/** A march of the depth along a ray (`rsScreenCast`): the distance to the first hit of 'steps' steps from the start, or negative; the tolerance is the depth a step spans, twice, and the hit must lie inside the screen. */
const SCREEN_CAST_WGSL = wgslBlock(
  'RESERVOIR_SCREEN_CAST_WGSL',
  [],
  `/** The world length of half the screen's height at 'depth' (the tangent of half the vertical field times the depth under a perspective; the same everywhere under an orthographic projection, where the reference's multiplier is a unit that no longer scales with the screen): the occlusion trace's length is a fraction of it. */
fn rsScreenHeight(depth:f32)->f32{
 let halfHeight=reflectionView.slab.x*0.5*view.viewport.y;
 return select(halfHeight,halfHeight*depth,slabPerspective(reflectionView.slab));
}
fn rsScreenCast(origin:vec3f,dir:vec3f,len:f32,steps:i32,offset:f32)->f32{
 let a=reflectionView.viewProj*vec4f(origin,1.0);
 let b=reflectionView.viewProj*vec4f(origin+dir*len,1.0);
 if(a.w<=0.0||b.w<=0.0){return -1.0;}
 let sa=a.xyz/a.w;
 let sb=b.xyz/b.w;
 let dt=1.0/f32(steps);
 // The depth a move of 'len' along the view's axis spans: under a perspective the reciprocal depth's difference, under an orthographic projection the depth's gradient times the length (the gradient is the slab's depth scale over its pixel scale).
 let span=select(reflectionView.slab.z/reflectionView.slab.x*len,abs(reflectionView.slab.z/(a.w+len)-reflectionView.slab.z/a.w),slabPerspective(reflectionView.slab));
 let tolerance=span*dt*2.0;
 let size=view.viewport.xy;
 let startDepth=hizOpaqueDepth(vec2i(ndcToPixel(sa.xy,size)));
 var time=offset*dt+dt;
 var first=-1.0;
 for(var i=0;i<steps;i++){
  let at=sa+(sb-sa)*time;
  let pixel=ndcToPixel(at.xy,size);
  let inside=all(pixel>=vec2f(0.0))&&all(pixel<size);
  let sampled=select(0.0,hizOpaqueDepth(vec2i(pixel)),inside);
  let hit=inside&&abs(at.z-sampled+tolerance)<tolerance&&sampled!=startDepth;
  if(hit&&first<0.0){first=time;}
  time+=dt;
 }
 return select(-1.0,first*len,first>0.0);
}`,
)

const RESAMPLE_KERNELS_WGSL = `var<private> RS_NEIGHBOURS=array<vec2i,8>(vec2i(-1,-1),vec2i(1,1),vec2i(-1,1),vec2i(1,-1),vec2i(0,-1),vec2i(0,1),vec2i(-1,0),vec2i(1,0));
/** The reservoirs of a history that has none: the sample and weights gone, the surface kept (the first image, a camera cut, a reset). */
@compute @workgroup_size(8,8)
fn ${RESAMPLE_ENTRIES.clear}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=rs.size.xy)){return;}
 rsStore(rs.sets.y,id.xy,rsEmptyOf(rsLoad(rs.sets.x,id.xy)));
}
/** Each reservoir merged with one of the nine the last image holds round where its surface stood (itself, then the eight neighbours from a random start), the first on the same surface: the depth error and the angle under their thresholds. */
@compute @workgroup_size(8,8)
fn ${RESAMPLE_ENTRIES.temporal}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=rs.size.xy)){return;}
 let c=id.xy;
 var r=rsLoad(rs.sets.x,c);
 if(r.depth<=0.0){rsStore(rs.sets.y,c,rsEmptyOf(r));return;}
 let P=rsWorld(c,rs.size.w,r.depth);
 let S=vec2f(rsPixel(c,rs.size.w))+vec2f(0.5);
 let past=rsPast(P,S,rsDevice(r.depth));
 let size=reflectionView.radiance.xy;
 let onscreen=past.valid&&all(past.pixel>=vec2f(0.0))&&all(past.pixel<=size);
 let history=vec2u(clamp(past.pixel,vec2f(0.0),size-vec2f(1.0)))/rs.size.z;
 let previousDepth=reflectionLinearOfDevice(past.z);
 let normalZ=dot(r.surface,view.contact.xyz);
 let noise=blueNoiseScalar(c,rs.size.w);
 let start=u32(noise*9.0);
 if(onscreen&&rs.image.w!=0u){
  for(var i=0u;i<9u;i++){
   var offset=vec2i(0);
   if(i>0u){offset=RS_NEIGHBOURS[(start+i-1u)%8u];}
   let at=vec2u(clamp(vec2i(history)+offset,vec2i(0),vec2i(rs.size.xy)-vec2i(1)));
   var h=rsLoad(rs.sets.z,at);
   let depthError=abs(max(0.3,normalZ)*(previousDepth/h.depth-1.0));
   if(h.depth>0.0&&depthError<rs.threshold.x&&dot(r.surface,h.surface)>rs.threshold.y){
    h.s.radiance*=rs.exposure.y;
    h.s.pdf*=rs.exposure.y;
    h.m=min(h.m,20.0);
    // The reference's Jacobian of the temporal merge is off (it makes fireflies): the weight is the sample's density alone.
    rsMerge(&r,h,h.s.pdf,noise);
    break;
   }
  }
 }
 r.w=r.wSum/max(r.m*r.s.pdf,0.00001);
 rsStore(rs.sets.y,c,r);
}
/** One pass of the spatial resampling: each reservoir merges 'spatial.z' neighbours of a spiral round it, those on its surface (depth error and angle under their thresholds), each weighed by the Jacobian of its hit; when the merge would take the neighbour's sample, a short screen trace checks the neighbour's hit is not hidden from the pixel. */
@compute @workgroup_size(8,8)
fn ${RESAMPLE_ENTRIES.spatial}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=rs.size.xy)){return;}
 let c=id.xy;
 var r=rsLoad(rs.sets.x,c);
 if(r.depth<=0.0){rsStore(rs.sets.y,c,rsEmptyOf(r));return;}
 let P=rsWorld(c,rs.size.w,r.depth);
 let normalZ=dot(r.surface,view.contact.xyz);
 let noise=blueNoiseScalar(c,rs.size.w);
 let samples=u32(rs.spatial.z);
 for(var i=0u;i<samples;i++){
  let angle=(f32(i)+noise+0.3*rs.spatial.w)*2.3999632;
  let radius=pow(f32(i+1u),0.666)*rs.spatial.x/f32(samples);
  let offset=vec2i(floor(vec2f(cos(angle),sin(angle))*radius+vec2f(0.5)));
  let at=vec2u(clamp(vec2i(c)+offset,vec2i(0),vec2i(rs.size.xy)-vec2i(1)));
  let n=rsLoad(rs.sets.x,at);
  if(n.depth<=0.0){continue;}
  let depthError=abs(max(0.3,normalZ)*(r.depth/n.depth-1.0));
  if(depthError>=rs.threshold.x||dot(r.surface,n.surface)<=rs.threshold.y){continue;}
  let nP=rsWorld(at,rs.size.w,n.depth);
  let jacobian=rsJacobian(P,nP,n.s);
  let swap=blueNoiseScalar(c,rs.size.w*samples+i);
  var visible=true;
  if(rs.spatial.y>0.0&&jacobian>0.0&&rsWill(r,n,n.s.pdf*jacobian,swap)){
   let hitPoint=nP+n.s.dir*n.s.distance;
   let len=rs.spatial.y*rsScreenHeight(r.depth);
   visible=rsScreenCast(P,normalize(hitPoint-P),len,8,noise-0.5)<0.0;
  }
  if(visible){rsMerge(&r,n,n.s.pdf*jacobian,swap);}
 }
 r.w=r.wSum/max(r.m*r.s.pdf,0.00001);
 rsStore(rs.sets.y,c,r);
}`

/** The program of the resampling kernels: clearing, temporal resampling and one spatial pass. */
export const resampleProgram = () =>
  wgslProgram(RESAMPLE_KERNELS_WGSL, [
    RESERVOIR_WGSL,
    RESERVOIR_PAST_WGSL,
    JACOBIAN_WGSL,
    SCREEN_CAST_WGSL,
  ])
