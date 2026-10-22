import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { INVERSE_TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { TAA_VIEW_WGSL } from '../../taa/bindingsWgsl.ts'
import { DEPTH_WGSL } from '../../taa/depthWgsl.ts'
import { CAMERA_MOTION_WGSL } from '../../taa/nearestSurfaceWgsl.ts'
import { REPROJECTION_VECTOR_WGSL } from '../../taa/velocityWgsl.ts'
import { CENTIMETRES_PER_UNIT, FLAT_FORMAT, FLATTEN_TILE, TILE_FORMAT } from './motionBlurLayout.ts'
import {
  FLAT_PACK_WGSL,
  MOTION_BLUR_PARAMS_WGSL,
  POLAR_TWO_WGSL,
  POLAR_WGSL,
} from './motionBlurWgsl.ts'

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
@group(0) @binding(${FLATTEN_BINDINGS.flat}) var flatOut:texture_storage_2d<${FLAT_FORMAT},write>;
@group(0) @binding(${FLATTEN_BINDINGS.tiles}) var tileOut:texture_storage_2d<${TILE_FORMAT},write>;
var<workgroup> ranges:array<vec4f,${FLATTEN_TILE * FLATTEN_TILE}>;`,
)

/** What the flattening keeps with two directions: the image of the tiles' second largest motions
 *  written, and the second largest of each lane in workgroup memory. */
const FLATTEN_SECOND_WGSL = wgslBlock(
  'FLATTEN_SECOND_WGSL',
  [FLATTEN_INPUTS_WGSL],
  `
@group(0) @binding(${FLATTEN_TWO_BINDINGS.tilesSecond}) var tileSecondOut:texture_storage_2d<${TILE_FORMAT},write>;
var<workgroup> seconds:array<vec2f,${FLATTEN_TILE * FLATTEN_TILE}>;`,
)

/** A lane's range reduced with the one `reach` lanes on, with one direction or with two. */
const REDUCE_ONE = 'ranges[lane]=reduceRange(ranges[lane],ranges[lane+reach]);'
const REDUCE_TWO = `
   seconds[lane]=reduceSecond(ranges[lane],seconds[lane],ranges[lane+reach],seconds[lane+reach]);
   ${REDUCE_ONE}
  `

/** The helpers of the flattening: the depth of a texel, the corner of its 3×3 that is nearest, and
 *  the motion the camera alone gives it. */
const FLATTEN_HELPERS_WGSL = wgslBlock(
  'FLATTEN_HELPERS_WGSL',
  [FLATTEN_INPUTS_WGSL, REPROJECTION_VECTOR_WGSL, CAMERA_MOTION_WGSL],
  `
fn depthAt(p:vec2i)->f32{
 if(any(p<vec2i(0))||any(p>=vec2i(mb.grid))){return 0.0;}
 return textureLoad(depthTexture,p,0);
}
fn nearestOffset(pixel:vec2i)->vec2i{
 let d0=depthAt(pixel+vec2i(-1,-1));let d1=depthAt(pixel+vec2i(1,-1));
 let d2=depthAt(pixel+vec2i(-1,1));let d3=depthAt(pixel+vec2i(1,1));
 var offset=vec2i(1);
 var offsetTop=1;
 if(d0>d1){offsetTop=-1;}
 if(d2>d3){offset.x=-1;}
 if(max(d0,d1)>max(d2,d3)){offset.y=-1;offset.x=offsetTop;}
 return offset;
}
fn cameraMotion(p:vec2i,z:f32)->vec2f{
 let v=cameraOnlyMotion(screenOfTexel(p),z);
 return select(v,v*z,view.radius.w!=0.0);
}`,
)

/**
 * The motion of each render texel, flattened — once per texel, a workgroup to a tile of
 * `FLATTEN_TILE` texels each way:
 * - the nearest of the four texels at the corners of the texel's 3×3, by depth (`nearestOffset`), supplies its
 *   motion and its depth, so a foreground's outline is blurred by the foreground's own motion
 *   against a background that moves differently; a corner past the image reads a depth of zero,
 *   the farthest;
 * - the motion is the temporal pass's vector of that texel, scaled to pixels of the colour image
 *   times the blur's amount, half of the streak a side, and the camera's own motion taken out when
 *   the blur is to follow what moves in the scene alone (`knobs.w`); a view cut, whose history
 *   describes nothing, has none;
 * - its length is held to the longest streak (`scale.z`);
 * - the texel keeps its length, its angle (`0` to `1` round the circle) and its depth, in
 *   centimetres, in one word of three small floats (`packFlat`);
 * - the tile keeps the largest and the smallest of its texels' motions, reduced in workgroup memory
 *   by halving the lanes, each step keeping the longer largest and the shorter smallest
 *   (`reduceRange`);
 * - with `directions` of 2, the tile keeps beside them a second largest motion — a texel's is
 *   none —, reduced with them (`reduceSecond`) and written to an image of its own.
 */
export const flattenShader = (directions = 1) => {
  const two = directions > 1
  return wgslProgram(
    `@compute @workgroup_size(${FLATTEN_TILE},${FLATTEN_TILE})
fn flattenMotion(@builtin(workgroup_id) wg:vec3u,@builtin(global_invocation_id) gid:vec3u,@builtin(local_invocation_index) lane:u32){
 let last=vec2i(mb.grid)-vec2i(1);
 let pixel=min(vec2i(gid.xy),last);
 let nearest=clamp(pixel+nearestOffset(pixel),vec2i(0),last);
 let z=textureLoad(depthTexture,nearest,0);
 var v=decodeVector(textureLoad(vectors,nearest,0).r);
 if(mb.knobs.w!=0.0){v=v-cameraMotion(pixel,z);}
 if(view.params.x!=0.0){v=vec2f(0.0);}
 var polar=toPolar(v*mb.scale.xy);
 polar.x=min(polar.x,mb.scale.z);
 ranges[lane]=vec4f(polar,polar);
${two ? ' seconds[lane]=vec2f(0.0);\n' : ''} workgroupBarrier();
 for(var reach=${(FLATTEN_TILE * FLATTEN_TILE) / 2}u;reach>0u;reach=reach>>1u){
  if(lane<reach){${two ? REDUCE_TWO : REDUCE_ONE}}
  workgroupBarrier();
 }
 textureStore(flatOut,pixel,vec4u(packFlat(polar.x,polar.y*INVERSE_TWO_PI+0.5,sceneDepthOf(z)*${CENTIMETRES_PER_UNIT}.0),0u,0u,0u));
 if(lane==0u){
  let range=toCartesianRange(ranges[0]);
  textureStore(tileOut,vec2i(wg.xy),range);
${two ? '  textureStore(tileSecondOut,vec2i(wg.xy),vec4f(toCartesian(seconds[0]),0.0,0.0));\n' : ''} }
}`,
    [
      FLATTEN_HELPERS_WGSL,
      POLAR_WGSL,
      DEPTH_WGSL,
      REPROJECTION_VECTOR_WGSL,
      FLAT_PACK_WGSL,
      INVERSE_TWO_PI,
      ...(two ? [FLATTEN_SECOND_WGSL, POLAR_TWO_WGSL] : []),
    ],
  )
}
