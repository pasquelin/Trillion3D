import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  hammersley16,
  rand3dPcg16,
  uniformDiskConcentric,
} from '../../../../math/src/wgsl/sampling.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { ndcToPixel } from '../../../../math/src/wgsl/projection.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { REFLECTION_FRAME_WGSL } from './sampleWgsl.ts'
import { REFLECTION_TOP_LOBE_WGSL } from './weight.ts'
import { REFLECTION_GRID_FORMAT } from './grids.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { REFLECTION_PIXEL_TRACES_WGSL } from './reach.ts'
import {
  REFLECTION_LAYER_WGSL,
  REFLECTION_TILES_WGSL,
  REFLECTION_TRACE_BINDINGS as B,
} from './trace/traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'

/**
 * THE REUSE'S RULES: the disc a pixel reads its neighbours on, the resolve's and the last pass's
 * (`bilateralWgsl.ts`): `taps` stratified points (`hammersley16`) scrambled by a seed of the pixel and the image's turn modulo eight
 * (`reflectionReuseSeed`, `rand3dPcg16`), mapped onto the disc (`uniformDiskConcentric`,
 * `reflectionReuseTap`).
 *
 * WEIGHT (`reflectionReuseWeight`): a neighbour's ray left `Q` along `d`, drawn among its lobe's visible
 * normals (`visibleGgxHalf`, bounded), whose half vector has the pdf p = 2 (V·h) D(h) / (k n·v + |v̂|) (`reflectionHalfPdf`,
 * anisotropic where the lobe is: D the anisotropic distribution, |v̂| the view's length stretched by the widths) and the ray it
 * gives, mirrored about it, the pdf p / (4 V·h) (`reflectionRayPdf`), whose inverse is the ray's cone (`reflectionRayCone`, held between 10⁻⁵ and 10⁴), which the screen stage stores with the
 * ray's direction, in a half-float texel (`surfaceDirections`), and its surface's depth beside it (the ray texture's layer); seen from the
 * pixel, the point it met — at the nearer of the two rays' distances, so a neighbour's far answer never
 * stands for the pixel's near one — lies along `L`, which the pixel's lobe weighs D(h′),
 * h′ = (V + L)/|V + L|: the ratio D(h′) over the ray's pdf, the pixel's BRDF over the ray's pdf (ratio-estimator
 * reuse, Stachowiak 2015), makes the neighbours' rays samples of the pixel's lobe, whatever their
 * normals. The pixel's own ray weighs the same way along its own direction (`reflectionRayWeight`).
 */
