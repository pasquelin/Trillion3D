import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { FLATTEN_TILE, GATHER_REACH, TILE_FORMAT } from './motionBlurLayout.ts'
import {
  MOTION_BLUR_PARAMS_WGSL,
  POLAR_TWO_WGSL,
  POLAR_WGSL,
  STREAK_FRAME_WGSL,
} from './motionBlurWgsl.ts'

/** The gathering pass's bindings: the blur's uniform, the tile ranges read and the spread ones
 *  written. */
export const GATHER_BINDINGS = { params: 0, tiles: 1, out: 2 } as const
/** The gathering pass's bindings with two directions: the second largest motions read and written
 *  beside the ranges, and, where the spread was drawn, the ranges it drew, which the pass reads
 *  for each tile's own and leaves as they are (`centre`, in the place of `out`). */
export const GATHER_TWO_BINDINGS = {
  ...GATHER_BINDINGS,
  tilesSecond: 3,
  outSecond: 4,
  centre: 5,
} as const
/** The drawing pass's bindings: the blur's uniform and the tile ranges read. */
export const SCATTER_BINDINGS = { params: 0, tiles: 1 } as const

/** The tile's own place, held to the tiles of motion. */
const OWN_TILE = 'clamp(tile,vec2i(0),count-vec2i(1))'

/** The gathering pass's range written, with one direction. */
const gatherOneBinding = `@group(0) @binding(${GATHER_BINDINGS.out}) var tilesOut:texture_storage_2d<${TILE_FORMAT},write>;
`
/** The gathering pass's bindings but the ranges read, with two directions: the second largest
 *  motions read and written, and the ranges written or, where the spread was `drawn`, read. */
const gatherTwoBindings = (
  drawn: boolean,
) => `@group(0) @binding(${GATHER_TWO_BINDINGS.tilesSecond}) var secondsIn:texture_2d<f32>;
@group(0) @binding(${GATHER_TWO_BINDINGS.outSecond}) var secondsOut:texture_storage_2d<${TILE_FORMAT},write>;
${
  drawn
    ? `@group(0) @binding(${GATHER_TWO_BINDINGS.centre}) var centreIn:texture_2d<f32>;`
    : `@group(0) @binding(${GATHER_TWO_BINDINGS.out}) var tilesOut:texture_storage_2d<${TILE_FORMAT},write>;`
}
`
/** A tile's range and second largest motion reduced with a neighbour whose streak covers it. */
const GATHER_TWO_REDUCE = `    let other=toPolarRange(neighbour);
    second=reduceSecond(range,second,other,toPolar(textureLoad(secondsIn,at,0).xy));
    range=reduceRange(range,other);
`
/** The tile's range, unless it is the drawn one, and second largest motion written. */
const gatherTwoStore = (drawn: boolean) => ` if(all(tile<count)){
${drawn ? '' : '  textureStore(tilesOut,tile,toCartesianRange(range));\n'}  textureStore(secondsOut,tile,vec4f(toCartesian(second),0.0,0.0));
 }
`

/**
 * The spread of each tile's largest motion over the tiles it crosses, read: each tile looks at the
 * tiles within three of it each way, and takes the range of those whose largest motion, laid
 * across their tile as a streak one tile wide, covers it (`tileStreakCovers`), reduced into its own
 * (`reduceRange`) — so a tile beside a fast one is filtered along the fast one's motion. The streak
 * is the tile's motion times `scale.w`, in tiles, its half-width the tile's own half-extent along
 * the motion's axes, held 1 % under so a tile whose edge the streak only touches is left out.
 * A workgroup of `FLATTEN_TILE` tiles a side.
 * With `directions` of 2 the second largest motions are spread as well (`reduceSecond`): each tile
 * takes the second of the tiles it reads, reduced with its own as the ranges are; where the largest
 * motions were drawn (`drawn`) the tile's own range is the drawn one, left as it is, and the pass
 * writes the second motions alone.
 */
