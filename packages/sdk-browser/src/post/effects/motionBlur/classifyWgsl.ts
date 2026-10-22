import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import {
  FILTER_TILE,
  TILE_CLASSES,
  TILE_CLASSES_TWO,
  TWO_MOTION_CLASS,
  tileClasses,
  type TileClass,
} from './motionBlurLayout.ts'
import { MOTION_BLUR_PARAMS_WGSL } from './motionBlurWgsl.ts'

/** The pixels a motion must cross for a pixel to be blurred at all: under half a pixel, in
 *  length, the motion is none, and the classes that gather it leave the pixel as it is. */
export const LEAST_STREAK_PIXELS = 0.5

/** The classifying pass's bindings: the blur's uniform, the tile ranges read, and the list of each class's
 *  tiles written (`TILE_CLASSES`). */
export const CLASSIFY_BINDINGS = {
  params: 0,
  tiles: 1,
  gatherHalf: 2,
  gatherFull: 3,
  weighHalf: 4,
  weighFull: 5,
} as const satisfies Record<'params' | 'tiles' | (typeof TILE_CLASSES)[number], number>
/** The bindings with two directions: the image of the second largest motions read, and the list of
 *  the class of two motions beside the others. */
export const CLASSIFY_TWO_BINDINGS = {
  ...CLASSIFY_BINDINGS,
  tilesSecond: 6,
  [TWO_MOTION_CLASS]: 7,
} as const

/** The class `name`'s list as the classifying pass declares it: appended to (`<name>Append`), a
 *  tile's two coordinates in the halves of an entry. */
const classList = (name: TileClass) =>
  listWgsl({ name, group: 0, binding: CLASSIFY_TWO_BINDINGS[name], entry: 'u32', append: true })

/** A function over the `classes` that is one of the lists' `body`, by a switch over them. */
const byClass = (
  classes: readonly TileClass[],
  name: string,
  params: string,
  result: string,
  body: (list: TileClass) => string,
) =>
  `fn ${name}(kind:u32,${params})${result}{
 switch kind{
${classes.map((list, at) => `  ${at === classes.length - 1 ? 'default' : `case ${at}u`}:{${body(list)}}`).join('\n')}
 }
}`

/** The class of a tile by its ranges with one direction: the largest and smallest motions. */
const SUGGEST_ONE = `fn suggestedClass(range:vec4f)->u32{
 let smallest=dot(range.xy,range.xy);
 let largest=dot(range.zw,range.zw);
 let halved=largest>mb.knobs.x*mb.knobs.x&&mb.knobs.y!=0.0;
 if(largest<${LEAST_STREAK_PIXELS * LEAST_STREAK_PIXELS}){return 0u;}
 if(smallest>0.4*largest){return select(1u,0u,halved);}
 return select(3u,2u,halved);
}`
/** With two directions: a tile whose second largest motion is half a pixel or more, and whose
 *  largest is, takes the class of two motions, whatever its smallest. */
const SUGGEST_TWO = `fn suggestedClass(range:vec4f,second:vec2f)->u32{
 let smallest=dot(range.xy,range.xy);
 let largest=dot(range.zw,range.zw);
 let halved=largest>mb.knobs.x*mb.knobs.x&&mb.knobs.y!=0.0;
 if(largest<${LEAST_STREAK_PIXELS * LEAST_STREAK_PIXELS}){return 0u;}
 if(dot(second,second)>=${LEAST_STREAK_PIXELS * LEAST_STREAK_PIXELS}){return ${TILE_CLASSES_TWO.indexOf(TWO_MOTION_CLASS)}u;}
 if(smallest>0.4*largest){return select(1u,0u,halved);}
 return select(3u,2u,halved);
}`

/** The class one tile of motion around a filter tile suggests, with one direction or with two. */
const CLASS_OF_ONE =
  '   kind=max(kind,suggestedClass(textureLoad(tilesIn,clamp(first+vec2i(x,y),vec2i(0),last),0)));\n'
