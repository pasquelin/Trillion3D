import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { slabPerspective } from '../../../math/src/wgsl/projection.ts'
import {
  hammersley16,
  rand3dPcg16,
  uniformDiskConcentric,
} from '../../../math/src/wgsl/sampling.ts'
import { surfaceReflects } from '../scene/surfaceModel.ts'
import { GGX_DISTRIBUTION_WGSL } from '../lighting/standardLighting.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'

/**
 * THE REUSE'S RULES: the disc a pixel reads its neighbours on, the resolve's and the last pass's
 * (`bilateralWgsl.ts`): `taps` stratified points (`hammersley16`) scrambled by a seed of the pixel and the image's turn modulo eight
 * (`reflectionReuseSeed`, `rand3dPcg16`), mapped onto the disc (`uniformDiskConcentric`,
 * `reflectionReuseTap`); and how far the resolve reaches (`reflectionReuseReach`).
 *
 * HOW FAR: a neighbour `n` pixels away casts its lobe from a point and along a direction of its own;
 * the two lobes part, at the distance `t` of what they meet, by the pixels' footprint carried that far,
 * `n·(w + t·a)` — `w` the world size of a pixel at the surface (`reflectionPixelAt`), `a` the angle a
 * pixel spans (`ReflectionView.slab.x` under a perspective, none under an orthographic projection) —,
 * while the lobe is `t·tan θ` wide there (`reflectionConeTangent`). A neighbour is kept while that
 * parting stays within the lobe's width, `n ≤ t·tan θ / (w + t·a)` at the nearer hit,
 * `REFLECTION_REUSE_RADIUS` pixels at most: a mirror's disc is under a pixel, and it keeps its own ray
 * alone — the same rule, no case of its own. What depends on the pixel alone is taken once
 * (`reflectionReachOf`), the hit a tap.
 *
 * WEIGHT (`reflectionReuseWeight`): a neighbour's ray left `Q` along `d`, drawn among its lobe's visible
 * normals with pdf p(d) = D(h)·G₁(v) / (4 n·v) (`reflectionRayPdf`, `reflectionVisible`, Smith's G₁),
 * which the screen stage stores beside the ray with its surface's depth (`rayDataOut`); seen from the
 * pixel, the point it met — at the nearer of the two rays' distances, so a neighbour's far answer never
 * stands for the pixel's near one — lies along `L`, which the pixel's lobe weighs D(h′),
 * h′ = (V + L)/|V + L|: the ratio D(h′)/p(d), the pixel's BRDF over the ray's pdf (ratio-estimator
 * reuse, Stachowiak 2015), makes the neighbours' rays samples of the pixel's lobe, whatever their
 * normals.
 */