export const REFLECTION_REUSE_WGSL = wgslBlock(
  'REFLECTION_REUSE_WGSL',
  [
    REFLECTION_SURFACES_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_FRAME_WGSL,
    PI,
    rand3dPcg16,
    hammersley16,
    uniformDiskConcentric,
  ],
  `/** The seed of the disc at pixel \`p\` this image: the hash of the pixel and the frame index modulo eight. */
fn reflectionReuseSeed(p:vec2i)->vec2u{return rand3dPcg16(vec3i(p,i32(reflectionView.temporal.y))).xy;}
/** The \`k\`-th of \`taps\` taps of the disc of seed \`seed\`, over a radius of one. */
fn reflectionReuseTap(k:u32,taps:u32,seed:vec2u)->vec2f{return uniformDiskConcentric(hammersley16(k,taps,seed));}
/** The GGX distribution of the half vector \`h\` on the lobe of normal \`N\` laid on the frame \`f\`, its widths \`widths\` along the frame's
 *  tangent and across it (round where they are equal). */
fn reflectionLobeDensity(N:vec3f,f:ReflectionFrame,widths:vec2f,h:vec3f)->f32{
 let a2=widths.x*widths.y;
 let stretched=vec3f(widths.y*dot(h,f.T),widths.x*dot(h,f.B),a2*dot(h,N));
 let q=a2/dot(stretched,stretched);
 return a2*q*q/PI;
}
/** The pdf of the half vector \`h\` the screen stage drew from a lobe of normal \`N\` seen from \`V\`, laid on the frame \`f\` with the widths \`widths\`
 *  (along the frame's tangent, across): that of the visible normals, their cap bounded by the view's reflection (\`k\`),
 *  2 (V·h) D(h) / (k n·v + |v̂|), \`|v̂|\` the view's length in the frame stretched by the widths. */
fn reflectionHalfPdf(N:vec3f,V:vec3f,f:ReflectionFrame,widths:vec2f,h:vec3f)->f32{
 let nv=max(dot(N,V),1e-4);
 let a=saturate(min(widths.x,widths.y));
 let s=1.0+sqrt(max(1.0-nv*nv,0.0));
 let k=(s*s-a*a*s*s)/(s*s+a*a*nv*nv);
 let stretched=length(vec3f(dot(V,f.T)*widths.x,dot(V,f.B)*widths.y,nv));
 return 2.0*max(dot(V,h),0.0)*reflectionLobeDensity(N,f,widths,h)/(k*nv+stretched);
}
/** The pdf of the ray cast along \`d\` from a lobe of normal \`N\` seen from \`V\`, laid on the axis \`axis\` (none for a round lobe) with the widths
 *  \`widths\` (along the axis, across): the pdf of the half vector it was drawn with (\`reflectionHalfPdf\`) carried over to the reflected ray,
 *  divided by 4 (V·h) (V·h held above a millionth). */
fn reflectionRayPdf(N:vec3f,V:vec3f,axis:vec3f,widths:vec2f,d:vec3f)->f32{
 let f=reflectionFrameOf(N,axis);
 let h=normalize(V+d);
 return reflectionHalfPdf(N,V,f,widths,h)/(4.0*max(saturate(dot(V,h)),1e-6));
}
/** The cone angle of a ray of that pdf: its inverse, the pdf held above a ten-thousandth, the angle above \`REFLECTION_MIN_CONE\`. */
fn reflectionRayCone(N:vec3f,V:vec3f,axis:vec3f,widths:vec2f,d:vec3f)->f32{
 return max(1.0/max(reflectionRayPdf(N,V,axis,widths,d),0.0001),REFLECTION_MIN_CONE);
}
/** The weight of a ray of pdf \`pdf\` that goes along \`L\` from the pixel of normal \`N\` seen from \`V\`, on its lobe laid on the frame \`f\`
 *  with the widths \`widths\`. */
fn reflectionRayWeight(N:vec3f,V:vec3f,f:ReflectionFrame,widths:vec2f,L:vec3f,pdf:f32)->f32{
 return reflectionLobeDensity(N,f,widths,normalize(V+L))/pdf;
}
/** The weight of a ray of pdf \`pdf\` that left \`Q\` along \`d\` and met something at \`t\`, on the lobe laid on the frame \`f\` with the widths
 *  \`widths\` of the pixel at \`P\` of normal \`N\` seen from \`V\`. */
fn reflectionReuseWeight(P:vec3f,N:vec3f,V:vec3f,f:ReflectionFrame,widths:vec2f,Q:vec3f,d:vec3f,t:f32,pdf:f32)->f32{
 let toward=Q+d*t-P;
 return reflectionRayWeight(N,V,f,widths,select(d,normalize(toward),dot(toward,toward)>1e-12),pdf);
}`,
)

