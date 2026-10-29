import { FINITE_SENTINEL } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { zOrderDecode } from '../../../../math/src/wgsl/integer.ts'
import { frameAround, intoFrame, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import {
  hammersley16,
  interleavedGradientNoise,
  rand3dPcg16,
  visibleGgxHalf,
} from '../../../../math/src/wgsl/sampling.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../materials/surface/physicalLobes.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { specularOfFlags } from '../../materials/surface/surfaceSpecular.ts'
import {
  SCREEN_SPACE_GROUP_SIDE,
  SCREEN_SPACE_GROUP_THREADS,
  TILE_MASK_BITS,
  screenReflectionMarch,
} from './screenSpaceQuality.ts'
import {
  SCREEN_SPACE_BINDINGS,
  SCREEN_SPACE_CAST_WGSL,
  SCREEN_SPACE_REPROJECT_WGSL,
  SCREEN_SPACE_SURFACE_WGSL,
} from './rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP } from './screenSpaceView.ts'

const SCREEN_REFLECTION_TILE_VERTICES = 6

/** The rays of a pixel that casts several: the quality's rays drawn from the visible normals of the lobe (one along the reflection for a mirror), averaged weighted down by luminance. */
const reflectionMultiRayText = (
  hitDistance: string,
) => ` let noise=interleavedGradientNoise(sv,f32(frame));
 let random=rand3dPcg16(vec3i(pixel,i32(frame))).xy;
 let basis=frameAround(surface.N);
 let tangentV=intoFrame(basis,V);
 if(roughness<0.1){numSteps=min(numSteps*numRays,24u);numRays=1u;}
 for(var i=0u;i<numRays;i++){
  let stepOffset=noise-0.5;
  let E=hammersley16(i,numRays,random);
  var L=vec3f(0.0);
  if(roughness<0.1){L=reflect(-V,surface.N);}
  else{
   let H=outOfFrame(visibleGgxHalf(E,vec2f(a),tangentV),basis);
   L=2.0*dot(V,H)*H-V;
  }
  let ray=ssRayFromWorld(P,L,sceneDepth,sceneDepth,4.0,true);
  let marched=ssCast(ray,roughness,numSteps,stepOffset,1.0);
  if(marched.found){
${hitDistance}   let back=ssReprojectHit(marched.hit);
   var hitColor=ssColorAt(back.uv)*back.vignette;
   hitColor=vec4f(hitColor.rgb/(1.0+dot(hitColor.rgb,vec3f(0.3,0.59,0.11))),hitColor.a);
   color+=hitColor;
  }
 }
 color=color/max(f32(numRays),0.0001);
 color=vec4f(color.rgb/(1.0-dot(color.rgb,vec3f(0.3,0.59,0.11))),color.a);`

/** The draw of the one ray's direction from the visible normals of the lobe (\`glossy\`), the denoiser's second sample capped at 0.9. */
const reflectionGlossyText = (glossy: boolean, denoised: boolean) =>
  glossy
    ? ` {
  let random=rand3dPcg16(vec3i(pixel,i32(frame))).xy;
  var E=vec2f(random)*(1.0/65536.0);
${denoised ? '  E.y*=0.9;\n' : ''}
  let basis=frameAround(surface.N);
  let H=outOfFrame(visibleGgxHalf(E,vec2f(a),intoFrame(basis,V)),basis);
  L=2.0*dot(V,H)*H-V;
 }
`
    : ''

/** The one ray of a pixel: along the reflection, bent by the lobe where \`glossy\`. */
const reflectionSingleRayText = (
  glossy: boolean,
  denoised: boolean,
  hitDistance: string,
) => ` let stepOffset=interleavedGradientNoise(sv,f32(frame))-0.5;
 var L=reflect(-V,surface.N);
${reflectionGlossyText(glossy, denoised)}
 let ray=ssRayFromWorld(P,L,sceneDepth,sceneDepth,4.0,true);
 let marched=ssCast(ray,roughness,numSteps,stepOffset,1.0);
 if(marched.found){
${hitDistance}  let back=ssReprojectHit(marched.hit);
  color=ssColorAt(back.uv)*back.vignette;
 }`

/** The pixel's reflection as the quality code asks: the checker that shows the pixels that trace, or the rays' average faded by the roughness and scaled by the intensity. */
const reflectionBodyText = (code: number, denoised: boolean) => {
  const { steps, rays, glossy } = screenReflectionMarch(code, denoised)
  // For the denoiser: the closest hit's squared distance, which becomes the confusion factor the denoiser spreads the reflection with.
  const hitDistance = denoised
    ? '  closest=min(closest,ssHitSquaredDistance(P,marched.hit));\n'
    : ''
  if (code === 0) {
    return ` let pattern=f32(((u32(pixel.x)/4u)+(u32(pixel.y)/4u))%2u);
 return mix(vec4f(1.0,0.0,0.0,1.0),vec4f(1.0,1.0,0.0,1.0),pattern)*0.2;`
  }
  return ` let a=roughness*roughness;
 var numSteps=${steps}u;
 var numRays=${rays}u;
 let frame=ssView.frame.x;
 var color=vec4f(0.0);
${denoised ? ' var closest=FINITE_SENTINEL;\n' : ''}${
    rays > 1
      ? reflectionMultiRayText(hitDistance)
      : reflectionSingleRayText(glossy, denoised, hitDistance)
  }
 color=color*fade;
${denoised ? ' reflectionConfusion=select(-1.0,sqrt(closest)/(length(P-ssView.camera.xyz)+sqrt(closest)),closest>0.0);\n' : ''} color=color*ssView.reflection.x;
 return vec4f(color.rgb*ssView.reflection.w,color.a);`
}

/**
 * THE SCREEN REFLECTIONS OF ONE PIXEL (screenReflectionAt), at the quality code code (1 to 4; 0 is the checker that shows the pixels that
 * trace). A lit pixel whose roughness has not faded out casts rays from its point through the depth pyramid: the glossy qualities draw
 * rays directions from the visible normals of its lobe, a mirror (roughness under 0.1) one ray along the reflection with the steps of
 * all the rays; each ray that hits reads the image held at the hit's place there, weighted down by its luminance before the rays are
 * averaged and back up after. The result is faded by the roughness, scaled by the intensity and the image's pre-exposure correction.
 * One ray and no gloss (the two lowest levels) reflects the surface's normal exactly.
 */
const reflectionPixelWgsl = (code: number, denoised: boolean) =>
  wgslBlock(
    `SCREEN_REFLECTION_PIXEL_WGSL(${code}, ${denoised})`,
    [
      SCREEN_SPACE_CAST_WGSL(false),
      SCREEN_SPACE_REPROJECT_WGSL,
      SCREEN_SPACE_SURFACE_WGSL,
      interleavedGradientNoise,
      rand3dPcg16,
      hammersley16,
      visibleGgxHalf,
      frameAround,
      intoFrame,
      outOfFrame,
      FINITE_SENTINEL,
    ],
    `${denoised ? 'var<private> reflectionConfusion:f32=-1.0;\n' : ''}
/** The reflection of the pixel pixel of the view: transparent black where the pixel casts no ray. */
fn screenReflectionAt(pixel:vec2i)->vec4f{
${denoised ? ' reflectionConfusion=-1.0;\n' : ''} let surface=ssSurfaceAt(pixel);
 let z=hizOpaqueDepth(pixel);
 if(ssFarDepth(z)||!surface.valid){return vec4f(0.0);}
 let roughness=surface.roughness;
 let fade=min(roughness*ssView.reflection.y+2.0,1.0);
 if(fade<=0.0){return vec4f(0.0);}
 let sv=vec2f(pixel)+vec2f(0.5);
 let sceneDepth=ssSceneDepth(z);
 let P=ssWorldAt(ssScreenOfPixel(sv),z);
 let V=-ssCameraVector(P);
${reflectionBodyText(code, denoised)}
}`,
  )

/** Whether a pixel of the view casts a reflection ray: a surface, lit, and not faded out by its roughness. */
const castsWgsl = wgslBlock(
  'SCREEN_REFLECTION_CASTS_WGSL',
  [SCREEN_SPACE_SURFACE_WGSL],
  `
fn screenReflectionCasts(pixel:vec2i)->bool{
 let surface=ssSurfaceAt(pixel);
 let z=hizOpaqueDepth(pixel);
 return !ssFarDepth(z)&&surface.valid&&min(surface.roughness*ssView.reflection.y+2.0,1.0)>0.0;
}`,
)

const OUT = SCREEN_SPACE_BINDINGS.out
const LIST = SCREEN_SPACE_BINDINGS.list

/** The full-screen triangle and the tile quad's vertex programs, shared by the fragment passes. */
const VERTEX = `
@vertex fn fullscreenVertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4f{
 let corner=vec2f(f32((id<<1u)&2u),f32(id&2u));
 return vec4f(corner*2.0-vec2f(1.0),0.5,1.0);
}
@group(${SCREEN_SPACE_GROUP}) @binding(${LIST}) var<storage,read> tileList:array<u32>;
@vertex fn tileVertex(@builtin(instance_index) tile:u32,@builtin(vertex_index) id:u32)->@builtin(position) vec4f{
 let packed=tileList[tile];
 let origin=vec2u(packed&0xfffu,(packed>>12u)&0xfffu)*${SCREEN_SPACE_GROUP_SIDE}u;
 var corner=origin;
 if(id==1u||id==2u||id==4u){corner.x+=${SCREEN_SPACE_GROUP_SIDE}u;}
 if(id==2u||id==4u||id==5u){corner.y+=${SCREEN_SPACE_GROUP_SIDE}u;}
 return vec4f(vec2f(corner)*ssView.size.zw*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),0.5,1.0);
}`

/** The program of the reflections at the quality code code (`denoised`: for the denoiser, which also reads how far the closest ray went, as a confusion factor, -1 where no ray was cast — a second output, a storage texture of the compute entry, a second target of the fragments): the compute entry (reflectionCompute, writing the storage texture), the fragment
 *  entry (reflectionFragment) over the full-screen triangle (fullscreenVertex) or the tile quads (tileVertex), the same entry that tints the
 *  tiles (reflectionTilesFragment), and the stencil's (reflectionStencil): which pixel needs no trace is cleared. The stencil entry
 *  and the tiled ones are in the module whether or not the view asks for them; a pipeline names the entry it runs. */
export const screenReflectionsWgsl = (code: number, denoised = false) =>
  wgslProgram(
    denoised
      ? `@group(${SCREEN_SPACE_GROUP}) @binding(${OUT}) var reflectionOut:texture_storage_2d<rgba16float,write>;
@group(${SCREEN_SPACE_GROUP}) @binding(${SCREEN_SPACE_BINDINGS.outSecond}) var confusionOut:texture_storage_2d<r32float,write>;
struct ReflectionOut{@location(0) color:vec4f,@location(1) confusion:vec4f,}
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn reflectionCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=ssView.size.xy)){return;}
 textureStore(reflectionOut,vec2i(id.xy),screenReflectionAt(vec2i(id.xy)));
 textureStore(confusionOut,vec2i(id.xy),vec4f(reflectionConfusion,0.0,0.0,0.0));
}
@fragment fn reflectionFragment(@builtin(position) at:vec4f)->ReflectionOut{
 let color=screenReflectionAt(vec2i(at.xy));
 return ReflectionOut(color,vec4f(reflectionConfusion,0.0,0.0,0.0));
}
@fragment fn reflectionTilesFragment(@builtin(position) at:vec4f)->ReflectionOut{
 var color=screenReflectionAt(vec2i(at.xy));
 if((ssView.frame.z/30u)%2u!=0u){color=vec4f(8.0*ssView.tileSpecular.w,color.y,color.z,1.0);}
 return ReflectionOut(color,vec4f(reflectionConfusion,0.0,0.0,0.0));
}
/** Where the pixel casts, the fragment is dropped and leaves the stencil alone: the pass over the pixels the stencil did not mark runs the trace. A pixel that casts no ray has no confusion (-1). */
@fragment fn reflectionStencil(@builtin(position) at:vec4f)->ReflectionOut{
 if(screenReflectionCasts(vec2i(at.xy))){discard;}
 return ReflectionOut(vec4f(0.0),vec4f(-1.0,0.0,0.0,0.0));
}${VERTEX}`
      : `@group(${SCREEN_SPACE_GROUP}) @binding(${OUT}) var reflectionOut:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn reflectionCompute(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=ssView.size.xy)){return;}
 textureStore(reflectionOut,vec2i(id.xy),screenReflectionAt(vec2i(id.xy)));
}
@fragment fn reflectionFragment(@builtin(position) at:vec4f)->@location(0) vec4f{
 return screenReflectionAt(vec2i(at.xy));
}
@fragment fn reflectionTilesFragment(@builtin(position) at:vec4f)->@location(0) vec4f{
 var color=screenReflectionAt(vec2i(at.xy));
 if((ssView.frame.z/30u)%2u!=0u){color=vec4f(8.0*ssView.tileSpecular.w,color.y,color.z,1.0);}
 return color;
}
/** Where the pixel casts, the fragment is dropped and leaves the stencil alone: the pass over the pixels the stencil did not mark runs the trace. */
@fragment fn reflectionStencil(@builtin(position) at:vec4f)->@location(0) vec4f{
 if(screenReflectionCasts(vec2i(at.xy))){discard;}
 return vec4f(0.0);
}${VERTEX}`,
    [
      /* the inputs first, then the pixel: */
      reflectionPixelWgsl(code, denoised),
      castsWgsl,
    ],
  )

/** The tile mask's bindings, and the pass that sets a bit a tile that holds a pixel to trace for. */
const TILE_MARK_TEXT = `@group(${SCREEN_SPACE_GROUP}) @binding(${OUT}) var<storage,read_write> tileMask:array<atomic<u32>>;
@group(${SCREEN_SPACE_GROUP}) @binding(${SCREEN_SPACE_BINDINGS.outSecond}) var<storage,read_write> tileArguments:array<atomic<u32>>;
@group(${SCREEN_SPACE_GROUP}) @binding(${LIST}) var<storage,read_write> tileListOut:array<u32>;
var<workgroup> anyTile:atomic<u32>;
fn pixelHoldsReflection(pixel:vec2i)->bool{
 let surface=ssSurfaceAt(pixel);
 let z=hizOpaqueDepth(pixel);
 if(ssFarDepth(z)||!surface.valid){return false;}
 var holds=surface.roughness<=ssView.tiles.w&&specularOfFlags(surface.flags)>=ssView.tileSpecular.x&&pixelModelOf(surface.flags)!=${PIXEL_MODEL.hair}u;
 if(surface.roughness==0.0&&specularOfFlags(surface.flags)==0.0){holds=false;}
 return holds||ssCoated(surface.flags,pixel);
}
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn reflectionTileMark(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) index:u32){
 if(index==0u){atomicStore(&anyTile,0u);}
 workgroupBarrier();
 var holds=false;
 if(all(vec2f(id.xy)<ssView.size.xy)){holds=pixelHoldsReflection(vec2i(id.xy));}
 if(holds){atomicOr(&anyTile,1u);}
 workgroupBarrier();
 if(index==0u&&atomicLoad(&anyTile)!=0u){
  let extent=vec2u(ssView.tiles.xy);
  let at=extent.x*group.y+group.x;
  atomicOr(&tileMask[at/${TILE_MASK_BITS}u],1u<<(at%${TILE_MASK_BITS}u));
 }
}
`

/** The pass that builds the list of the marked tiles, in Z-order over groups of 64 tiles, and the draw and dispatch arguments. */
const TILE_LIST_TEXT = `var<workgroup> listTiles:array<u32,${SCREEN_SPACE_GROUP_THREADS}>;
var<workgroup> listCount:atomic<u32>;
var<workgroup> listOffset:u32;
@compute @workgroup_size(${SCREEN_SPACE_GROUP_SIDE},${SCREEN_SPACE_GROUP_SIDE})
fn reflectionTileList(@builtin(workgroup_id) group:vec3u,@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) index:u32){
 if(all(id.xy==vec2u(0u))){
  atomicStore(&tileArguments[0],${SCREEN_REFLECTION_TILE_VERTICES}u);
  atomicStore(&tileArguments[5],1u);
  atomicStore(&tileArguments[6],1u);
 }
 if(index==0u){
  atomicStore(&listCount,0u);
  let extent=vec2u(ssView.tiles.xy);
  var count=0u;
  for(var local=0u;local<${SCREEN_SPACE_GROUP_THREADS}u;local++){
   let tile=group.xy*${SCREEN_SPACE_GROUP_SIDE}u+zOrderDecode(local);
   if(all(tile<extent)){
    let at=extent.x*tile.y+tile.x;
    if((atomicLoad(&tileMask[at/${TILE_MASK_BITS}u])&(1u<<(at%${TILE_MASK_BITS}u)))!=0u){
     listTiles[count]=tile.x|(tile.y<<12u);
     count++;
    }
   }
  }
  atomicStore(&listCount,count);
  if(count>0u){
   listOffset=atomicAdd(&tileArguments[1],count);
   atomicAdd(&tileArguments[4],count);
  }
 }
 workgroupBarrier();
 if(index<atomicLoad(&listCount)){tileListOut[listOffset+index]=listTiles[index];}
}`

/**
 * THE TILES THAT TRACE (reflectionTileMark, reflectionTileList): the first pass sets a bit a tile of 8 by 8 pixels that holds a pixel to
 * trace for — its roughness at most the tiles' maximum, its specular at least the tiles' minimum, lit and not hair; a mirror with no specular is left out; a clear-coated pixel always traces —, the second builds the list of the marked
 * tiles, coherent in Z-order over groups of 64 tiles, and the arguments of the indirect draw ([6, tiles, 0, 0]) then of the dispatch ([tiles, 1, 1]), one buffer of seven words. The mask
 * is one bit a tile, 32 to a word.
 */
export const screenReflectionTilesWgsl = () =>
  wgslProgram(
    TILE_MARK_TEXT + TILE_LIST_TEXT,

    [SCREEN_SPACE_SURFACE_WGSL, specularOfFlags, pixelModelOf, ssCoatedWgsl, zOrderDecode],
  )

/** Whether a clear-coated pixel (which always traces) wears a coat: the lobes' texel under the physical flag. */
const ssCoatedWgsl = wgslBlock(
  'SCREEN_REFLECTION_COATED_WGSL',
  [SCREEN_SPACE_SURFACE_WGSL],
  `
fn ssCoated(flags:u32,pixel:vec2i)->bool{
 if((flags&${PHYSICAL_SURFACE_FLAG}u)==0u){return false;}
 let size=vec2i(textureDimensions(surfaceLobes));
 return packedCoat(textureLoad(surfaceLobes,clampToExtent(pixel,size),0)).x>0.0;
}`,
)