export const gatherShader = (directions = 1, drawn = false) => {
  const two = directions > 1
  return wgslProgram(
    `@group(0) @binding(${GATHER_BINDINGS.params}) var<uniform> mb:MotionBlurParams;
@group(0) @binding(${GATHER_BINDINGS.tiles}) var tilesIn:texture_2d<f32>;
${two ? gatherTwoBindings(drawn) : gatherOneBinding}fn tileStreakCovers(neighbour:vec4f,offset:vec2f)->bool{
 let frame=streakFrame(neighbour.zw*mb.scale.w);
 let reach=vec2f(frame.span,0.0)+vec2f(frame.extent*0.99);
 let axis=frame.axis;
 let across=vec2f(dot(axis,offset),dot(vec2f(-axis.y,axis.x),offset));
 return all(abs(across)<reach);
}
@compute @workgroup_size(${FLATTEN_TILE},${FLATTEN_TILE})
fn dilateGather(@builtin(global_invocation_id) gid:vec3u){
 let tile=vec2i(gid.xy);
 let count=vec2i(mb.tiles.xy);
 var range=toPolarRange(textureLoad(${two && drawn ? 'centreIn' : 'tilesIn'},${OWN_TILE},0));
${two ? ` var second=toPolar(textureLoad(secondsIn,${OWN_TILE},0).xy);\n` : ''} for(var x=-${GATHER_REACH};x<=${GATHER_REACH};x++){
  for(var y=-${GATHER_REACH};y<=${GATHER_REACH};y++){
   let at=tile+vec2i(x,y);
   if((x==0&&y==0)||any(at<vec2i(0))||any(at>=count)){continue;}
   let neighbour=textureLoad(tilesIn,at,0);
   if(tileStreakCovers(neighbour,vec2f(f32(x),f32(y)))){
${two ? GATHER_TWO_REDUCE : '    range=reduceRange(range,toPolarRange(neighbour));\n'}   }
  }
 }
${two ? gatherTwoStore(drawn) : ' if(all(tile<count)){textureStore(tilesOut,tile,toCartesianRange(range));}\n'}}`,
    [MOTION_BLUR_PARAMS_WGSL, POLAR_WGSL, STREAK_FRAME_WGSL, ...(two ? [POLAR_TWO_WGSL] : [])],
  )
}

/** The drawing pass's depth ordering and quads per instance: eight quads of two triangles each. */
export const SCATTER_QUADS = 8
/** The vertices of an instance of the drawing pass. */
export const SCATTER_VERTICES = SCATTER_QUADS * 6

/**
 * The spread of each tile's largest motion over the tiles it crosses, drawn: each tile draws a
 * quad as long as its motion and as wide as a tile's extent along it, whose pixels take the tile's
 * range, `SCATTER_QUADS` tiles an instance. A tile whose motion stays within itself — under half a
 * pixel across the tile's whole width — draws its own pixel alone, at the nearest depth. The quad's
 * depth is the length of a motion in tiles over the tiles' width, so the depth test keeps the
 * range with the shorter smallest motion in the first draw (`SCATTER_MAX` unset: depth `less`, all
 * four channels written), and the one with the longer largest in the second (set: depth `greater`,
 * the largest motion's channels alone), which tests against what the first left.
 */
export const scatterShader = () =>
  wgslProgram(
    `override SCATTER_MAX:bool=false;
@group(0) @binding(${SCATTER_BINDINGS.params}) var<uniform> mb:MotionBlurParams;
@group(0) @binding(${SCATTER_BINDINGS.tiles}) var tilesIn:texture_2d<f32>;
struct ScatterVertex{@builtin(position) position:vec4f,@location(0) @interpolate(flat) range:vec4f,}
@vertex
fn scatterVertex(@builtin(vertex_index) vertexId:u32,@builtin(instance_index) instanceId:u32)->ScatterVertex{
 var out:ScatterVertex;
 out.position=vec4f(0.0,0.0,0.0,1.0);
 out.range=vec4f(0.0);
 let quad=instanceId*${SCATTER_QUADS}u+vertexId/6u;
 let slot=vertexId%6u;
 let kind=select(slot,6u-slot,slot>=3u);
 let count=mb.tiles.xy;
 let tile=vec2u(quad%count.x,quad/count.x);
 if(tile.y>=count.y){return out;}
 let corner=vec2f(f32(kind%2u),f32(kind/2u))*2.0-1.0;
 let centre=vec2f(tile)+0.5;
 let range=textureLoad(tilesIn,vec2i(tile),0);
 let streak=range.zw*mb.scale.w;
 let squared=dot(streak,streak);
 var place:vec2f;
 var depth:f32;
 if(squared*256.0<=0.25){
  place=centre+corner*0.5;
  depth=0.0002;
 }else{
  let frame=streakFrame(streak);
  let axis=frame.axis;
  let size=corner*(vec2f(frame.span,0.0)+vec2f(frame.extent*0.99));
  place=centre+axis*size.x+vec2f(-axis.y,axis.x)*size.y;
  depth=clamp(select(length(range.xy*mb.scale.w),frame.span,SCATTER_MAX)/f32(count.x),0.0002,0.999);
 }
 out.position=vec4f(place/vec2f(count)*vec2f(2.0,-2.0)+vec2f(-1.0,1.0),depth,1.0);
 out.range=range;
 return out;
}
@fragment
fn scatterFragment(@location(0) @interpolate(flat) range:vec4f)->@location(0) vec4f{return range;}`,
    [MOTION_BLUR_PARAMS_WGSL, STREAK_FRAME_WGSL],
  )
