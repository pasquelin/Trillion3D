import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { bilinear3 } from '../../../../../math/src/wgsl/sampling.ts'
import { irradianceShader } from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import {
  IRRADIANCE_PROBE_SIDE,
  SCREEN_PROBE_CONSTANTS,
} from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { spWeights } from './probesWgsl.ts'

/** Where the integration finds what it reads: the probes' pixels, each tile's adaptive probes (their count, their list), the
 *  probes' share of rays that move and their irradiance. */
export interface IntegrateBindings {
  pixels: number
  header: number
  indices: number
  moving: number
  irradiance: number
}

/** The probes a pixel reads: their atlas places, their weights (normalised) and whether any weighs. */
const SP_PICKED = wgslBlock(
  'SP_PICKED',
  [spWeights],
  `struct SpPicked{atlas:array<vec2u,4>,weights:vec4f,valid:bool,}
fn spCornerProbe(tile:vec2u)->SpProbe{return spReadProbe(tile);}
struct SpBest{place:vec2u,weight:vec2f,found:bool,}
/** A corner whose weight falls under the minimum takes the best adaptive probe of its tile where one is better. */
fn spAdaptiveCorner(tile:vec2u,pixel:vec2u,s:SpSurface,depth:f32,weight:f32)->SpBest{
 var best=SpBest(tile,vec2f(weight,0.0),false);
 let at=tile.y*sp.grid.x+tile.x;
 for(var listed=0u;listed<min(header[at],SP_SAMPLES);listed++){
  let probeIndex=sp.counts.y+indices[at*SP_SAMPLES+listed];
  let place=spAtlasOf(probeIndex);
  let word=probePixels[probeIndex];
  let found=spAdaptiveWeight(pixel,s.P,s.N,depth,vec2u(word&0xffffu,word>>16u),spReadProbe(place).P);
  if(found.x>best.weight.x){best=SpBest(place,found,true);}
 }
 return best;
}
fn spPickProbes(pixel:vec2u,offset:vec2f,s:SpSurface,depth:f32)->SpPicked{
 let found=spInterpolation(pixel,offset,s.P,s.N,depth);
 var weights=found.w;
 var fallback=found.fallback;
 var atlas=array<vec2u,4>(found.tile,found.tile+vec2u(1u,0u),found.tile+vec2u(0u,1u),found.tile+vec2u(1u,1u));
 for(var corner=0u;corner<4u;corner++){
  atlas[corner]=min(atlas[corner],sp.grid.xy-vec2u(1u));
  if(weights[corner]>=SP_MIN_WEIGHT){continue;}
  let best=spAdaptiveCorner(atlas[corner],pixel,s,depth,weights[corner]);
  if(best.found){weights[corner]=best.weight.x;fallback[corner]=best.weight.y;atlas[corner]=best.place;}
 }
 var valid=dot(weights,vec4f(1.0))>=SP_MIN_WEIGHT;
 if(!valid){
  weights=fallback;
  valid=dot(weights,vec4f(1.0))>=SP_MIN_WEIGHT;
 }
 weights=select(vec4f(0.0),weights/max(dot(weights,vec4f(1.0)),SP_MIN_WEIGHT),valid);
 if(spFlag(SP_FLAG_STOCHASTIC)&&valid){
  var draw=min(spNoise(pixel,sp.size.w).x,0.99)*dot(weights,vec4f(1.0));
  var picked=0u;
  for(var corner=0u;corner<3u;corner++){
   if(draw>=weights[corner]){draw-=weights[corner];picked=corner+1u;}else{break;}
  }
  let only=atlas[picked];
  return SpPicked(array<vec2u,4>(only,only,only,only),vec4f(1.0,0.0,0.0,0.0),true);
 }
 return SpPicked(atlas,weights,valid);
}`,
)

