import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { BEER_READ_WGSL } from './beerShadowMapWgsl.ts'

/**
 * THE READ OF THE VOLUMES' SHADOWS BY A LIT PASS (the volumes' shadow mask, HeterogeneousVolumesShadowMask.usf: the light's
 * share times the transmittance of the volumes toward it; the reference multiplies its mask by the square root of the
 * transmittance and the mask is squared where it is read, the share is multiplied by the transmittance here). `binding`
 * is the read-only storage buffer `encodePack` fills (`beerShadowMapPack.ts`), a one-word buffer of zero where the image
 * has no map. `beerShadowMask(light, P)` is 1 for a light with no map (the maps are kept by shadow slice, `light.params.y`).
 */
export const beerShadowReadWgsl = (binding: number) =>
  wgslBlock(
    `beerShadowReadWgsl(${binding})`,
    [BEER_READ_WGSL],
    `
@group(0) @binding(${binding}) var<storage,read> hvBeerMaps:array<u32>;
/** The word of the block of the light being read, set by \`beerShadowMask\`. */
var<private> beerBlock:u32=0u;
fn beerWordF(i:u32)->f32{return bitcast<f32>(hvBeerMaps[i]);}
fn beerShadowOf(o:u32)->HvShadow{
 var s:HvShadow;
 s.info=vec4u(hvBeerMaps[o],hvBeerMaps[o+1u],hvBeerMaps[o+2u],hvBeerMaps[o+3u]);
 s.sphere=vec4f(beerWordF(o+4u),beerWordF(o+5u),beerWordF(o+6u),beerWordF(o+7u));
 s.near=vec4f(beerWordF(o+8u),beerWordF(o+9u),beerWordF(o+10u),beerWordF(o+11u));
 return s;
}
fn beerFetch(s:HvShadow,face:u32,coord:vec2i)->vec4f{
 let res=s.info.z;
 let c=vec2u(clamp(coord,vec2i(0),vec2i(i32(res)-1)));
 let index=c.y*res*s.info.x+face*res+c.x;
 let base=beerBlock+12u;
 if(s.near.y<0.5){
  let a=unpack2x16float(hvBeerMaps[base+index*2u]);
  let b=unpack2x16float(hvBeerMaps[base+index*2u+1u]);
  return vec4f(a,b);
 }
 let o=base+index*4u;
 return vec4f(beerWordF(o),beerWordF(o+1u),beerWordF(o+2u),beerWordF(o+3u));
}
fn beerShadowMask(light:DirectLight,P:vec3f)->f32{
 let slice=i32(light.params.y);
 if(slice<0||u32(slice)>=hvBeerMaps[0]){return 1.0;}
 let o=hvBeerMaps[1u+u32(slice)];
 if(o==0u){return 1.0;}
 beerBlock=o;
 return hvBeerTransmittance(beerShadowOf(o),light,P);
}
`,
  )
