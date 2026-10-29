import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import {
  HAIR_COVERAGE_FORMAT,
  HAIR_ONLY_DEPTH_FORMAT,
  HAIR_TILE_SIZE,
  HAIR_TRANSMITTANCE_FORMAT,
} from '../visibilityMath.ts'
import { FORWARD_PARAMS_WGSL } from './forwardCommonWgsl.ts'
import { FORWARD_COLOR_FORMAT } from './forwardRasterWgsl.ts'

/** The bindings of the clear, in group 0 after the image block. */
const FORWARD_CLEAR_BINDING = { transmittance: 1, depth: 2, coverage: 3, color: 4 } as const
const B = FORWARD_CLEAR_BINDING

/**
 * THE CLEAR OF WHAT THE FORWARD RASTER WRITES, over the whole image (a group a tile of `HAIR_TILE_SIZE` pixels): the transmittance to 1, the depth of the nearest strand and the coverage to 0 and the colour to nothing, so that a pixel the rasters
 * leave alone keeps no strand of an earlier image.
 */
export const FORWARD_CLEAR_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:ForwardParams;
@group(0) @binding(${B.transmittance}) var transmittanceOut:texture_storage_2d<${HAIR_TRANSMITTANCE_FORMAT},write>;
@group(0) @binding(${B.depth}) var depthOut:texture_storage_2d<${HAIR_ONLY_DEPTH_FORMAT},write>;
@group(0) @binding(${B.coverage}) var coverageOut:texture_storage_2d<${HAIR_COVERAGE_FORMAT},write>;
@group(0) @binding(${B.color}) var colorOut:texture_storage_2d<${FORWARD_COLOR_FORMAT},write>;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn forwardClear(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u){
 let pixel=block.xy*${HAIR_TILE_SIZE}u+local.xy;
 if(any(pixel>=params.size)){return;}
 let at=vec2i(pixel);
 textureStore(transmittanceOut,at,vec4f(1.0,0.0,0.0,0.0));
 textureStore(depthOut,at,vec4f(0.0));
 textureStore(coverageOut,at,vec4f(0.0));
 textureStore(colorOut,at,vec4f(0.0));
}`,
  [FORWARD_PARAMS_WGSL],
)