/**
 * THE RESOLVE of a surface (`resolveSurface`), a thread a pixel of a resolve tile (`tiles.ts`): every
 * pixel whose
 * lobe traces resolves its own reflection from the rays around it, into the resolved pixels the
 * accumulation and the last pass read (`resolvedOut`), the hit's distance beside it.
 *
 * - CENTRE (2 × 2): the four grid texels whose blocks surround the pixel, each whose picked pixel
 *   traced weighed by how near that pixel lies, (b − |dx|)(b − |dy|) for blocks of `b` pixels a side,
 *   normalised; the hit and the ray of the nearest stand for the centre. The jitter pixel of its block reads its own
 *   ray whole — every pixel's, of a block of one, which reads that texel alone —; the others reconstruct it from their
 *   neighbours' (the temporal accumulation's reconstructed samples, `temporalWgsl.ts`).
 *   CENTRE (2 × 1, the checkerboard): the jitter pixel of its block still reads its own texel whole; the others take a
 *   quarter of each of four texels, their own, the one beside it on the side of their column (left at an even column,
 *   right at an odd one), the one above and the one below, whose picked pixels lie one pixel from them.
 * - RECONSTRUCTION, past a mirror — a lobe rougher than `REFLECTION_MIRROR_ROUGHNESS`, whose radius, the blocks' mean
 *   side times the setting's radius times saturate(8 · roughness), is wider than a block's longer side —:
 *   the centre re-weighed by its own ray's weight on the pixel's lobe, at least
 *   10⁻³, then up to the level's samples of neighbours on the disc of that radius
 *   (`REFLECTION_REUSE_WGSL`), in pixels, each texel's ray weighed on the pixel's
 *   lobe — its point and pdf read beside its ray (`reflectionRayData`), two texels a tap beside its
 *   fresh one —, its hit held to the centre's, the nearest kept; the neighbours together weigh at least the level's
 *   share of the centre's weight, their mean scaled up to it where they weigh less. The lobe the rays are weighed on is the pixel's
 *   (`reflectionTopLobe`), its widths scaled by the roughness scale (`ReflectionView.reconstructionScale`); an anisotropic lobe
 *   stretches the disc along the screen image of its axes, to the radius times one plus or minus the anisotropy's strength (the blocks'
 *   longer side at least). A neighbour is the pixel plus the tap's offset and a half, cut to a whole number toward zero.
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
    REFLECTION_PIXEL_TRACES_WGSL,
    REFLECTION_REUSE_WGSL,
    REFLECTION_TOP_LOBE_WGSL,
    ndcToPixel,
    surfaceReflects,
  ],
  `@group(0) @binding(${B.freshIn}) var freshIn:texture_2d<u32>;
/** The world point a traced texel \`g\`'s ray left, from its pixel \`source\`, its direction and its pdf. */
struct ReflectionRayData{Q:vec3f,d:vec3f,pdf:f32,}
fn reflectionRayData(g:vec2i,source:vec2i)->ReflectionRayData{
 let depth=bitcast<f32>(textureLoad(surfaceRaysRead,g,REFLECTION_RAY_DEPTH,0).r);
 let ray=reflectionRayAt(g);
 return ReflectionRayData(worldAt(vec2f(source)+vec2f(0.5),depth),ray.xyz,reflectionPdfOfCone(ray.w));
}
@group(0) @binding(${B.resolvedOut}) var resolvedOut:texture_storage_2d<${REFLECTION_GRID_FORMAT},write>;
/** The grid texel offset of the \`k\`-th sample of a pixel at column \`x\` of the checkerboard (blocks of two pixels across and
 *  one down): its own texel, the one beside it on the side of its column, the one above and the one below. */
fn resolveCheckerStep(k:i32,x:i32)->vec2i{
 var steps=array<vec2i,4>(vec2i(0,0),vec2i(select(1,-1,x%2==0),0),vec2i(0,-1),vec2i(0,1));
 return steps[k];
}
/** The weight of the centre in the reconstruction: the weight of the ray of its nearest texel \`centreTexel\` on the pixel's lobe, at least 10⁻³; just 10⁻³
 *  where no texel centred the pixel (\`centred\` false), its lighting zero: no texel's ray stands for it, and the ray of whatever texel lies at the
 *  pixel's own coordinates in the grid is none of the pixel's. */
