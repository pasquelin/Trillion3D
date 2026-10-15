import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_ANGLE } from '../../../math/src/wgsl/constants.ts'
import { slabPerspective } from '../../../math/src/wgsl/projection.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { GGX_DISTRIBUTION_WGSL } from '../lighting/standardLighting.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_LAYER_WGSL, REFLECTION_TRACE_BINDINGS as B } from './traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'

/**
 * THE SPATIAL REUSE of a surface's fresh grid (`spatialSurface`), between the trace and the temporal
 * accumulation, the same for every pixel: a pixel averages its own ray with those of up to
 * `REFLECTION_REUSE_TAPS` neighbours on a disc (a Vogel spiral turned by the golden angle every image),
 * each ray weighed by what it brings to the pixel's own lobe — its BRDF over the pdf it was drawn with
 * (`reflectionReuseWeight`) — and by how surely it left the same surface (`reflectionSameSurface`, on
 * both pixels' depth and normal). The texel keeps its own word — its hit —, which the accumulation reads.
 *
 * WEIGHT (`reflectionReuseWeight`): a neighbour's ray left `Q` along `d`, drawn from its own lobe with
 * pdf p(d) = D(h)·(n·h) / (4 v·h); seen from the pixel, the point it met — at the nearer of the two rays'
 * distances, so a neighbour's far answer never stands for the pixel's near one — lies along `L`, which
 * the pixel's lobe weighs D(h′), h′ = (V + L)/|V + L|. The ratio D(h′)/p(d) makes the neighbours' rays
 * samples of the pixel's lobe, whatever their normals — a normal map's tilt, a curved surface — and the
 * pixel's own ray weighs 4 v·h / n·h. The coat's radiance is averaged with the base's weights.
 *
 * HOW FAR (`reflectionReuseReach`): a neighbour `n` pixels away casts its lobe from a point and along a
 * direction of its own; the two lobes part, at the distance `t` of what they meet, by the pixels'
 * footprint carried that far, `n·(w + t·a)` — `w` the world size of a pixel at the surface
 * (`reflectionPixelAt`), `a` the angle a pixel spans (`ReflectionView.slab.x` under a perspective, none
 * under an orthographic projection) —, while the lobe is `t·tan θ` wide there
 * (`reflectionConeTangent`). A neighbour is kept while that parting stays within the lobe's width,
 * `n ≤ t·tan θ / (w + t·a)` at the nearer hit, `REFLECTION_REUSE_RADIUS` pixels at most: a mirror's
 * disc is under a pixel, and it keeps its own ray alone — the same rule, no case of its own.
 *
 * OUTLIERS: each ray, the pixel's own and every neighbour's, is held to the fresh texels around the
 * pixel (`reflectionBounds`, a variance clamp in a perceptual space) before the mean: one sample of a
 * headlight in a lobe's tail is a firefly. The rule is the same on every image, moving or still.
 */
export const REFLECTION_SPATIAL_WGSL = wgslBlock(
  'REFLECTION_SPATIAL_WGSL',
  [
    REFLECTION_LAYER_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_CONE_WGSL,
    LOBE_AXIS_WGSL,
    GGX_DISTRIBUTION_WGSL,
    slabPerspective,
    GOLDEN_ANGLE,
    clampToExtent,
  ],
  `@group(0) @binding(${B.spatialIn}) var spatialIn:texture_2d<u32>;
@group(0) @binding(${B.raysIn}) var raysIn:texture_2d<u32>;
@group(0) @binding(${B.spatialOut}) var spatialOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
fn reflectionReuseReach(P:vec3f,alpha:f32,hit:f32)->f32{
 let angle=select(0.0,reflectionView.slab.x,slabPerspective(reflectionView.slab));
 return hit*reflectionConeTangent(alpha)/(reflectionPixelAt(P)+hit*angle);
}
fn reflectionLobeDensity(N:vec3f,h:vec3f,a2:f32)->f32{
 let x=cross(N,h);
 return ggxDistribution(a2,max(dot(N,h),0.0),dot(x,x));
}
fn reflectionReuseWeight(own:ReflectingPixel,a2:f32,Q:vec3f,Nq:vec3f,q2:f32,d:vec3f,t:f32)->f32{
 let toward=Q+d*t-own.P;
 let L=select(d,normalize(toward),dot(toward,toward)>1e-12);
 let hq=normalize(viewToEye(Q)+d);
 let pdf=reflectionLobeDensity(Nq,hq,q2)*max(dot(Nq,hq),0.0)/(4.0*max(dot(viewToEye(Q),hq),1e-4));
 return reflectionLobeDensity(own.N,normalize(own.V+L),a2)/max(pdf,1e-30);
}
fn spatialTexel(at:vec2i,layer:u32)->vec4u{
 let centre=textureLoad(spatialIn,at,0);
 if(!freshValid(centre)){return centre;}
 let bounds=reflectionBounds(spatialIn,at);
 let mine=reflectionClamped(texelReflected(centre),bounds);
 let own=reflectingPixelAt(layer,at,0u);
 let alpha=lobeAlpha(own.rough);
 let hit=freshHit(centre);
 let radius=min(reflectionReuseReach(own.P,alpha,hit),f32(REFLECTION_REUSE_RADIUS));
 if(radius<1.0){return vec4u(texelRadiance(mine),centre.w);}
 let a2=alpha*alpha;
 let first=reflectionReuseWeight(own,a2,own.P,own.N,a2,rayDirection(textureLoad(raysIn,at,0).r),hit);
 let depth=surfaceLinearDepth(own.P);
 let size=vec2i(textureDimensions(spatialIn));
 let turn=f32(reflectionView.temporal.x)*GOLDEN_ANGLE;
 var sum=Reflected(first*mine.base,first*mine.coat);
 var total=first;
 for(var k=0u;k<REFLECTION_REUSE_TAPS;k++){
  let a=turn+f32(k)*GOLDEN_ANGLE;
  let reach=radius*sqrt((f32(k)+0.5)/f32(REFLECTION_REUSE_TAPS));
  let tap=clampToExtent(at+vec2i(round(reach*vec2f(cos(a),sin(a)))),size);
  if(all(tap==at)){continue;}
  let t=textureLoad(spatialIn,tap,0);
  if(!freshValid(t)){continue;}
  let apart=distance(vec2f(tap),vec2f(at));
  let near=min(hit,freshHit(t));
  if(apart>reflectionReuseReach(own.P,alpha,near)){continue;}
  let Q=surfacePointAt(layer,tap);
  let normal=surfaceNormalAt(tap);
  let Nq=normalize(normal.xyz);
  let same=reflectionSameSurface(depth,own.N,own.V,surfaceLinearDepth(Q),Nq,apart);
  if(same<=0.0){continue;}
  let q=lobeAlpha(normal.a);
  let d=rayDirection(textureLoad(raysIn,tap,0).r);
  let w=same*reflectionReuseWeight(own,a2,Q,Nq,q*q,d,near);
  if(!(w>0.0)){continue;}
  let r=reflectionClamped(texelReflected(t),bounds);
  sum.base+=w*r.base;sum.coat+=w*r.coat;
  total+=w;
 }
 return vec4u(texelRadiance(Reflected(sum.base/total,sum.coat/total)),centre.w);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn spatialSurface(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=textureDimensions(spatialOut))){return;}
 textureStore(spatialOut,id.xy,spatialTexel(vec2i(id.xy),REFLECTION_LAYER));
}`,
)