/** The irradiance of the probes picked at the normal \`N\`: their nine coefficients blended and evaluated once, or their octahedral maps read. */
const SP_PICKED_IRRADIANCE = wgslBlock(
  'SP_PICKED_IRRADIANCE',
  [SP_PICKED, bilinear3],
  `const SP_OCT_SIDE:u32=${IRRADIANCE_PROBE_SIDE}u;
/** The octahedral irradiance of probe \`atlas\` at the unit direction \`n\`: its texels read bilinearly. */
fn spOctahedralIrradiance(atlas:vec2u,n:vec3f)->vec3f{
 let border=SP_OCT_SIDE+2u;
 let p=vec2f(atlas*border)+equalAreaEncode(n)*f32(SP_OCT_SIDE)+vec2f(0.5);
 let base=vec2i(floor(p));
 let a=textureLoad(probeIrradiance,base,0).rgb;
 let b=textureLoad(probeIrradiance,base+vec2i(1,0),0).rgb;
 let c=textureLoad(probeIrradiance,base+vec2i(0,1),0).rgb;
 let e=textureLoad(probeIrradiance,base+vec2i(1,1),0).rgb;
 return bilinear3(a,b,c,e,p-floor(p));
}
/** The nine coefficients of probe \`atlas\`, each scaled by \`weight\`, added into \`sum\`. */
fn spAddCoefficients(sum:ptr<function,array<vec3f,9>>,atlas:vec2u,weight:f32){
 for(var k=0u;k<9u;k++){
  (*sum)[k]+=textureLoad(probeIrradiance,vec2i(vec2u(atlas.x*9u+k,atlas.y)),0).rgb*weight;
 }
}
fn spPickedIrradiance(picked:SpPicked,N:vec3f)->vec3f{
 var places=picked.atlas;
 var irradiance=vec3f(0.0);
 if(spFlag(SP_FLAG_OCTAHEDRAL)){
  for(var corner=0u;corner<4u;corner++){
   if(picked.weights[corner]>0.0){irradiance+=spOctahedralIrradiance(places[corner],N)*picked.weights[corner];}
  }
  return max(irradiance,vec3f(0.0));
 }
 var sum=array<vec3f,9>();
 for(var corner=0u;corner<4u;corner++){
  if(picked.weights[corner]>0.0){spAddCoefficients(&sum,places[corner],picked.weights[corner]);}
 }
 let coefficients=sum;
 return max(${irradianceShader((k) => `coefficients[${k}u]`, 'N')},vec3f(0.0));
}`,
)

/**
 * THE INTEGRATION: each pixel reads its irradiance from the probes round it (`spIntegrate`, the temporal pass calls it for the
 * pixel it blends). The probes it reads are the four uniform ones of the tile round it (`spInterpolation`, bilinear in the tile,
 * each by how near its plane the pixel lies), the point it reads them from moved by a jitter of a tile's side (the noise of the
 * pixel and the frame, `jitterWidth`, halved from five to ten units of depth; kept only where the jittered pixel lies on the
 * pixel's own plane): the probes' footprints blur into each other where the surface is continuous, never across an edge. A corner
 * whose weight falls under the minimum takes the best adaptive probe of its tile (`spAdaptiveWeight`) where one is better; the
 * weights are then normalised, those of a gentler plane where the first leave none, and a pixel with none reads nothing (its
 * alpha is zero: the temporal pass leans on its history). With the stochastic interpolation one probe of the four is drawn by
 * the pixel's noise, weighed whole. The alpha of a pixel that reads probes is the share of the light that moves (`probeMoving` of
 * the probes it reads, by their weights), a four-thousandth at least. The probe's light is its nine coefficients, interpolated
 * and evaluated once at the pixel's normal (`irradianceShader`), or its octahedral irradiance map, read bilinearly at it.
 */
export const spIntegrate = (at: IntegrateBindings) =>
  wgslBlock(
    `spIntegrate(${at.pixels}, ${at.header}, ${at.indices}, ${at.moving}, ${at.irradiance})`,
    [SP_PICKED_IRRADIANCE],
    `@group(0) @binding(${at.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${at.header}) var<storage,read> header:array<u32>;
@group(0) @binding(${at.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${at.moving}) var<storage,read> probeMoving:array<f32>;
@group(0) @binding(${at.irradiance}) var probeIrradiance:texture_2d<f32>;
const SP_JITTER_PLANE_SCALE:f32=${SCREEN_PROBE_CONSTANTS.jitterPlaneWeightScale};
/** The offset the pixel reads its probes from: the noise's jitter, kept where the jittered pixel is on the pixel's own plane. */
fn spJitterOffset(pixel:vec2u,s:SpSurface,depth:f32)->vec2f{
 if(sp.spatial.z<=0.0){return vec2f(0.0);}
 let width=sp.spatial.z*mix(1.0,0.5,saturate((depth-5.0)/5.0));
 let jitter=(spNoise(pixel,sp.size.w)*2.0-vec2f(1.0))*f32(sp.size.z)*width;
 let jittered=clamp(vec2f(pixel)+jitter,vec2f(0.0),vec2f(sp.size.xy)-vec2f(1.0));
 let other=spSurfaceAt(vec2u(floor(jittered)));
 let away=abs(dot(other.P,s.N)-dot(s.P,s.N))/depth;
 return select(vec2f(0.0),jitter,exp2(SP_JITTER_PLANE_SCALE*away*away)>SP_MIN_WEIGHT);
}
/** The irradiance of the lit pixel \`pixel\` (surface \`s\`) in \`rgb\` and the share of its light that moves in \`a\`, zero where no probe weighs. */
fn spIntegrate(pixel:vec2u,s:SpSurface)->vec4f{
 let depth=spDepthOf(s.P);
 let picked=spPickProbes(pixel,spJitterOffset(pixel,s,depth),s,depth);
 if(!picked.valid){return vec4f(0.0);}
 var places=picked.atlas;
 var moving=0.0;
 for(var corner=0u;corner<4u;corner++){moving+=probeMoving[spIndexOf(places[corner])]*picked.weights[corner];}
 return vec4f(spPickedIrradiance(picked,s.N),max(moving,0.004));
}`,
  )