fn resolveCentreWeight(centred:bool,centreTexel:vec2i,N:vec3f,V:vec3f,frame:ReflectionFrame,widths:vec2f)->f32{
 if(!centred){return 1e-3;}
 let ray=reflectionRayAt(centreTexel);
 return max(reflectionRayWeight(N,V,frame,widths,ray.xyz,reflectionPdfOfCone(ray.w)),1e-3);
}
fn resolvePixel(coord:vec2i,layer:u32)->vec4u{
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return vec4u(0u);}
 if(!reflectionPixelTraces(coord,flags)){return vec4u(0u);}
 let top=surfaceTopAt(coord,flags);
 let alpha=lobeAlpha(top.w);
 let size=vec2i(reflectionGridSize());
 // A block of one pixel: the pixel's own texel alone (the other three are a pixel away, weighing nothing).
 let single=all(reflectionBlock()==vec2u(1u));
 // A block of two pixels across and one down: the pixel's own texel and three round it.
 let checker=reflectionBlock().y==1u&&reflectionBlock().x>1u;
 let p=select(max(coord,vec2i(1)),coord,single||checker);
 let block=vec2f(reflectionBlock());
 let first=select((p-vec2i(1))/vec2i(reflectionBlock()),coord/vec2i(reflectionBlock()),checker);
 // In the checkerboard, a pixel that is not its block's jitter pixel takes its four texels at a quarter each.
 let borrowed=checker&&(u32(coord.x)%reflectionBlock().x)!=reflectionJitter(vec2u(first)).x;
 var sum=vec3f(0.0);
 var total=0.0;
 var best=0.0;
 var centreTexel=vec2i(0);
 var hit=REFLECTION_MISS_DISTANCE;
 for(var k=select(0,3,single);k<4;k++){
  let g=first+select(vec2i(k&1,k>>1u),resolveCheckerStep(k,coord.x),checker);
  if(any(g<vec2i(0))||any(g>=size)){continue;}
  let w=reflectionRayWord(vec2u(g));
  if(!reflectionWordTraces(w)){continue;}
  let traced=vec2i(reflectionTracedOf(vec2u(g),w));
  let d=abs(vec2f(traced-p));
  var weight=(block.x-d.x)*(block.y-d.y);
  if(checker){weight=select(select(0.0,1.0,k==0),0.25,borrowed);}
  if(weight<=0.0){continue;}
  let t=textureLoad(freshIn,g,0).xy;
  sum+=weight*reflectionDenoised(texelRadiance(t));
  total+=weight;
  if(weight>best){best=weight;centreTexel=g;hit=freshHit(t);}
 }
 // No centre: its lighting zero, its hit the farthest.
 let centred=best>0.01;
 var lighting=vec3f(0.0);
 if(centred){lighting=sum/total;}
 // The reconstruction's radius: past a mirror, the block's mean side times the setting's radius, widening with the
 // roughness of the lobe it traces up to an eighth of one.
 var radius=0.0;
 if(top.w>REFLECTION_MIRROR_ROUGHNESS){radius=0.5*(block.x+block.y)*reflectionView.spread.x*saturate(top.w*8.0);}
 if(reflectionDone(REFLECTION_RECONSTRUCTION)&&radius>f32(max(reflectionBlock().x,reflectionBlock().y))){
  let own=reflectingPixelAt(layer,coord,flags);
  let P=own.P;
  let V=own.V;
  // The lobe the neighbours' rays are weighed on: the pixel's, its widths scaled by the roughness scale, laid on the frame of its axis.
  let shape=reflectionTopLobe(own.top);
  let widths=vec2f(shape.lobe.w,shape.across)*(lobeAlpha(clamp(own.top*reflectionView.reconstructionScale,0.0,1.0))/alpha);
  let frame=reflectionFrameOf(own.topN,shape.lobe.xyz);
  // The disc of neighbours, round; for an anisotropic lobe stretched along the screen image of its axes, by the strength of the anisotropy.
  var major=vec2f(radius,0.0);
  var minor=vec2f(0.0,radius);
  let tangent=reflectionView.viewProj*vec4f(P+frame.T,1.0);
  let bitangent=reflectionView.viewProj*vec4f(P+frame.B,1.0);
  if(dot(shape.lobe.xyz,shape.lobe.xyz)>0.5&&tangent.w>0.0&&bitangent.w>0.0){
   let strength=(shape.lobe.w-shape.across)/(shape.lobe.w+shape.across);
   let least=f32(max(reflectionBlock().x,reflectionBlock().y));
   let centre=vec2f(coord)+vec2f(0.5);
   let viewport=vec2f(reflectionViewport());
   major=max(radius*(1.0+strength),least)*normalize(ndcToPixel(tangent.xy/tangent.w,viewport)-centre);
   minor=max(radius*(1.0-strength),least)*normalize(ndcToPixel(bitangent.xy/bitangent.w,viewport)-centre);
  }
  let near=hit;
  let weight=resolveCentreWeight(centred,centreTexel,own.topN,V,frame,widths);
  // The neighbours' rays alone, weighed together at least by the level's share of the pixel's own.
  var around=vec3f(0.0);
  var aroundTotal=0.0;
  let seed=reflectionReuseSeed(coord);
  for(var k=0u;k<reflectionView.taps.x;k++){
   let tap=reflectionReuseTap(k,reflectionView.taps.x,seed);
   // The neighbour's pixel: the offset added to the pixel, rounded by half and truncated toward zero.
   let n=vec2i(vec2f(coord)+tap.x*major+tap.y*minor+vec2f(0.5));
   let g=n/vec2i(reflectionBlock());
   if(any(g<vec2i(0))||any(g>=size)){continue;}
   let w=reflectionRayWord(vec2u(g));
   if(!reflectionWordTraces(w)){continue;}
   let source=vec2i(reflectionTracedOf(vec2u(g),w));
   let t=textureLoad(freshIn,g,0).xy;
   let reached=min(near,freshHit(t));
   let ray=reflectionRayData(g,source);
   let wn=reflectionReuseWeight(P,own.topN,V,frame,widths,ray.Q,ray.d,reached,ray.pdf);
   if(!(wn>1e-6)){continue;}
   around+=wn*reflectionDenoised(texelRadiance(t));
   aroundTotal+=wn;
   hit=min(hit,reached);
  }
  let least=reflectionView.spread.z*weight;
  if(aroundTotal>1e-6&&least>aroundTotal){
   around*=least/aroundTotal;
   aroundTotal=least;
  }
  lighting=(weight*lighting+around)/(weight+aroundTotal);
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
