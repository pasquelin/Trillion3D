import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { HAIR_FLAG, HAIR_MACRO_GROUP_SHIFT } from './materialMath.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COORD_MASK,
  HAIR_COVERAGE_BITS,
  HAIR_NODE_DATA_WORDS,
} from './visibilityMath.ts'

/**
 * A COMPACTED SAMPLE OF THE STRANDS, read from the arrays the host declares (`hairCoord`, the pixel of each sample, and `hairData`, its
 * words): the pixel, the depth, the fibre's direction, the colour and the roughness the material gave it, its specular, whether it
 * scatters the scene's light, its share of the pixel, the lighting channels it belongs to and the macro group it lies in. The one reading of the words the
 * material pass wrote, for every pass that lights a sample.
 */
export const HAIR_SAMPLE_WGSL = wgslBlock(
  'HAIR_SAMPLE_WGSL',
  [],
  `struct HairSample{pixel:vec2u,z:f32,tangent:vec3f,colour:vec3f,roughness:f32,specular:f32,scatter:f32,coverage:f32,channels:u32,owner:u32}
fn hairSampleOf(index:u32)->HairSample{
 let o=index*${HAIR_NODE_DATA_WORDS}u;
 let packed=hairCoord[index];
 let tangentWord=hairData[o+2u];
 let colourWord=hairData[o+3u];
 let shadeWord=hairData[o+4u];
 let sqrtColour=vec3f(f32(colourWord&0xffu),f32((colourWord>>8u)&0xffu),f32((colourWord>>16u)&0xffu))/255.0;
 var s:HairSample;
 s.pixel=vec2u(packed&${HAIR_COORD_MASK}u,packed>>${HAIR_COORD_BITS}u);
 s.z=bitcast<f32>(hairData[o]);
 s.tangent=normalize(vec3f(f32(tangentWord&0xffu),f32((tangentWord>>8u)&0xffu),f32((tangentWord>>16u)&0xffu))/255.0*2.0-vec3f(1.0));
 s.colour=sqrtColour*sqrtColour;
 s.roughness=f32(colourWord>>24u)/255.0;
 s.specular=f32(shadeWord&0xffu)/255.0;
 s.scatter=select(0.0,1.0,(((shadeWord>>16u)&0xffu)&${HAIR_FLAG.scatterSceneLight}u)!=0u);
 s.coverage=f32(tangentWord>>${32 - HAIR_COVERAGE_BITS}u)/255.0;
 s.channels=(shadeWord>>24u)&7u;
 s.owner=hairData[o+1u]>>${HAIR_MACRO_GROUP_SHIFT}u;
 return s;
}`,
)
