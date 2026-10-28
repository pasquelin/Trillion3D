import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { DISTANCE_FIELD_MIPS } from '../../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { DOUBLE_FLOAT_WGSL } from '../doubleFloatWgsl.ts'
import { OBJECT_FLAGS } from '../layout.ts'
import { DFSH_BINDING, DFSH_FLAG, DFSH_PARAMS } from './layout.ts'

/**
 * WHAT EVERY PASS OF THE SUN'S DISTANCE-FIELD SHADOW DECLARES: its uniform (`dfsh`, `DFSH_PARAMS`), the
 * depth as a distance in centimetres, the position of a pixel from the eye, a position's place in the
 * shadow space and in the grid of tiles the meshes are listed in (`dfshTileOf`: none outside it, the
 * tile whose rows run down as the draw's do), a mesh's centre from the eye, and the position of a
 * point of a mesh's volume (`dfshObjectPoint`, from the volume-to-world rows of its record). A tile's
 * list lies where the start offsets say when the lists are compacted, else at the place the tile has
 * (`dfshTileStart`), and holds at most what is left of the room after that start, or the place
 * (`dfshTileRoom`).
 */
/**
 * The declarations in the bind group `group` (0 for the cascade's own passes; the cards' direct light reads them from another). With
 * `suns` of 1 or more, the binding holds that many blocks, one a sun, and `dfsh` is a private copy the reader sets to the sun it traces for
 * (`dfshSuns[k]`), so that every function below reads the sun it was set to.
 */
export const dfshCommonWgsl = (group = 0, suns = 0) =>
  wgslBlock(
    `DFSH_COMMON_WGSL ${group} ${suns}`,
    [unprojectPoint, DOUBLE_FLOAT_WGSL],
    `${wgslConsts({
      DFSH_SUBSAMPLE_DEPTH: DFSH_FLAG.subsampleDepth,
      DFSH_COMPACT_TILES: DFSH_FLAG.compactTiles,
      DFSH_CLUSTER_MESHES: DFSH_FLAG.clusterMeshes,
      FLAG_CAST_SHADOW: OBJECT_FLAGS.castShadow,
      FLAG_VIRTUALIZED: OBJECT_FLAGS.virtualized,
      DF_MAX_MIPS: DISTANCE_FIELD_MIPS,
    })}
${DFSH_PARAMS.wgsl}
${
  suns > 0
    ? `@group(${group}) @binding(${DFSH_BINDING.params}) var<uniform> dfshSuns:array<DfshParams,${suns}>;
var<private> dfsh:DfshParams;`
    : `@group(${group}) @binding(${DFSH_BINDING.params}) var<uniform> dfsh:DfshParams;`
}
fn dfshDepthCm(z:f32)->f32{
 let distance=select(dfsh.depth.y+(1.0-z)*dfsh.depth.x,dfsh.depth.x/max(z,1e-30),dfsh.depth.z>0.5);
 return min(distance*100.0,3.4e38);
}
fn dfshPosition(ndc:vec2f,z:f32)->vec3f{return unprojectPoint(dfsh.unproject,vec3f(ndc,z));}
fn dfshShadowSpace(p:vec3f)->vec3f{return (dfsh.toShadow*vec4f(p,1.0)).xyz;}
fn dfshWorld(p:vec3f)->DfVec3{return DfVec3(dfsh.eyeHigh.xyz,dfsh.eyeLow.xyz+p);}
fn dfshFromEye(p:DfVec3)->vec3f{return dfAddDemote(p,DfVec3(-dfsh.eyeHigh.xyz,-dfsh.eyeLow.xyz));}
fn dfshTileStart(tile:u32,offset:u32)->u32{
 return select(tile*dfsh.tiles.w,offset,(dfsh.counts.w&DFSH_COMPACT_TILES)!=0u);
}
fn dfshTileRoom(start:u32)->u32{
 return select(dfsh.tiles.w,dfsh.tiles.y-min(start,dfsh.tiles.y),(dfsh.counts.w&DFSH_COMPACT_TILES)!=0u);
}
fn dfshTileOf(p:vec3f)->vec2i{
 let s=dfshShadowSpace(p).xy*0.5+vec2f(0.5);
 let side=f32(dfsh.tiles.x);
 let t=vec2f(s.x,1.0-s.y)*side;
 return select(vec2i(-1),vec2i(t),all(t>=vec2f(0.0))&&all(t<vec2f(side)));
}`,
  )

export const DFSH_COMMON_WGSL = dfshCommonWgsl(0)
