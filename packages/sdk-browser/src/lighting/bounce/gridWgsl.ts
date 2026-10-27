import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { BOUNCE_MAX_LEVELS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { TABLE_AT_WGSL } from './atlas.ts'
import { BOUNCE_GRID, BOUNCE_LEVEL } from './uniform.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The levels' uniform's types (`BounceGrid`, `BounceLevel`) and the count of levels the declared uniform holds (a cache uses `counts.y` of them). */
export const BOUNCE_GRID_STRUCTS_WGSL = wgslBlock(
  'BOUNCE_GRID_STRUCTS_WGSL',
  [],
  `${BOUNCE_LEVEL.wgsl}
${BOUNCE_GRID.wgsl}
${wgslConsts({ CASCADE_LEVELS: BOUNCE_MAX_LEVELS })}`,
)

/**
 * The addresses of the cells of the levels, which a program that names the uniform (`bounce`) alone reads: a cell's remainder
 * modulo the cube side (`probeWrap`), the entry of the table for the cell of a level whose remainders are `wrapped`
 * (`cellEntry`, the order level, z, y, x), the place of a cell's probe (`probePosition`), where a point lies among the level's probes (`probeCoordFloat`,
 * `probeBottomCell`, `probeFraction`) and the rule by which a level reads a surface (`bounceRead`). A program that reads the
 * table too names the whole head (`BOUNCE_GRID_HEAD_WGSL`), which holds these.
 */
export const BOUNCE_CELLS_WGSL = wgslBlock(
  'BOUNCE_CELLS_WGSL',
  [BOUNCE_GRID_STRUCTS_WGSL],
  `/** World position of the probe of a cell: the global lattice, independent of the camera and of the level, the probe of cell n at n · spacing. */
fn probePosition(cell:vec3i,spacing:f32)->vec3f{return vec3f(cell)*spacing;}
/** Where \`P\` lies in the cells of a level, counted from its corner (the world point half a cell before the level's lowest probe): the cell k of the
 *  level holds its probe at k + ½. The one place a position becomes a coordinate among a level's probes. */
fn probeCoordFloat(level:u32,P:vec3f)->vec3f{
 let spacing=bounce.levels[level].spacing;
 let corner=(bounce.levels[level].base-vec3f(0.5))*spacing;
 return (P-corner)/spacing;
}
/** Where \`P\` lies among the level's probes, counted from its lowest: the probe k is at k, so the floor is the first of the eight probes round
 *  the point and the fraction the weights of the trilinear interpolation between them. */
fn probeCornerFloat(level:u32,P:vec3f)->vec3f{return probeCoordFloat(level,P)-vec3f(0.5);}
/** The cell of the first of the eight probes round \`P\` in the level. */
fn probeBottomCell(level:u32,P:vec3f)->vec3i{
 return vec3i(bounce.levels[level].base)+vec3i(floor(probeCornerFloat(level,P)));
}
/** The fractions of \`P\` between the eight probes round it: the weights of their trilinear interpolation. */
fn probeFraction(level:u32,P:vec3f)->vec3f{return fract(probeCornerFloat(level,P));}
/** The share a level has of the answer at \`P\`: one a fade inside the level's lowest and highest probes, falling to nothing at them, where the
 *  level no longer holds all eight probes round the point. The one rule by which a level is picked to read a point and to mark it. */
const LEVEL_INV_FADE:f32=${wgslF32(SCREEN_PROBE_CONSTANTS.radianceInvLevelFadeSize)};
fn levelEdgeFade(level:u32,P:vec3f)->f32{
 let among=probeCornerFloat(level,P);
 let inside=saturate(min(among,vec3f(f32(bounce.counts.x)-1.0)-among)*LEVEL_INV_FADE);
 return min(inside.x,min(inside.y,inside.z));
}
/** Positive remainder of a cell modulo the cube side: the level's toroidal storage. */
fn probeWrap(cell:vec3i)->vec3u{
 let side=i32(bounce.counts.x);
 return vec3u(((cell%side)+side)%side);
}
/** Whether the level holds the cell now: the cube it covers, moved with the eye. */
fn levelHolds(level:u32,cell:vec3i)->bool{
 let inside=cell-vec3i(bounce.levels[level].base);
 return all(inside>=vec3i(0))&&all(inside<vec3i(i32(bounce.counts.x)));
}
/** The square of the distance to the camera of a point whose vector to it is \`toCamera\` (the camera's place minus the point's): the vector's
 *  own square, or, under an orthographic view, the square of its length squared over its extent along the view's direction. */
fn cameraDistanceSq(toCamera:vec3f)->f32{
 if(bounce.forward.w==0.0){return dot(toCamera,toCamera);}
 let span=sqrt(dot(toCamera,toCamera));
 let reduced=span*(span/dot(toCamera,bounce.forward.xyz));
 return reduced*reduced;
}
/** The entry of the table for the cell of a level whose remainders modulo the side are \`wrapped\`: its order, level, z, y, x. */
fn cellEntry(level:u32,wrapped:vec3u)->u32{
 let side=bounce.counts.x;
 return ((level*side+wrapped.z)*side+wrapped.y)*side+wrapped.x;
}
/**
 * Where a level reads a surface at \`P\`, the point itself, never pushed off its surface: the first of the eight probes around it (\`corner\`)
 * and its share of the answer (\`fade\`, \`levelEdgeFade\`) — a partial answer would make a seam. The one rule by which a surface point marks the cells that hold its light (\`poolMarkWgsl.ts\`).
 */
struct BounceRead{corner:vec3i,fade:f32,}
fn bounceRead(level:u32,P:vec3f)->BounceRead{return BounceRead(probeBottomCell(level,P),levelEdgeFade(level,P));}`,
)

/**
 * The levels of probes, as the pool and the radiance cache read them. One declaration: every program names `bounce` and the table
 * (`cellTable`, read by `tableEntry`, `atlas.ts`).
 *
 * Each level is a cube of cells centred on the eye; a cell holds a probe only while the image reads it, from a pool. A probe lives at
 * `cell · spacing`, a multiple of its cell's side, and never moves. The table names the slot of the pool that holds a cell, by the cell's
 * remainder modulo the cube side: a level that follows the eye only changes the cells it holds, and sliding by one cell only changes the
 * entries of the cells that come in. A cell with no slot answers "not yet".
 */
export const BOUNCE_GRID_HEAD_WGSL = wgslBlock(
  'BOUNCE_GRID_HEAD_WGSL',
  [TABLE_AT_WGSL, BOUNCE_GRID_STRUCTS_WGSL, BOUNCE_CELLS_WGSL],
  '',
)

/** The levels' uniform (`bounce`) and the cell table (`cellTable`) at bindings `grid` and `table` of group `group`: every program that
 *  reads the cells declares them so. */
export const bounceBindingsWgsl = (group: number, grid: number, table: number) =>
  wgslBlock(
    `bounceBindingsWgsl(${group}, ${grid}, ${table})`,
    [BOUNCE_GRID_HEAD_WGSL],
    `@group(${group}) @binding(${grid}) var<uniform> bounce:BounceGrid;
@group(${group}) @binding(${table}) var cellTable:texture_2d_array<f32>;`,
  )

/** The levels' uniform alone (`bounce`) at binding `grid` of group `group`: a program that reads no cell of the table. */
const bounceUniformWgsl = (group: number, grid: number) =>
  wgslBlock(
    `bounceUniformWgsl(${group}, ${grid})`,
    [BOUNCE_GRID_STRUCTS_WGSL],
    `@group(${group}) @binding(${grid}) var<uniform> bounce:BounceGrid;`,
  )