export const REFLECTION_REUSE_WGSL = wgslBlock(
  'REFLECTION_REUSE_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_CONE_WGSL,
    GGX_DISTRIBUTION_WGSL,
    slabPerspective,
    rand3dPcg16,
    hammersley16,
    uniformDiskConcentric,
  ],
  `/** The seed of the disc at pixel \`p\` this image: the hash of the pixel and the image's turn modulo eight. */
fn reflectionReuseSeed(p:vec2i)->vec2u{return rand3dPcg16(vec3i(p,i32(reflectionView.temporal.x%8u))).xy;}
/** The \`k\`-th of \`taps\` taps of the disc of seed \`seed\`, over a radius of one. */
fn reflectionReuseTap(k:u32,taps:u32,seed:vec2u)->vec2f{return uniformDiskConcentric(hammersley16(k,taps,seed));}
/** What a pixel's reach reads of it alone: its lobe's tangent, its pixel's world size, the angle a
 *  pixel spans. */
struct ReflectionReach{tangent:f32,pixel:f32,angle:f32,}
fn reflectionReachOf(P:vec3f,alpha:f32)->ReflectionReach{
 let angle=select(0.0,reflectionView.slab.x,slabPerspective(reflectionView.slab));
 return ReflectionReach(reflectionConeTangent(alpha),reflectionPixelAt(P),angle);
}
fn reflectionReuseReach(r:ReflectionReach,hit:f32)->f32{return hit*r.tangent/(r.pixel+hit*r.angle);}
fn reflectionLobeDensity(N:vec3f,h:vec3f,a2:f32)->f32{
 let x=cross(N,h);
 return ggxDistribution(a2,max(dot(N,h),0.0),dot(x,x));
}
fn reflectionVisible(nv:f32,a2:f32)->f32{return 2.0*nv/(nv+sqrt(a2+(1.0-a2)*nv*nv));}
/** The pdf of a ray cast along \`d\` from a lobe of α² \`q2\` and normal \`Nq\` seen from \`Vq\`: the screen
 *  stage's, stored beside its ray (\`rayDataOut\`). */
fn reflectionRayPdf(Nq:vec3f,Vq:vec3f,q2:f32,d:vec3f)->f32{
 let nv=max(dot(Nq,Vq),1e-4);
 return reflectionLobeDensity(Nq,normalize(Vq+d),q2)*reflectionVisible(nv,q2)/(4.0*nv);
}
/** The weight of a ray of pdf \`pdf\` that left \`Q\` along \`d\` and met something at \`t\`, on the lobe
 *  of α² \`a2\` and normal \`N\` of the pixel at \`P\` seen from \`V\`. */
fn reflectionReuseWeight(P:vec3f,N:vec3f,V:vec3f,a2:f32,Q:vec3f,d:vec3f,t:f32,pdf:f32)->f32{
 let toward=Q+d*t-P;
 let L=select(d,normalize(toward),dot(toward,toward)>1e-12);
 return reflectionLobeDensity(N,normalize(V+L),a2)/max(pdf,1e-30);
}`,
)

/**
 * THE RESOLVE of a surface (`resolveSurface`), a thread a pixel of a resolve tile (`tiles.ts`): every
 * pixel whose
 * lobe traces resolves its own reflection from the rays around it, into the resolved pixels the
 * accumulation and the last pass read (`resolvedOut`), the hit's distance beside it.
 *
 * - CENTRE (2 × 2): the four grid texels whose blocks surround the pixel, each whose picked pixel
 *   traced weighed by how near that pixel lies, (2 − |dx|)(2 − |dy|), normalised; the hit and the ray
 *   of the nearest stand for the centre. The jitter pixel of its block reads its own
 *   ray whole; the three others reconstruct it from their neighbours' (the temporal accumulation's
 *   reconstructed samples, `temporalWgsl.ts`).
 * - RECONSTRUCTION, past a mirror — a reach wider than a block, where the centre's texels alone no
 *   longer cover the lobe —: the centre re-weighed by its ray's weight on the pixel's lobe, at least
 *   10⁻³, then up to `REFLECTION_REUSE_TAPS` neighbours on the disc
 *   of the lobe's reach (`REFLECTION_REUSE_WGSL`), in pixels, each texel's ray weighed on the pixel's
 *   lobe — its point and pdf read beside its ray (`reflectionRayData`), two texels a tap beside its
 *   fresh one —, its hit held to the centre's, the nearest kept.
 *
 * The mean is taken in the denoiser's space (`reflectionDenoised`). A pixel that does not reflect, or
 * whose lobe traces nothing, resolves nothing (a zero texel, no lighting), and the last pass gives it
 * the field; one none of whose four texels traced resolves its neighbours' alone, a centre of no
 * lighting weighing 10⁻³ — black where none answered either, never a guess.
 */
