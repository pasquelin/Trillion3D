import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { HASH_UNIT_WGSL } from '../../gpu/shader/hashUnitWgsl.ts'

/** Ranks a sampled image cycles through: past that many, the offset walks the same path again. */
export const SAMPLED_RANKS = 1024

/** A rectangle's weight, before any punctual light's (`lightWeight`): only in the program of a
 *  scene that holds a rectangle (`declaredLightWgsl`). */
const RECT_WEIGHT_WGSL = `
 if(isRect(light)){return light.colorIntensity.w*rectIrradiance(light,P,N).w*dot(light.colorIntensity.rgb,LUMINANCE);}`

/**
 * Sampled resolve of a cell's light list, for a MOVING image that temporal
 * antialiasing accumulates. Every light of the list is weighed without its shadow — the
 * cheap part —, and only `LIGHT_SAMPLES` of them are shaded in full, shadow read included —
 * the dear part. The estimate is unbiased: averaged over the images the history blends, it
 * converges to the sum over every light, which a still image computes in full.
 *
 * `LIGHT_SAMPLES` points are laid evenly along the cumulative weight of the list, from a per-pixel
 * offset that advances by the golden ratio every image, so one pixel walks its list evenly over
 * time and its neighbours start elsewhere — a fixed number of samples per pixel drawn from the
 * light grid's cell, their noise left to the temporal history. A light whose share of the
 * pixel's weight reaches one sample's worth holds a point or more and is shaded **exactly**, once,
 * the points it holds spent: it would be drawn every image anyway, and drawing it a varying number
 * of times is what would make a sunlit wall flicker. Any other light is drawn once per point it
 * holds, divided by its probability — its share of the total times the points. Two walks of the
 * weights: their total, then the draw. At most `LIGHT_SAMPLES` shadows are read either way, and a
 * list of that many lights or fewer is summed in full.
 *
 * `hashUnit` is the engine's integer hash: the offset depends on the pixel and the image rank
 * only, so a replayed image is the same image, and two runs give the same sequence. The rank
 * is bounded by the caller (`SAMPLED_RANKS`): a large one would eat the fraction's precision.
 *
 * A list with no shadowed light is never drawn (`cellShadowed`): with no shadow to read,
 * the two weight walks would cost twice the full sum they estimate. The grid pass settles
 * that per-cell fact once, in its count's high bit; the resolve reads the flag, never the list.
 */
export const directLightSamplingWgsl = (rects = true) => `
const LIGHT_SAMPLES:u32=${LIGHT_SETTINGS.samplesPerPixel}u;
const LUMINANCE:vec3f=vec3f(0.2126,0.7152,0.0722);
const GOLDEN_RATIO:f32=0.61803399;
${HASH_UNIT_WGSL}
/** Unshadowed weight of a light at the point: its share of the pixel's drawing. Zero exactly
 *  when the unshadowed contribution is — out of range, or behind the surface —, so no light
 *  that could contribute is ever left undrawable. */
fn lightWeight(light:DirectLight,N:vec3f,P:vec3f)->f32{${rects ? RECT_WEIGHT_WGSL : ''}
 let incidence=directIncidence(light,P);
 return light.colorIntensity.w*incidence.w*max(dot(N,incidence.xyz),0.0)*dot(light.colorIntensity.rgb,LUMINANCE);
}
/** Weight of the \`index\`th light of a list starting at \`first\` in the pool. */
fn listedWeight(first:u32,index:u32,N:vec3f,P:vec3f)->f32{
 return lightWeight(directLights.items[tileLights[first+index]],N,P);
}
/** Whether a list of \`kept\` lights is drawn, not summed in full: more than \`LIGHT_SAMPLES\` and
 *  within \`TILE_LIGHTS\`. */
fn sampledList(kept:u32)->bool{return kept>LIGHT_SAMPLES&&kept<=TILE_LIGHTS;}
/** The lights of a cell's list (\`cellSlice\`) drawn: a list \`sampledList\` takes, that holds a
 *  shadowed light (\`cellShadowed\`), in the pool. */
fn sampledSliceLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u,rank:u32,pixel:vec2f)->vec3f{
 let first=slice.x;let kept=slice.y;
 // Two walks of the weights, no private array of them: their total and the last light that
 // holds one, then the draw, each recomputing the weight it reads, the same bits.
 var total=0.0;
 var last=0u;
 for(var index=0u;index<kept;index++){
  let weight=listedWeight(first,index,N,P);
  total+=weight;
  if(weight>0.0){last=index;}
 }
 if(total<=0.0){return vec3f(0.0);}
 // The lights to shade, in list order. The shading loop below is the same for every pixel of the
 // group — one call per slot, each pixel reading its own light — where a call inside the walk would
 // run once per light any pixel of the group drew, and the walk would then cost what it saves.
 var chosen:array<u32,LIGHT_SAMPLES>;
 var used=0u;
 let offset=fract(hashUnit(u32(pixel.y)*65536u+u32(pixel.x))+f32(rank)*GOLDEN_RATIO);
 var running=0.0;
 var point=0u;
 var next=offset/f32(LIGHT_SAMPLES)*total;
 for(var index=0u;index<kept;index++){
  let weight=listedWeight(first,index,N,P);
  if(weight<=0.0){continue;}
  running+=weight;
  // An exact light is shaded once and the points it holds are spent; any other is drawn once per
  // point it holds. The last light takes the points rounding left behind: none is lost.
  let exact=weight*f32(LIGHT_SAMPLES)>=total;
  // An exact light is kept past \`TILE_LIGHTS\`: the shading reads it back with no weight.
  if(exact&&used<LIGHT_SAMPLES){chosen[used]=index+TILE_LIGHTS;used+=1u;}
  while(point<LIGHT_SAMPLES&&(next<running||index==last)){
   if(!exact&&used<LIGHT_SAMPLES){chosen[used]=index;used+=1u;}
   point+=1u;next=(f32(point)+offset)/f32(LIGHT_SAMPLES)*total;
  }
 }
 var result=vec3f(0.0);
 let shading=lobeSurface(rgb,metal,rough,N,V);
 for(var slot=0u;slot<used;slot++){
  let light=directLights.items[tileLights[first+chosen[slot]%TILE_LIGHTS]];
  // An exact light counts once; a drawn one is divided by its probability, the points it holds
  // on average: its share of the total, times the points.
  var factor=1.0;
  if(chosen[slot]<TILE_LIGHTS){factor=total/(f32(LIGHT_SAMPLES)*lightWeight(light,N,P));}
  result+=declaredLight(light,rgb,metal,rough,N,V,P,ao,shading)*factor;
 }
 return result;
}`
