import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { HASH_UNIT_WGSL } from '../../math/hashUnitWgsl.ts';

/** Ranks a sampled image cycles through: past that many, the offset walks the same path again. */
export const SAMPLED_RANKS = 1024;

/** A rectangle's weight, before any punctual light's (`lightWeight`): only in the program of a
 *  scene that holds a rectangle (`declaredLightWgsl`, #1369). */
const RECT_WEIGHT_WGSL = `
 if(isRect(light)){return light.colorIntensity.w*rectIrradiance(light,P,N).w*dot(light.colorIntensity.rgb,LUMINANCE);}`;

/**
 * Sampled resolve of a tile's opaque light list, for a MOVING image that temporal
 * antialiasing accumulates. Every light of the list is weighed without its shadow — the
 * cheap part —, and only `LIGHT_SAMPLES` of them are shaded in full, shadow read included —
 * the dear part. The estimate is unbiased: averaged over the images the history blends, it
 * converges to the sum over every light, which a still image computes in full.
 *
 * `LIGHT_SAMPLES` points are laid evenly along the cumulative weight of the list, from a per-pixel
 * offset that advances by the golden ratio every image, so one pixel walks its list evenly over
 * time and its neighbours start elsewhere — the reference engine stochastic light sampling' fixed samples per pixel drawn from the
 * light grid's cell, their noise left to the temporal history (#1369). A light whose share of the
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
 * A list with no shadowed light is never drawn (`tileShadowed`, #1249): with no shadow to read,
 * the two weight walks would cost twice the full sum they estimate. The tile pass settles
 * that per-tile fact once, in its record; the resolve reads the flag, never the list.
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
/** Weight of the list's \`index\`th opaque light at the point. */
fn listedWeight(base:u32,index:u32,N:vec3f,P:vec3f)->f32{
 return lightWeight(directLights.items[tileLights[base+TILE_OPAQUE_BASE+index]],N,P);
}
/** Whether a moving image draws a tile's opaque list: a list of \`LIGHT_SAMPLES\` to \`TILE_LIGHTS\`
 *  lights one of which has a shadow slot — the tile pass's flag, one word read once
 *  (\`lightWgsl.ts\` \`TILE_SHADOW_BASE\`), where the resolve once walked the list a pixel at a
 *  time (#1249). A list \`sampledTileLighting\` would sum in full anyway answers false, as the list
 *  walk it replaces did: that pixel takes the full sum at the one call site of a still image. */
fn tileShadowed(tile:vec2u,tilesX:u32)->bool{
 let base=(tile.y*tilesX+tile.x)*TILE_STRIDE;
 return sampledList(tileLights[base])&&tileLights[base+TILE_SHADOW_BASE]!=0u;
}
/** Whether a list of \`kept\` opaque lights is drawn, not summed in full: more than
 *  \`LIGHT_SAMPLES\` and within \`TILE_LIGHTS\`, the one bound \`tileShadowed\` and
 *  \`sampledTileLighting\` share. */
fn sampledList(kept:u32)->bool{return kept>LIGHT_SAMPLES&&kept<=TILE_LIGHTS;}
fn sampledTileLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,tile:vec2u,tilesX:u32,rank:u32,pixel:vec2f)->vec3f{
 let base=(tile.y*tilesX+tile.x)*TILE_STRIDE;
 let kept=tileLights[base];
 // A tile past its list walks its slice of the pool in full, exactly, as a short list does.
 if(!sampledList(kept)){return tileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,TILE_OPAQUE_BASE);}
 // Two walks of the weights, no private array of them (#924): their total and the last light that
 // holds one, then the draw, each recomputing the weight it reads, the same bits.
 var total=0.0;
 var last=0u;
 for(var index=0u;index<kept;index++){
  let weight=listedWeight(base,index,N,P);
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
  let weight=listedWeight(base,index,N,P);
  if(weight<=0.0){continue;}
  running+=weight;
  // An exact light is shaded once and the points it holds are spent; any other is drawn once per
  // point it holds. The last light takes the points rounding left behind: none is lost.
  let exact=weight*f32(LIGHT_SAMPLES)>=total;
  if(exact&&used<LIGHT_SAMPLES){chosen[used]=index;used+=1u;}
  while(point<LIGHT_SAMPLES&&(next<running||index==last)){
   if(!exact&&used<LIGHT_SAMPLES){chosen[used]=index;used+=1u;}
   point+=1u;next=(f32(point)+offset)/f32(LIGHT_SAMPLES)*total;
  }
 }
 var result=vec3f(0.0);
 for(var slot=0u;slot<used;slot++){
  let light=directLights.items[tileLights[base+TILE_OPAQUE_BASE+chosen[slot]]];
  // An exact light counts once; a drawn one is divided by its probability, the points it holds
  // on average: its share of the total, times the points.
  let weight=lightWeight(light,N,P);
  var factor=1.0;
  if(weight*f32(LIGHT_SAMPLES)<total){factor=total/(f32(LIGHT_SAMPLES)*weight);}
  result+=declaredLight(light,rgb,metal,rough,N,V,P,ao)*factor;
 }
 return result;
}`;
