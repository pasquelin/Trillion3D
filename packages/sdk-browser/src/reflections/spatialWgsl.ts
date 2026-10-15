import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GOLDEN_ANGLE } from '../../../math/src/wgsl/constants.ts'
import { slabPerspective } from '../../../math/src/wgsl/projection.ts'
import { clampToExtent } from '../../../math/src/wgsl/sampling.ts'
import { LOBE_AXIS_WGSL } from '../lighting/lobeAxisWgsl.ts'
import { HALF_FORMAT } from './halfTexture.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_LAYER_WGSL, REFLECTION_TRACE_BINDINGS as B } from './halfBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'

/**
 * THE SPATIAL REUSE of a surface's fresh half grid (`spatialSurface`), between the trace and the
 * temporal accumulation: a texel averages its ray with those of up to `REFLECTION_REUSE_TAPS`
 * neighbours on a disc of its reuse radius (`freshRadius`, a Vogel spiral turned by the golden angle
 * every image), each weighed by how surely it traced the same surface (`reflectionSameSurface`, on the
 * depth and normal of the pixels both traced). Neighbours on one surface see one lobe from nearly one
 * point: their rays are that lobe's samples, and the texel gains their count. The texel keeps its own
 * word — its hit, its pick, its radius —, which the accumulation reads.
 *
 * HOW FAR (`reflectionReuseReach`): a neighbour `n` pixels away casts its lobe from a point and along a
 * direction of its own; the two lobes part, at the distance `t` of what they meet, by the pixels'
 * footprint carried that far, `n·(w + t·a)` — `w` the world size of a pixel at the surface
 * (`reflectionPixelAt`), `a` the angle a pixel spans (`ReflectionView.slab.x` under a perspective, none
 * under an orthographic projection), the rays of neighbouring pixels leaving the eye's mirror image —,
 * while the lobe is `t·tan θ` wide there (`reflectionConeTangent`). A neighbour's ray is a sample of the
 * texel's lobe while that parting stays within the lobe's width: `n ≤ t·tan θ / (w + t·a)`, at the
 * nearer of the two rays' hits. A reflection that meets something close is sharp, and its rays are
 * shared over a pixel or none; one that meets the far scene is as wide as its lobe's angle, and shares
 * over `REFLECTION_REUSE_RADIUS` texels. While anything changes the history holds a dozen images, not
 * `REFLECTION_STILL`: the reach is `REFLECTION_SHORT_REACH` times longer and each ray weighs by its
 * robust weight (`reflectionRobustWeight`), so one bright sample never lights a texel's block alone;
 * a still view's images share at the lobe's own reach, plainly, their mean the lobe's. The trace sizes the disc by its own hit (`traceHalf.ts`); each
 * neighbour is kept within the reach of the nearer hit.
 */
export const REFLECTION_SPATIAL_WGSL = wgslBlock(
  'REFLECTION_SPATIAL_WGSL',
  [
    REFLECTION_LAYER_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_CONE_WGSL,
    LOBE_AXIS_WGSL,
    slabPerspective,
    GOLDEN_ANGLE,
    clampToExtent,
  ],
  `@group(0) @binding(${B.spatialIn}) var spatialIn:texture_2d<u32>;
@group(0) @binding(${B.spatialOut}) var spatialOut:texture_storage_2d<${HALF_FORMAT},write>;
fn reflectionReuseReach(P:vec3f,alpha:f32,hit:f32)->f32{
 let angle=select(0.0,reflectionView.slab.x,slabPerspective(reflectionView.slab));
 let short=select(1.0,REFLECTION_SHORT_REACH,reflectionView.temporal.y==0u);
 return short*hit*reflectionConeTangent(alpha)/(reflectionPixelAt(P)+hit*angle);
}
fn spatialTexel(at:vec2i,layer:u32)->vec4u{
 let centre=textureLoad(spatialIn,at,0);
 let radius=freshRadius(centre);
 if(!freshValid(centre)||radius==0u){return centre;}
 let coord=halfPixel(at,freshPick(centre));
 let pixel=reflectingPixelAt(layer,coord,0u);
 let P=pixel.P;let N=pixel.N;let V=pixel.V;
 let alpha=lobeAlpha(pixel.rough);
 let hit=freshHit(centre);
 let depth=surfaceLinearDepth(P);
 let size=vec2i(textureDimensions(spatialIn));
 let turn=f32(reflectionView.temporal.x)*GOLDEN_ANGLE;
 // While anything changes, each ray weighs by its robust weight (\`reflectionRobustWeight\`).
 let robust=reflectionView.temporal.y==0u;
 let own=texelReflected(centre);
 let first=select(1.0,reflectionRobustWeight(own),robust);
 var sum=Reflected(first*own.base,first*own.coat);
 var total=first;
 for(var k=0u;k<REFLECTION_REUSE_TAPS;k++){
  let a=turn+f32(k)*GOLDEN_ANGLE;
  let reach=f32(radius)*sqrt((f32(k)+0.5)/f32(REFLECTION_REUSE_TAPS));
  let tap=clampToExtent(at+vec2i(round(reach*vec2f(cos(a),sin(a)))),size);
  if(all(tap==at)){continue;}
  let t=textureLoad(spatialIn,tap,0);
  if(!freshValid(t)){continue;}
  let s=halfPixel(tap,freshPick(t));
  let apart=distance(vec2f(s),vec2f(coord));
  if(apart>reflectionReuseReach(P,alpha,min(hit,freshHit(t)))){continue;}
  let other=surfaceLinearDepth(surfacePointAt(layer,s));
  let r=texelReflected(t);
  let w=reflectionSameSurface(depth,N,V,other,normalize(surfaceNormalAt(s).xyz),apart)
   *select(1.0,reflectionRobustWeight(r),robust);
  if(w<=0.0){continue;}
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