export const REFLECTION_RESOLVE_WGSL = wgslBlock(
  'REFLECTION_RESOLVE_WGSL',
  [
    REFLECTION_LAYER_WGSL,
    REFLECTION_TILES_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_REACH_WGSL,
    REFLECTION_REUSE_WGSL,
    surfaceReflects,
  ],
  `@group(0) @binding(${B.freshIn}) var freshIn:texture_2d<u32>;
@group(0) @binding(${B.rayDataIn}) var rayDataIn:texture_2d<u32>;
/** The world point a traced texel \`g\`'s ray left, from its pixel \`source\`, and its pdf. */
struct ReflectionRayData{Q:vec3f,pdf:f32,}
fn reflectionRayData(g:vec2i,source:vec2i)->ReflectionRayData{
 let data=textureLoad(rayDataIn,g,0).xy;
 return ReflectionRayData(worldAt(vec2f(source)+vec2f(0.5),bitcast<f32>(data.x)),bitcast<f32>(data.y));
}
@group(0) @binding(${B.resolvedOut}) var resolvedOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
fn resolvePixel(coord:vec2i,layer:u32)->vec4u{
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return vec4u(0u);}
 let top=surfaceTopAt(coord,flags);
 let alpha=lobeAlpha(top.w);
 if(reflectionTraceShare(alpha)<=0.0){return vec4u(0u);}
 let P=surfacePointAt(layer,coord);
 let V=viewToEye(P);
 let size=vec2i(reflectionGridSize());
 let p=max(coord,vec2i(1));
 let first=(p-vec2i(1))/i32(REFLECTION_TRACE_BLOCK);
 var sum=vec3f(0.0);
 var total=0.0;
 var best=0.0;
 var centre=vec2i(-1);
 var centreTexel=vec2i(0);
 var word=0u;
 var hit=REFLECTION_FAR;
 for(var k=0;k<4;k++){
  let g=first+vec2i(k&1,k>>1u);
  if(any(g<vec2i(0))||any(g>=size)){continue;}
  let w=reflectionRayWord(vec2u(g));
  if(!reflectionWordTraces(w)){continue;}
  let traced=vec2i(reflectionTracedOf(vec2u(g),w));
  let d=abs(vec2f(traced-p));
  let weight=(2.0-d.x)*(2.0-d.y);
  if(weight<=0.0){continue;}
  let t=textureLoad(freshIn,g,0).xy;
  sum+=weight*reflectionDenoised(texelRadiance(t));
  total+=weight;
  if(weight>best){best=weight;centre=traced;centreTexel=g;word=w;hit=freshHit(t);}
 }
 // No centre: its lighting zero, its hit the farthest.
 let centred=best>0.01;
 var lighting=vec3f(0.0);
 if(centred){lighting=sum/total;}
 let reach=reflectionReachOf(P,alpha);
 let radius=min(reflectionReuseReach(reach,hit),f32(REFLECTION_REUSE_RADIUS));
 if(radius>f32(REFLECTION_TRACE_BLOCK)){
  let a2=alpha*alpha;
  let near=hit;
  var weight=1e-3;
  if(centred){
   let ray=reflectionRayData(centreTexel,centre);
   weight=max(reflectionReuseWeight(P,top.xyz,V,a2,ray.Q,rayDirection(word),near,ray.pdf),1e-3);
  }
  sum=weight*lighting;
  total=weight;
  let seed=reflectionReuseSeed(coord);
  for(var k=0u;k<REFLECTION_REUSE_TAPS;k++){
   let n=coord+vec2i(round(radius*reflectionReuseTap(k,REFLECTION_REUSE_TAPS,seed)));
   if(any(n<vec2i(0))){continue;}
   let g=n/i32(REFLECTION_TRACE_BLOCK);
   if(any(g>=size)){continue;}
   let w=reflectionRayWord(vec2u(g));
   if(!reflectionWordTraces(w)){continue;}
   let source=vec2i(reflectionTracedOf(vec2u(g),w));
   if(all(source==centre)){continue;}
   let t=textureLoad(freshIn,g,0).xy;
   let reached=min(near,freshHit(t));
   if(distance(vec2f(source),vec2f(coord))>reflectionReuseReach(reach,reached)){continue;}
   let ray=reflectionRayData(g,source);
   let wn=reflectionReuseWeight(P,top.xyz,V,a2,ray.Q,rayDirection(w),reached,ray.pdf);
   if(!(wn>1e-6)){continue;}
   sum+=wn*reflectionDenoised(texelRadiance(t));
   total+=wn;
   hit=min(hit,reached);
  }
  lighting=sum/total;
 }
 return freshPack(reflectionLinear(lighting),hit);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn resolveSurface(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 if(any(id>=reflectionViewport())){return;}
 textureStore(resolvedOut,id,resolvePixel(vec2i(id),REFLECTION_LAYER));
}`,
)
