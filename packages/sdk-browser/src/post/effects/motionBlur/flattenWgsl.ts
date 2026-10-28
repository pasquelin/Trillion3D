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

/** Where a flattening names the blur's uniform and the images it writes: its own pass's
 *  (`FLATTEN_SLOTS`), or the nearest velocity's, which flattens the motion where it dilates it
 *  (`FUSED_FLATTEN_SLOTS`, `nearestVelocityWgsl.ts`). */
export interface FlattenSlots {
  readonly params: number
  readonly flat: number
  readonly tiles: number
  readonly tilesSecond: number
}
const FLATTEN_SLOTS: FlattenSlots = {
  params: FLATTEN_BINDINGS.params,
  flat: FLATTEN_BINDINGS.flat,
  tiles: FLATTEN_BINDINGS.tiles,
  tilesSecond: FLATTEN_TWO_BINDINGS.tilesSecond,
}
export const FUSED_FLATTEN_SLOTS: FlattenSlots = {
  params: 30,
  flat: 31,
  tiles: 32,
  tilesSecond: 33,
}

/** What the flattening reads of the frame in its own pass, and the temporal pass's uniform. */
const FLATTEN_INPUTS_WGSL = wgslBlock(
  'FLATTEN_INPUTS_WGSL',
  [TAA_VIEW_WGSL],
  `
@group(0) @binding(${FLATTEN_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${FLATTEN_BINDINGS.vectors}) var vectors:texture_2d<u32>;
@group(0) @binding(${FLATTEN_BINDINGS.depth}) var depthTexture:texture_depth_2d;`,
)

/** The flattened motion's store, in the form of its texture (`FlatForm`): `storeFlat` writes the
 *  `(length, angle, depth)` of a texel — packed in one word of three small floats, the engine's one
 *  pack of the 11-11-10 format (`packLight`), or as they are. */
const FLAT_STORE_WGSL = (slots: FlattenSlots, flat: FlatForm): WgslDecl =>
  flat === 'packed'
    ? wgslBlock(
        `FLAT_STORE_PACKED_WGSL(${slots.flat})`,
        [packLight],
        `
@group(0) @binding(${slots.flat}) var flatOut:texture_storage_2d<${FLAT_FORMS.packed.format},write>;
fn storeFlat(at:vec2i,motion:vec3f){textureStore(flatOut,at,vec4u(packLight(motion),0u,0u,0u));}`,
      )
    : wgslBlock(
        `FLAT_STORE_FLOAT_WGSL(${slots.flat})`,
        [],
        `
@group(0) @binding(${slots.flat}) var flatOut:texture_storage_2d<${FLAT_FORMS.float.format},write>;
fn storeFlat(at:vec2i,motion:vec3f){textureStore(flatOut,at,vec4f(motion,0.0));}`,
      )

/** One declaration of each kind of what a flattening names, made once: the programs that name it
 *  share it (`wgslBlock` names are per program). */
const made = new Map<string, WgslDecl>()
const once = (key: string, make: () => WgslDecl) => {
  let decl = made.get(key)
  if (!decl) made.set(key, (decl = make()))
  return decl
}

/** The blur's uniform `mb`, at the binding of `slots`. */
export const flattenParams = (slots: FlattenSlots) =>
  once(`params ${slots.params}`, () =>
    wgslBlock(
      `FLATTEN_PARAMS_WGSL(${slots.params})`,
      [MOTION_BLUR_PARAMS_WGSL],
      `@group(0) @binding(${slots.params}) var<uniform> mb:MotionBlurParams;`,
    ),
  )

/**
 * What a flattening writes and reduces in, in the forms `slots`, `flat` and `two` (the directions)
 * ask for: the flattened motion's store (`storeFlat`), the image of the tile ranges written and the
 * workgroup's ranges it reduces — and, with two directions, the image of the tiles' second largest
 * motions and the second largest of each lane in workgroup memory.
 */
export const flattenOutputs = (slots: FlattenSlots, flat: FlatForm, two: boolean) =>
  once(`outputs ${slots.flat}/${slots.tiles}/${slots.tilesSecond} ${flat} ${two}`, () =>
    wgslBlock(
      `FLATTEN_OUTPUTS_WGSL(${slots.flat}/${slots.tiles}/${slots.tilesSecond} ${flat} ${two})`,
      [FLAT_STORE_WGSL(slots, flat), POLAR_WGSL, ...(two ? [POLAR_TWO_WGSL] : [])],
      `
@group(0) @binding(${slots.tiles}) var tileOut:texture_storage_2d<${TILE_FORMAT},write>;
var<workgroup> ranges:array<vec4f,${FLATTEN_TILE * FLATTEN_TILE}>;${
        two
          ? `
@group(0) @binding(${slots.tilesSecond}) var tileSecondOut:texture_storage_2d<${TILE_FORMAT},write>;
var<workgroup> seconds:array<vec2f,${FLATTEN_TILE * FLATTEN_TILE}>;`
          : ''
      }`,
    ),
  )

