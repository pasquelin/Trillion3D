import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { lightingCommonWgsl, lightingLayersWgsl, surfaceTexelWgsl } from './commonWgsl.ts'

/**
 * THE DEPTH RANGE OF EACH TILE of the direct update's list, before the lights are culled to it: a workgroup a tile, a
 * thread a texel, which takes the least and the greatest depth of the texels that hold a surface and writes them as the
 * two half floats of a word of the tile's own (`packedDepthRange`: the sentinels `0xffffffff` and 0 where none is read give 0 and 1;
 * so does a greatest of 0). The cull of the lights reads the word (`cullWgsl.ts`) to bound the tile's box; it is
 * dispatched only where `surfaceCacheDirectLightingCullToTileDepthRange` is on.
 *
 * Bindings: 0 the parameters, 1 the tables, 2 the context, 3 and 4 the depth and normal layers, 5 the words of the
 * tiles, written.
 */

export const TILE_DEPTH_RANGE_ENTRY = 'tileDepthRanges'

export const TILE_DEPTH_RANGE_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  ranges: 5,
} as const

const B = TILE_DEPTH_RANGE_BINDINGS

/** The tile's depth range as a word, from the bits of the least and the greatest depth of its texels: each rounded to a half float, the least in the
 *  low half. */
const PACKED_DEPTH_RANGE_WGSL = wgslBlock(
  'LIGHTING_PACKED_DEPTH_RANGE_WGSL',
  [],
  `fn packedDepthRange(lowest:u32,highest:u32)->u32{
 return pack2x16float(vec2f(select(bitcast<f32>(lowest),0.0,lowest==0xffffffffu),select(bitcast<f32>(highest),1.0,highest==0u)));
}`,
)

/** The program: a workgroup a tile of the direct update's list. */
export const TILE_DEPTH_RANGE_WGSL = wgslProgram(
  `@group(0) @binding(${B.ranges}) var<storage,read_write> depthRanges:array<u32>;
var<workgroup> depthRange:array<atomic<u32>,2>;
@compute @workgroup_size(8,8,1)
fn ${TILE_DEPTH_RANGE_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_id) at:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=flatGroup(group,n);
 if(tile>=ctxListed(LG_LIST_DIRECT)){return;}
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 if(lane==0u){atomicStore(&depthRange[0],0xffffffffu);atomicStore(&depthRange[1],0u);}
 workgroupBarrier();
 let texel=surfaceTexel(page,coord*LG_TILE+at.xy);
 if(texel.valid){
  let depth=f32(texDepth(texel.atlas)&0xffffu)/65535.0;
  atomicMin(&depthRange[0],bitcast<u32>(depth));
  atomicMax(&depthRange[1],bitcast<u32>(depth));
 }
 workgroupBarrier();
 if(lane==0u){depthRanges[tile]=packedDepthRange(atomicLoad(&depthRange[0]),atomicLoad(&depthRange[1]));}
}`,
  [
    lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
    surfaceTexelWgsl(lightingLayersWgsl(B.depth, B.normal)),
    PACKED_DEPTH_RANGE_WGSL,
  ],
)
