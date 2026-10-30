import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  hammersley16,
  sampleCosineHemisphere,
  sampleGgxHalf,
} from '../../../../math/src/wgsl/sampling.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { GGX_DISTRIBUTION_WGSL } from '../standardLighting.ts'
import { litPixelStatements, type LitPixelCut } from './litSurfaceWgsl.ts'

/**
 * THE SHADING FURNACE TEST (`shadingFurnaceTest`): every pixel of the lit image is replaced by the light its surface returns toward the eye
 * in a uniform environment of radiance `FURNACE_RADIANCE`, found by sampling the surface's lobes and lighting the pixel from each sample's
 * direction by a directional light of that radiance (no shadow, no size, the lit pass's own surface term, `lampLight`). Three sets of
 * `FURNACE_SAMPLES` samples (an override of the pipeline) of a low-discrepancy sequence: the specular lobe's half vectors, the cosine
 * hemisphere, the clear coat's lobe where the pixel has one (the base lobe's else); each sample's contribution is weighed by the power
 * heuristic over the three sets (`furnaceRadiance`). The pixels no light reaches (the background, an unlit surface) show the radiance
 * itself (`furnaceSky`, one triangle over the image).
 */

/** The radiance of the furnace's environment, from every direction. */
const FURNACE_RADIANCE = '0.5'

/** The entries of the furnace: the surfaces' pixels over the tiles, and the others over the image. */
export const FURNACE_ENTRY = 'furnaceMain'
export const FURNACE_SKY_ENTRY = 'furnaceSky'
/** The pipeline override that sets the samples of each set. */
export const FURNACE_SAMPLES = 'FURNACE_SAMPLES'

/** The furnace's sampling: the pixel's radiance in the uniform environment. */
export const FURNACE_WGSL = wgslBlock(
  'FURNACE_WGSL',
  [
    PI,
    GGX_DISTRIBUTION_WGSL,
    frameAround,
    outOfFrame,
    hammersley16,
    sampleCosineHemisphere,
    sampleGgxHalf,
  ],
  `
override ${FURNACE_SAMPLES}:u32=64u;
/** The light a surface returns toward the eye from a directional light of the furnace's radiance coming from the direction L. */
fn furnaceLight(shading:LobeSurface,N:vec3f,V:vec3f,P:vec3f,L:vec3f)->vec3f{
 let side=dot(N,L);
 if(side<=0.0){return vec3f(0.0);}
 var none:DirectLight;
 return lampLight(shading,N,V,none,P,Lamp(L,L,1.0,side,saturate(side),0.0,1.0,false),1.0)*${FURNACE_RADIANCE};
}
/** The surface's radiance in the furnace: three sets of samples, each sample's light weighed by the power heuristic of the three sets' densities. */
fn furnaceRadiance(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f)->vec3f{
 let shading=clothSurface(lobeSurface(rgb,metal,rough,N,V));lobeView(shading);
 let widths=vec3f(shading.alpha2,1.0,coatSampleAlpha2(shading.alpha2));
 let frame=frameAround(N);
 let count=f32(${FURNACE_SAMPLES});
 var total=vec3f(0.0);
 for(var lobeSet=0u;lobeSet<3u;lobeSet++){
  for(var k=0u;k<${FURNACE_SAMPLES};k++){
   let e=hammersley16(k,${FURNACE_SAMPLES},vec2u(0u));
   var L:vec3f;var H:vec3f;
   if(lobeSet==1u){
    L=outOfFrame(sampleCosineHemisphere(e),frame);
    H=normalize(V+L);
   }else{
    H=outOfFrame(sampleGgxHalf(e,widths[lobeSet]),frame);
    L=2.0*dot(V,H)*H-V;
   }
   let NoL=saturate(dot(N,L));
   let NoH=saturate(dot(N,H));
   let VoH=saturate(dot(V,H));
   let lobe=select(0.0,1.0,NoH>0.0&&VoH>0.0)*NoH/(4.0*max(VoH,1e-12));
   let densities=vec3f(ggxDistribution(widths[0],NoH,max(1.0-NoH*NoH,0.0))*lobe,NoL/PI,ggxDistribution(widths[2],NoH,max(1.0-NoH*NoH,0.0))*lobe)*count;
   let inverse=dot(densities,densities);
   total+=select(0.0,1.0/inverse,inverse>1e-5)*densities[lobeSet]*furnaceLight(shading,N,V,P,L);
  }
 }
 return total;
}`,
)

/** The squared width of the lobe the clear coat's samples are drawn from: the coat's where the pixel has one, else base (the base lobe's); a program without lobes has no coat. Held by the furnace's program alone. */
export const furnaceCoatWgsl = (lobes: boolean) =>
  wgslBlock(
    `FURNACE_COAT_WGSL(${lobes})`,
    [],
    lobes
      ? `
fn coatSampleAlpha2(base:f32)->f32{
 if(!hasCoat()){return base;}
 return lobes.coatAlpha*lobes.coatAlpha;
}`
      : `
fn coatSampleAlpha2(base:f32)->f32{return base;}`,
  )

/** The furnace's fragment stages for a pass of the lit pixel's `cut`: the surfaces' pixels, and the others over one triangle. */
export const furnaceEntries = (cut: LitPixelCut) => `
@fragment fn ${FURNACE_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}
 return lightOut(furnaceRadiance(albedo,base.a,normal.a,N,V,P));
}
@vertex fn furnaceCorner(@builtin(vertex_index) corner:u32)->@builtin(position) vec4f{
 let at=vec2f(f32((corner<<1u)&2u),f32(corner&2u));
 return vec4f(at*2.0-1.0,0.0,1.0);
}
@fragment fn ${FURNACE_SKY_ENTRY}(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let flags=textureLoad(words,vec2i(pixel.xy),${SURFACE_WORDS.flags},0).r;
 if(pixelTileClass(flags)!=0u){discard;}
 return lightOut(vec3f(${FURNACE_RADIANCE}));
}`