/** A lane's range reduced with the one `stride` lanes on, with one direction or with two. */
const REDUCE_ONE = 'ranges[lane]=reduceRange(ranges[lane],ranges[lane+stride]);'
const REDUCE_TWO = `
   seconds[lane]=reduceSecond(ranges[lane],seconds[lane],ranges[lane+stride],seconds[lane+stride]);
   ${REDUCE_ONE}
  `

/**
 * The reduction of a flattening, the statements of its entry after `polar`, the texel's motion as
 * its length and angle in pixels, is known: the lane's range into the workgroup's, reduced by
 * halving the lanes — each step keeping the longer largest and the shorter smallest
 * (`reduceRange`), with two directions the second largest beside them (`reduceSecond`) —, `store`
 * the texel's own store, after the barriers, and the tile's range written by its first lane. The
 * entry names `lane`, its index in the workgroup, and `wg`, the workgroup's id, and runs these from
 * uniform control flow: every lane of the tile reaches the barriers.
 */
export const flattenReduction = (two: boolean, store: string) => `ranges[lane]=vec4f(polar,polar);
${two ? ' seconds[lane]=vec2f(0.0);\n' : ''} ${workgroupSumLoop(FLATTEN_TILE * FLATTEN_TILE, `\n  ${two ? REDUCE_TWO : REDUCE_ONE}\n `)}
 ${store}
 if(lane==0u){
  let range=toCartesianRange(ranges[0]);
  textureStore(tileOut,vec2i(wg.xy),range);
${two ? '  textureStore(tileSecondOut,vec2i(wg.xy),vec4f(toCartesian(seconds[0]),0.0,0.0));\n' : ''} }`

/** The flattened texel of the motion `polar` — its length, its angle — at the scene depth `depth`,
 *  in metres, as `storeFlat` writes it: the angle `0` to `1` round the circle, the depth in
 *  centimetres. */
export const flatTexel = (depth: string) =>
  `vec3f(polar.x,polar.y*INVERSE_TWO_PI+0.5,${depth}*${CENTIMETRES_PER_METRE}.0)`

/** The motion the camera alone gives a texel at a depth, as a still surface there moves, in the
 *  units of the velocity stage's words: under an orthographic projection held down by the depth. */
export const STILL_MOTION_WGSL = wgslBlock(
  'STILL_MOTION_WGSL',
  [TAA_VIEW_WGSL, CAMERA_MOTION_WGSL],
  `
fn stillMotion(p:vec2i,z:f32)->vec2f{
 let v=cameraOnlyMotion(screenOfTexel(p),z);
 return select(v,v*z,view.radius.w!=0.0);
}`,
)

/** The helpers of the flattening of its own pass: the depth of a texel, the corner of its 3×3 that
 *  is nearest, and the motion of the surface at that corner. */
const FLATTEN_HELPERS_WGSL = wgslBlock(
  'FLATTEN_HELPERS_WGSL',
  [
    FLATTEN_INPUTS_WGSL,
    flattenParams(FLATTEN_SLOTS),
    REPROJECTION_VECTOR_WGSL,
    STILL_MOTION_WGSL,
    NEAREST_CORNER_WGSL,
  ],
  `
fn depthAt(p:vec2i)->f32{
 if(any(p<vec2i(0))||any(p>=vec2i(mb.grid))){return 0.0;}
 return textureLoad(depthTexture,p,0);
}
fn nearestOffset(pixel:vec2i)->vec2i{
 return nearestCorner(depthAt(pixel+vec2i(-1,-1)),depthAt(pixel+vec2i(1,-1)),depthAt(pixel+vec2i(-1,1)),depthAt(pixel+vec2i(1,1)));
}
fn cornerMotion(pixel:vec2i,nearest:vec2i)->vec3f{
 let z=textureLoad(depthTexture,nearest,0);
 let still=stillMotion(pixel,z);
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
 *   move by itself has the motion the camera gives the texel, at the corner's depth (`stillMotion`:
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
 ${flattenReduction(two, `storeFlat(pixel,${flatTexel('sceneDepthOf(corner.z)')});`)}
}`,
    [
      FLATTEN_HELPERS_WGSL,
      flattenOutputs(FLATTEN_SLOTS, flat, two),
      DEPTH_WGSL,
      REPROJECTION_VECTOR_WGSL,
      INVERSE_TWO_PI,
    ],
  )
}