const CLASS_OF_TWO = `   let around=clamp(first+vec2i(x,y),vec2i(0),last);
   kind=max(kind,suggestedClass(textureLoad(tilesIn,around,0),textureLoad(secondsIn,around,0).xy));
`

/**
 * The class of each filter tile of `FILTER_TILE` pixels a side, a lane to a tile, and the lists of
 * the tiles of each class a filter dispatch runs through:
 * - the ranges of the nine tiles of motion around the tile's centre are read, and each suggests a
 *   class (`suggestedClass`): one whose largest motion is under half a pixel suggests the cheapest, the half-size
 *   gather, which copies the image as it is; one whose smallest motion is over 0.4 of the largest
 *   (a motion all the tile's pixels share) suggests the gather, at half the resolution where the
 *   largest is longer than the samples a pixel takes (`knobs.x` squared) and the setting
 *   allows (`knobs.y`); any other suggests the weighing of each sample by its depth and its own motion,
 *   at half the resolution on the same terms;
 * - with `directions` of 2 a tile of motion whose second largest motion is half a pixel or more
 *   — and whose largest is — suggests the class of two motions, which no other outranks;
 * - the tile takes the greatest class any of the nine suggests;
 * - the tiles of each class are appended to its list (`gpu/dispatch/list.ts`, reset beforehand),
 *   which the filter of the class is dispatched over indirectly: each workgroup counts its own in
 *   workgroup memory, then appends them to each list once, a tile's two coordinates in the halves
 *   of an entry.
 */
export const classifyShader = (directions = 1) => {
  const two = directions > 1,
    classes = tileClasses(directions)
  const count = classes.length
  return wgslProgram(
    `@group(0) @binding(${CLASSIFY_BINDINGS.params}) var<uniform> mb:MotionBlurParams;
@group(0) @binding(${CLASSIFY_BINDINGS.tiles}) var tilesIn:texture_2d<f32>;
${two ? `@group(0) @binding(${CLASSIFY_TWO_BINDINGS.tilesSecond}) var secondsIn:texture_2d<f32>;\n` : ''}var<workgroup> groupCounts:array<atomic<u32>,${count}>;
${byClass(classes, 'pour', 'n:u32', '->u32', (list) => `return ${list}Append(n,1u);`)}
${byClass(classes, 'put', 'at:u32,entry:u32', '', (list) => `${list}.entries[at]=entry;`)}
${two ? SUGGEST_TWO : SUGGEST_ONE}
@compute @workgroup_size(${FILTER_TILE},${FILTER_TILE})
fn classifyTiles(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=vec2i(wg.xy*${FILTER_TILE}u+lid.xy);
 let valid=all(vec2u(tile)<mb.tiles.zw);
 let first=vec2i(floor((vec2f(tile)+vec2f(0.5))*(mb.grid.x*mb.color.z)));
 let last=vec2i(mb.tiles.xy)-vec2i(1);
 var kind=0u;
 for(var y=-1;y<=1;y++){
  for(var x=-1;x<=1;x++){
${two ? CLASS_OF_TWO : CLASS_OF_ONE}  }
 }
 if(lane<${count}u){atomicStore(&groupCounts[lane],0u);}
 workgroupBarrier();
 var taken=0u;
 if(valid){taken=atomicAdd(&groupCounts[kind],1u);}
 workgroupBarrier();
 if(lane<${count}u){
  let n=atomicLoad(&groupCounts[lane]);
  var base=0u;
  if(n>0u){base=pour(lane,n);}
  atomicStore(&groupCounts[lane],base);
 }
 workgroupBarrier();
 if(valid){put(kind,atomicLoad(&groupCounts[kind])+taken,u32(tile.x)|(u32(tile.y)<<16u));}
}`,
    [MOTION_BLUR_PARAMS_WGSL, ...classes.map(classList)],
  )
}
