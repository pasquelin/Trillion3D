import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { type WgslDecl, wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { INVERSE_TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { workgroupSumLoop } from '../../../gpu/core/workgroupSumWgsl.ts'
import { TAA_VIEW_WGSL } from '../../taa/bindingsWgsl.ts'
import { DEPTH_WGSL } from '../../taa/depthWgsl.ts'
import { NEAREST_CORNER_WGSL } from '../../taa/nearestCornerWgsl.ts'
import { CAMERA_MOTION_WGSL } from '../../taa/nearestSurfaceWgsl.ts'
import { REPROJECTION_VECTOR_WGSL } from '../../taa/velocityWgsl.ts'
import { FLAT_FORMS, FLATTEN_TILE, TILE_FORMAT, type FlatForm } from './motionBlurLayout.ts'
import { MOTION_BLUR_PARAMS_WGSL, POLAR_TWO_WGSL, POLAR_WGSL } from './motionBlurWgsl.ts'

/** The flattening pass's bindings: the blur's uniform, the temporal pass's, the motion of each
 *  render texel and the depth, the flattened motion and the tile ranges written. */
export const FLATTEN_BINDINGS = {
  params: 0,
  view: 1,
  vectors: 2,
  depth: 3,
  flat: 4,
  tiles: 5,
} as const
/** The bindings with two directions: the image of the second largest motions beside the ranges'. */
export const FLATTEN_TWO_BINDINGS = { ...FLATTEN_BINDINGS, tilesSecond: 6 } as const

/** What the flattening reads and writes, and the workgroup's ranges it reduces. */
const FLATTEN_INPUTS_WGSL = wgslBlock(
  'FLATTEN_INPUTS_WGSL',
  [MOTION_BLUR_PARAMS_WGSL, TAA_VIEW_WGSL],
  `
@group(0) @binding(${FLATTEN_BINDINGS.params}) var<uniform> mb:MotionBlurParams;
@group(0) @binding(${FLATTEN_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${FLATTEN_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${FLATTEN_BINDINGS.depth}) var depthTexture:texture_depth_2d;
@group(0) @binding(${FLATTEN_BINDINGS.tiles}) var tileOut:texture_storage_2d<${TILE_FORMAT},write>;
var<workgroup> ranges:array<vec4f,${FLATTEN_TILE * FLATTEN_TILE}>;`,
)

/** The flattened motion's store, in the form of its texture (`FlatForm`): `storeFlat` writes the
 *  `(length, angle, depth)` of a texel — packed in one word of three small floats, the engine's one
 *  pack of the 11-11-10 format (`packLight`), or as they are. */
const FLAT_STORE_WGSL: Record<FlatForm, WgslDecl> = {
  packed: wgslBlock(
    'FLAT_STORE_PACKED_WGSL',
    [packLight],
    `
@group(0) @binding(${FLATTEN_BINDINGS.flat}) var flatOut:texture_storage_2d<${FLAT_FORMS.packed.format},write>;
fn storeFlat(at:vec2i,motion:vec3f){textureStore(flatOut,at,vec4u(packLight(motion),0u,0u,0u));}`,
  ),
  float: wgslBlock(
    'FLAT_STORE_FLOAT_WGSL',
    [],
    `
@group(0) @binding(${FLATTEN_BINDINGS.flat}) var flatOut:texture_storage_2d<${FLAT_FORMS.float.format},write>;
fn storeFlat(at:vec2i,motion:vec3f){textureStore(flatOut,at,vec4f(motion,0.0));}`,
  ),
}

/** What the flattening keeps with two directions: the image of the tiles' second largest motions
 *  written, and the second largest of each lane in workgroup memory. */
const FLATTEN_SECOND_WGSL = wgslBlock(
  'FLATTEN_SECOND_WGSL',
  [FLATTEN_INPUTS_WGSL],
  `
@group(0) @binding(${FLATTEN_TWO_BINDINGS.tilesSecond}) var tileSecondOut:texture_storage_2d<${TILE_FORMAT},write>;
var<workgroup> seconds:array<vec2f,${FLATTEN_TILE * FLATTEN_TILE}>;`,
)

/** A lane's range reduced with the one `stride` lanes on, with one direction or with two. */
const REDUCE_ONE = 'ranges[lane]=reduceRange(ranges[lane],ranges[lane+stride]);'
const REDUCE_TWO = `
   seconds[lane]=reduceSecond(ranges[lane],seconds[lane],ranges[lane+stride],seconds[lane+stride]);
   ${REDUCE_ONE}
  `

/** The helpers of the flattening: the depth of a texel, the corner of its 3×3 that is nearest, and
 *  the motion the camera alone gives a texel at a depth, as a still surface there moves. */
const FLATTEN_HELPERS_WGSL = wgslBlock(
  'FLATTEN_HELPERS_WGSL',
  [FLATTEN_INPUTS_WGSL, REPROJECTION_VECTOR_WGSL, CAMERA_MOTION_WGSL, NEAREST_CORNER_WGSL],
  `
fn depthAt(p:vec2i)->f32{
 if(any(p<vec2i(0))||any(p>=vec2i(mb.grid))){return 0.0;}
 return textureLoad(depthTexture,p,0);
}
fn nearestOffset(pixel:vec2i)->vec2i{
 return nearestCorner(depthAt(pixel+vec2i(-1,-1)),depthAt(pixel+vec2i(1,-1)),depthAt(pixel+vec2i(-1,1)),depthAt(pixel+vec2i(1,1)));
}
fn cameraMotion(p:vec2i,z:f32)->vec2f{
 let v=cameraOnlyMotion(screenOfTexel(p),z);
 return select(v,v*z,view.radius.w!=0.0);
}
fn cornerMotion(pixel:vec2i,nearest:vec2i)->vec3f{
 let z=textureLoad(depthTexture,nearest,0);
 let still=cameraMotion(pixel,z);
 let word=textureLoad(vectors,nearest,0).r;
 var v=select(still,decodeVector(word),hasOwnMotion(word));
 if(mb.knobs.w!=0.0){v=v-still;}
 if(view.params.x!=0.0){v=vec2f(0.0);}
 return vec3f(v,z);
}`,
)

/**
 * The motion of each render texel, flattened — once per texel, a workgroup to a tile of
 * `FLATTEN_TILE` texels each way:
 * - the nearest of the four texels at the corners of the texel's 3×3, by depth (`nearestOffset`), supplies its
 *   motion and its depth, so a foreground's outline is blurred by the foreground's own motion
 *   against a background that moves differently; a corner past the image reads a depth of zero,
 *   the farthest;
 * - the motion is that of the surface at the corner texel (`cornerMotion`), read from the velocity
 *   stage's word there where that surface moves by itself (`hasOwnMotion`); a surface that does not
 *   move by itself has the motion the camera gives the texel, at the corner's depth (`cameraMotion`:
 *   under an orthographic projection, held down by the depth). The velocity stage's word is read as
 *   it is, never dilated: the pass takes the corner's by its own rule. The camera's motion is taken
 *   out where the blur is to follow what moves in the scene alone (`knobs.w`), the texel's own, by
 *   the same depth, so a still surface has none left; a view cut, whose history describes nothing,
 *   has none;
 * - the motion is scaled to pixels of the colour image times the blur's amount, half of the streak a
 *   side, and its length held to the longest streak (`scale.z`);
 * - the texel keeps its length, its angle (`0` to `1` round the circle) and its depth, in centimetres,
 *   in the texture of its form (`FlatForm`, `storeFlat`);
 * - the tile keeps the largest and the smallest of its texels' motions, reduced in workgroup memory
 *   by halving the lanes, each step keeping the longer largest and the shorter smallest
 *   (`reduceRange`);
 * - with `directions` of 2, the tile keeps beside them a second largest motion — a texel's is
 *   none —, reduced with them (`reduceSecond`) and written to an image of its own.
 */
export const flattenShader = (directions = 1, flat: FlatForm = 'packed') => {
  const two = directions > 1
  return wgslProgram(
    `@compute @workgroup_size(${FLATTEN_TILE},${FLATTEN_TILE})
fn flattenMotion(@builtin(workgroup_id) wg:vec3u,@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) lane:u32){
 let last=vec2i(mb.grid)-vec2i(1);
 let pixel=min(vec2i(gid.xy),last);
 let nearest=clamp(pixel+nearestOffset(pixel),vec2i(0),last);
 let corner=cornerMotion(pixel,nearest);
 var polar=toPolar(corner.xy*mb.scale.xy);
 polar.x=min(polar.x,mb.scale.z);
 ranges[lane]=vec4f(polar,polar);
${two ? ' seconds[lane]=vec2f(0.0);\n' : ''} ${workgroupSumLoop(FLATTEN_TILE * FLATTEN_TILE, `\n  ${two ? REDUCE_TWO : REDUCE_ONE}\n `)}
 storeFlat(pixel,vec3f(polar.x,polar.y*INVERSE_TWO_PI+0.5,sceneDepthOf(corner.z)*${CENTIMETRES_PER_METRE}.0));
 if(lane==0u){
  let range=toCartesianRange(ranges[0]);
  textureStore(tileOut,vec2i(wg.xy),range);
${two ? '  textureStore(tileSecondOut,vec2i(wg.xy),vec4f(toCartesian(seconds[0]),0.0,0.0));\n' : ''} }
}`,
    [
      FLATTEN_HELPERS_WGSL,
      FLAT_STORE_WGSL[flat],
      POLAR_WGSL,
      DEPTH_WGSL,
      REPROJECTION_VECTOR_WGSL,
      INVERSE_TWO_PI,
      ...(two ? [FLATTEN_SECOND_WGSL, POLAR_TWO_WGSL] : []),
    ],
  )
}
