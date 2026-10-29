import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_GROUP } from './layout.ts'
import { unpackTile } from './lightSamplerWgsl.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'

const B = SAMPLED_BINDINGS

export const CLEAR_RESOLVED_ENTRY = 'clearResolvedMain'

/** What a pixel that is no lit surface holds in the resolved textures. */
export const RESOLVED_INVALID = -1

/**
 * THE RESOLVED LIGHT OF THE EMPTY TILES CLEARED: one group a tile of the view's empty list, whose pixels the shading never visits, so that they
 * do not keep the light of the image before. Each pixel of the tile inside the view is set to the invalid mark in the diffuse and specular.
 */
export const clearResolvedWgsl = () =>
  wgslProgram(
    `
override TILE_MODE:u32=0u;
@group(0) @binding(${B.tileAllocator}) var<storage,read> tileAllocator:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read> tileData:array<u32>;
@group(0) @binding(${B.resolvedDiffuse}) var resolvedDiffuse:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${B.resolvedSpecular}) var resolvedSpecular:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${CLEAR_RESOLVED_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 if(group.x>=tileAllocator[TILE_MODE]){return;}
 let screen=unpackTile(tileData[TILE_MODE*params.stride+group.x])*${SAMPLED_GROUP}u+lane.xy;
 if(all(screen<textureDimensions(resolvedDiffuse))){
  textureStore(resolvedDiffuse,vec2i(screen),vec4f(${RESOLVED_INVALID}.0));
  textureStore(resolvedSpecular,vec2i(screen),vec4f(${RESOLVED_INVALID}.0));
 }
}`,
    [SAMPLED_PARAMS_WGSL, unpackTile],
  )
