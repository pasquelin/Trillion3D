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
 * point of a mesh's volume (`dfshObjectPoint`, from the volume-to-world rows of its record).
 */
export const DFSH_COMMON_WGSL = wgslBlock(
  'DFSH_COMMON_WGSL',
  [unprojectPoint, DOUBLE_FLOAT_WGSL],
  `${wgslConsts({
    DFSH_FAR_MESHES: DFSH_FLAG.farMeshes,
    FLAG_CAST_SHADOW: OBJECT_FLAGS.castShadow,
    FLAG_VISIBLE: OBJECT_FLAGS.visible,
    FLAG_FAR_TESTED: OBJECT_FLAGS.farTested,
    FLAG_FAR_TESTABLE: OBJECT_FLAGS.farTestable,
    FLAG_CASTS_FAR: OBJECT_FLAGS.castsFar,
    DF_MAX_MIPS: DISTANCE_FIELD_MIPS,
  })}
${DFSH_PARAMS.wgsl}
@group(0) @binding(${DFSH_BINDING.params}) var<uniform> dfsh:DfshParams;
fn dfshDepthCm(z:f32)->f32{
 let distance=select(dfsh.depth.y+(1.0-z)*dfsh.depth.x,dfsh.depth.x/max(z,1e-30),dfsh.depth.z>0.5);
 return min(distance*100.0,3.4e38);
}
fn dfshPosition(ndc:vec2f,z:f32)->vec3f{return unprojectPoint(dfsh.unproject,vec3f(ndc,z));}
fn dfshShadowSpace(p:vec3f)->vec3f{return (dfsh.toShadow*vec4f(p,1.0)).xyz;}
fn dfshWorld(p:vec3f)->DfVec3{return DfVec3(dfsh.eyeHigh.xyz,dfsh.eyeLow.xyz+p);}
fn dfshFromEye(p:DfVec3)->vec3f{return dfAddDemote(p,DfVec3(-dfsh.eyeHigh.xyz,-dfsh.eyeLow.xyz));}
fn dfshTileOf(p:vec3f)->vec2i{
 let s=dfshShadowSpace(p).xy*0.5+vec2f(0.5);
 let side=f32(dfsh.tiles.x);
 let t=vec2f(s.x,1.0-s.y)*side;
 return select(vec2i(-1),vec2i(t),all(t>=vec2f(0.0))&&all(t<vec2f(side)));
}`,
)
