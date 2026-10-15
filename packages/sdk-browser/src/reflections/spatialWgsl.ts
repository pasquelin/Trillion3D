import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_ANGLE } from '../../../math/src/wgsl/constants.ts'
import { slabPerspective } from '../../../math/src/wgsl/projection.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { GGX_DISTRIBUTION_WGSL } from '../lighting/standardLighting.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'

/**
 * THE SPATIAL REUSE of a surface's fresh grid (`spatialSurface`), between the trace and the temporal
 * accumulation, the same for every texel: a texel averages its own ray with those of up to
 * `REFLECTION_REUSE_TAPS` neighbours on a disc (a Vogel spiral turned by the golden angle every image),
 * each ray weighed by what it brings to the pixel's own lobe — its BRDF over the pdf it was drawn with
 * (`reflectionReuseWeight`) — and by how surely it left the same surface (`reflectionSameSurface`, on
 * both pixels' depth and normal). The texel keeps its own word — its hit —, which the accumulation reads.
 *
 * WEIGHT (`reflectionReuseWeight`): a neighbour's ray left `Q` along `d`, drawn among its lobe's visible
 * normals with pdf p(d) = D(h)·G₁(v) / (4 n·v) (`reflectionVisible`, Smith's G₁); seen from the pixel, the point it met — at the nearer of the two rays'
 * distances, so a neighbour's far answer never stands for the pixel's near one — lies along `L`, which
 * the pixel's lobe weighs D(h′), h′ = (V + L)/|V + L|. The ratio D(h′)/p(d) makes the neighbours' rays
 * samples of the pixel's lobe, whatever their normals — a normal map's tilt, a curved surface — and the
 * pixel's own ray weighs D(h)/p(d) the same way. The coat's radiance is averaged with the base's weights.
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
 * A grid texel stands for its block of `REFLECTION_TRACE_BLOCK`² pixels (`grids.ts`), traced from one of
 * its reflecting pixels every image (`reflectionTracedPixel`): every texel that reflects has its own
 * ray, and one whose block does not reflect has none and is left as the trace left it.
 *
 * The mean is taken in the denoiser's space (`reflectionDenoised`), the same on every image: a bright
 * sample weighs as the range, never a thousandfold, and no sample is held to its neighbours — a small
 * bright body, a lamp's head, keeps its own radiance where its rays found it.
 */
export const REFLECTION_SPATIAL_WGSL = wgslBlock(
  'REFLECTION_SPATIAL_WGSL',
  [
    REFLECTION_LAYER_WGSL,
    REFLECTION_TILES_WGSL,
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
fn reflectionVisible(nv:f32,a2:f32)->f32{return 2.0*nv/(nv+sqrt(a2+(1.0-a2)*nv*nv));}
fn reflectionReuseWeight(own:ReflectingPixel,a2:f32,Q:vec3f,Nq:vec3f,q2:f32,d:vec3f,t:f32)->f32{
 let toward=Q+d*t-own.P;
 let L=select(d,normalize(toward),dot(toward,toward)>1e-12);
 let Vq=viewToEye(Q);
 let nv=max(dot(Nq,Vq),1e-4);
 let pdf=reflectionLobeDensity(Nq,normalize(Vq+d),q2)*reflectionVisible(nv,q2)/(4.0*nv);
 return reflectionLobeDensity(own.N,normalize(own.V+L),a2)/max(pdf,1e-30);
}
fn spatialTexel(at:vec2i,layer:u32)->vec4u{
 let centre=textureLoad(spatialIn,at,0);
 if(!freshValid(centre)){return centre;}
 let mine=reflectionDenoised(texelReflected(centre));
 let pixel=vec2i(reflectionTracedPixel(vec2u(at)));
 let own=reflectingPixelAt(layer,pixel,0u);
 let alpha=lobeAlpha(own.rough);
 let hit=freshHit(centre);
 // The reach in pixels, the disc in grid texels: a texel a block of them.
 let radius=min(reflectionReuseReach(own.P,alpha,hit),f32(REFLECTION_REUSE_RADIUS))/f32(REFLECTION_TRACE_BLOCK);
 if(radius<1.0){return centre;}
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
  let source=vec2i(reflectionTracedPixel(vec2u(tap)));
  let apart=distance(vec2f(source),vec2f(pixel));
  let near=min(hit,freshHit(t));
  if(apart>reflectionReuseReach(own.P,alpha,near)){continue;}
  let Q=surfacePointAt(layer,source);
  let normal=surfaceNormalAt(source);
  let Nq=normalize(normal.xyz);
  let same=reflectionSameSurface(depth,own.N,own.V,surfaceLinearDepth(Q),Nq,apart);
  if(same<=0.0){continue;}
  let q=lobeAlpha(normal.a);
  let d=rayDirection(textureLoad(raysIn,tap,0).r);
  let w=same*reflectionReuseWeight(own,a2,Q,Nq,q*q,d,near);
  if(!(w>0.0)){continue;}
  let r=reflectionDenoised(texelReflected(t));
  sum.base+=w*r.base;sum.coat+=w*r.coat;
  total+=w;
 }
 return vec4u(texelRadiance(reflectionLinear(Reflected(sum.base/total,sum.coat/total))),centre.w);
}
@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn spatialSurface(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let id=reflectionTilePixel(tile,groups,local);
 if(any(id>=textureDimensions(spatialOut))){return;}
 textureStore(spatialOut,id,spatialTexel(vec2i(id),REFLECTION_LAYER));
}`,
)
