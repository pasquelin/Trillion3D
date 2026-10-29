import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'
import { NO_CONTACT_SHADOW_SURFACE_FLAG } from '../materials/surface/surfaceModel.ts'
import { UNLIT_FLAG } from '../materials/surface/surfaceModelWord.ts'
import {
  SURFACE_COLOUR_LAYERS,
  SURFACE_COLOURS_FORMAT,
  SURFACE_WORDS_FORMAT,
} from '../materials/surface/surfaceOutputs.ts'
import { flagsOfChannels } from '../materials/surface/surfaceChannels.ts'
import { HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { HAIR_FLAG } from './materialMath.ts'
import { hairListedPixel, hairTileQuadVs } from './tilesWgsl.ts'
import {
  HAIR_NODE_DATA_WORDS,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
  HAIR_ONLY_DEPTH_FORMAT,
  HAIR_TILE_LISTS,
  HAIR_TILE_SIZE,
} from './visibilityMath.ts'
import { HAIR_DEPTH_BIAS } from './depthBias.ts'

/** What the passes after the material read of a pixel's samples: the nearest depth (reverse-Z, the
 *  greatest), the lighting channels any of them is in (the union of their masks), and whether any of them
 *  casts a contact shadow or lights the scene behind it. The host
 *  declares `nodeIndex` (the descriptors) and `nodeData` (the materials). */
const EXTRACT_WGSL = wgslBlock(
  'HAIR_EXTRACT_WGSL',
  [],
  `struct Extracted{depth:f32,channels:u32,castContact:bool,scatter:bool}
fn extractSample(pixel:vec2u)->Extracted{
 let desc=textureLoad(nodeIndex,vec2i(pixel),0).x;
 let first=desc&${HAIR_NODE_OFFSET_MASK}u;
 let count=desc>>${HAIR_NODE_OFFSET_BITS}u;
 var out=Extracted(0.0,0u,false,false);
 for(var i=0u;i<count;i++){
  let at=(first+i)*${HAIR_NODE_DATA_WORDS}u;
  out.depth=max(out.depth,bitcast<f32>(nodeData[at]));
  let flags=(nodeData[at+4u]>>16u)&0xffu;
  out.channels=out.channels|((nodeData[at+4u]>>24u)&7u);
  out.castContact=out.castContact||(flags&${HAIR_FLAG.castContactShadow}u)!=0u;
  out.scatter=out.scatter||(flags&${HAIR_FLAG.scatterSceneLight}u)!=0u;
 }
 return out;
}`,
)

const TILE_ENTRY = `@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1)`
const TILE_BUILTINS =
  '@builtin(workgroup_id) block:vec3u,@builtin(num_workgroups) blocks:vec3u,@builtin(local_invocation_id) local:vec3u'

/**
 * THE DEPTH OF THE NEAREST STRAND, for each pixel of the tiles with strands: the greatest depth
 * (reverse-Z, the nearest) of the pixel's samples, 0 for a pixel that holds none (the pixels of the
 * other tiles are 0 too: the transmittance's pass clears the texture whole, `HairImageTargets`), in one
 * walk of the pixel's samples. With `surfaces`, the same walk empties THE SURFACES UNDER FULL
 * COVERAGE: a pixel whose coverage is whole (the strands cover it to the threshold) and whose strands
 * do not light the scene behind them loses its surface: its colours are emptied (black, and no
 * emission nor occlusion), its flags say an unlit surface that casts a contact shadow where one of its
 * strands does and that is in the lighting channels of its strands (`flagsOfChannels`: the pass that reads the
 * surfaces' channels finds the strands'). The lighting then leaves it to the strands, and the depth of the pixel is the strands'
 * (`HAIR_DEPTH_WGSL`).
 */
export function hairGbufferWgsl(surfaces: boolean) {
  const empty = surfaces
    ? `
 if(textureLoad(coverage,vec2i(pixel),0).r<1.0||found.scatter){return;}
 textureStore(colours,vec2i(pixel),${SURFACE_COLOUR_LAYERS.base},vec4f(0.0));
 textureStore(colours,vec2i(pixel),${SURFACE_COLOUR_LAYERS.normal},vec4f(0.0));
 if(image.emission!=0u){textureStore(colours,vec2i(pixel),image.emission,vec4f(0.0,0.0,0.0,1.0));}
 textureStore(words,vec2i(pixel),0,vec4u(${UNLIT_FLAG}u|select(${NO_CONTACT_SHADOW_SURFACE_FLAG}u,0u,found.castContact)|flagsOfChannels(found.channels),0u,0u,0u));`
    : ''
  return wgslProgram(
    `@group(0) @binding(1) var<storage,read> counts:array<u32,${HAIR_TILE_LISTS}>;
@group(0) @binding(2) var<storage,read> tiles:array<u32>;
@group(0) @binding(3) var nodeIndex:texture_2d<u32>;
@group(0) @binding(4) var<storage,read> nodeData:array<u32>;
@group(0) @binding(5) var hairOnlyDepth:texture_storage_2d<${HAIR_ONLY_DEPTH_FORMAT},write>;${
      surfaces
        ? `
@group(0) @binding(6) var coverage:texture_2d<f32>;
@group(0) @binding(7) var colours:texture_storage_2d_array<${SURFACE_COLOURS_FORMAT},write>;
@group(0) @binding(8) var words:texture_storage_2d_array<${SURFACE_WORDS_FORMAT},write>;`
        : ''
    }
${TILE_ENTRY} fn hairGbuffer(${TILE_BUILTINS}){
 let at=hairListedPixel(flatIndex(block,blocks,1u),local.xy);
 if(!at.ok){return;}
 let pixel=at.pixel;
 let found=extractSample(pixel);
 textureStore(hairOnlyDepth,vec2i(pixel),vec4f(found.depth,0.0,0.0,0.0));${empty}
}`,
    [
      HAIR_IMAGE_WGSL,
      EXTRACT_WGSL,
      hairListedPixel,
      FLAT_INDEX_WGSL,
      ...(surfaces ? [flagsOfChannels] : []),
    ],
  )
}

/**
 * THE DEPTH UNDER FULL COVERAGE, drawn over the tiles with strands: for a pixel the patch of the
 * surfaces emptied (`hairGbufferWgsl`), the depth of the nearest strand less `HAIR_DEPTH_BIAS`, written
 * into the opaque depth; every other pixel is left as it is.
 */
export const HAIR_DEPTH_WGSL = wgslProgram(
  `@group(0) @binding(1) var<storage,read> tiles:array<u32>;
@group(0) @binding(2) var nodeIndex:texture_2d<u32>;
@group(0) @binding(3) var<storage,read> nodeData:array<u32>;
@group(0) @binding(4) var coverage:texture_2d<f32>;
@fragment fn hairDepthFs(@builtin(position) position:vec4f)->@builtin(frag_depth) f32{
 let pixel=vec2u(position.xy);
 if(textureLoad(coverage,vec2i(pixel),0).r<1.0){discard;}
 let found=extractSample(pixel);
 if(found.scatter){discard;}
 return found.depth-${HAIR_DEPTH_BIAS};
}`,
  [HAIR_IMAGE_WGSL, EXTRACT_WGSL, hairTileQuadVs],
)
