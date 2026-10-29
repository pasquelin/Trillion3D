import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { MODEL_FLAG } from '../materials/surface/surfaceModelWord.ts'
import {
  PIXEL_MODEL,
  PIXEL_MODEL_MASK,
  PIXEL_MODEL_SHIFT,
} from '../materials/surface/pixelModel.ts'
import {
  SURFACE_COLOUR_LAYERS,
  SURFACE_COLOURS_FORMAT,
  SURFACE_WORDS_FORMAT,
} from '../materials/surface/surfaceOutputs.ts'
import { HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { hairListedPixel, hairTileQuadVs } from './tilesWgsl.ts'
import {
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
  HAIR_ONLY_DEPTH_FORMAT,
  HAIR_TILE_LISTS,
  HAIR_TILE_SIZE,
} from './visibilityMath.ts'

/** How much of the strands `hairWriteGBufferData` writes into the surfaces: nothing, a placeholder, the normal and the roughness, the whole surface. */
export const HAIR_GBUFFER_WRITE = { none: 0, placeholder: 1, normal: 2, full: 3 } as const

/** The surface flags of a pixel of strands: a pixel that reads the light, of the hair shading model (which has no specular lobe, so no reflection is traced for it). */
const HAIR_PIXEL_FLAGS =
  MODEL_FLAG.physical | ((PIXEL_MODEL.hair & PIXEL_MODEL_MASK) << PIXEL_MODEL_SHIFT)

/**
 * THE STRANDS WRITTEN INTO THE SURFACES, for each pixel of the tiles with strands whose nearest strand is
 * drawn, once they are laid on the image, for the passes that read the surfaces next. The pixel's samples
 * are averaged (their tangent summed and normalised, their colour, roughness and specular averaged):
 * `placeholder` writes the hair shading model with the tangent (0, 0, 1) as the normal and no roughness;
 * `normal` writes the mean tangent as the normal and the mean roughness; `full` writes also the mean base
 * colour, no metalness, and an emission and occlusion layer that says none. A strand carries no specular
 * lobe in the surfaces, so the specular and the backlit share stay in the samples.
 */
export const hairGbufferOverrideWgsl = (write: number) =>
  wgslProgram(
    `@group(0) @binding(1) var<storage,read> counts:array<u32,${HAIR_TILE_LISTS}>;
@group(0) @binding(2) var<storage,read> tiles:array<u32>;
@group(0) @binding(3) var nodeIndex:texture_2d<u32>;
@group(0) @binding(4) var<storage,read> nodeData:array<u32>;
@group(0) @binding(5) var hairOnlyDepth:texture_storage_2d<${HAIR_ONLY_DEPTH_FORMAT},read>;
@group(0) @binding(6) var colours:texture_storage_2d_array<${SURFACE_COLOURS_FORMAT},write>;
@group(0) @binding(7) var words:texture_storage_2d_array<${SURFACE_WORDS_FORMAT},write>;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairGbufferOverride(@builtin(workgroup_id) block:vec3u,@builtin(num_workgroups) blocks:vec3u,@builtin(local_invocation_id) local:vec3u){
 let at=hairListedPixel(flatIndex(block,blocks,1u),local.xy);
 if(!at.ok){return;}
 let pixel=at.pixel;
 if(!(textureLoad(hairOnlyDepth,vec2i(pixel)).x>0.0)){return;}
 let desc=textureLoad(nodeIndex,vec2i(pixel),0).x;
 let first=desc&${HAIR_NODE_OFFSET_MASK}u;
 let count=desc>>${HAIR_NODE_OFFSET_BITS}u;
 if(count==0u){return;}
 var tangent=vec3f(0.0);
 var colour=vec3f(0.0);
 var roughness=0.0;
 for(var i=0u;i<count;i++){
  let o=(first+i)*${HAIR_NODE_DATA_WORDS}u;
  let tangentWord=nodeData[o+2u];
  let colourWord=nodeData[o+3u];
  tangent+=vec3f(f32(tangentWord&0xffu),f32((tangentWord>>8u)&0xffu),f32((tangentWord>>16u)&0xffu))/255.0*2.0-vec3f(1.0);
  let root=vec3f(f32(colourWord&0xffu),f32((colourWord>>8u)&0xffu),f32((colourWord>>16u)&0xffu))/255.0;
  colour+=root*root;
  roughness+=f32(colourWord>>24u)/255.0;
 }
 let inverse=1.0/f32(count);
 let placeholder=${write === HAIR_GBUFFER_WRITE.placeholder};
 let normal=select(normalize(tangent),vec3f(0.0,0.0,1.0),placeholder);
 textureStore(colours,vec2i(pixel),${SURFACE_COLOUR_LAYERS.normal},vec4f(normal,select(roughness*inverse,0.0,placeholder)));${
   write === HAIR_GBUFFER_WRITE.full
     ? `
 textureStore(colours,vec2i(pixel),${SURFACE_COLOUR_LAYERS.base},vec4f(colour*inverse,0.0));
 if(image.emission!=0u){textureStore(colours,vec2i(pixel),image.emission,vec4f(0.0,0.0,0.0,1.0));}`
     : ''
 }
 textureStore(words,vec2i(pixel),0,vec4u(${HAIR_PIXEL_FLAGS}u,0u,0u,0u));
}`,
    [HAIR_IMAGE_WGSL, hairListedPixel, FLAT_INDEX_WGSL],
  )

/**
 * THE NEAREST STRAND'S DEPTH WRITTEN INTO THE OPAQUE DEPTH, drawn over the tiles with strands (mode `full`): every
 * pixel whose nearest strand is drawn takes its depth, the strands' coverage notwithstanding.
 */
export const HAIR_DEPTH_OVERRIDE_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> tiles:array<u32>;
@group(0) @binding(2) var hairNearest:texture_2d<f32>;
@fragment fn hairDepthOverrideFs(@builtin(position) position:vec4f)->@builtin(frag_depth) f32{
 let depth=textureLoad(hairNearest,vec2i(position.xy),0).x;
 if(!(depth>0.0)){discard;}
 return depth;
}`,
  [hairTileQuadVs],
)
