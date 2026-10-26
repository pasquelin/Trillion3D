import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { TABLE_AT_WGSL } from './atlas.ts'
import { BOUNCE_GRID, BOUNCE_LEVEL } from './uniform.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/** The levels' uniform's types (`BounceGrid`, `BounceLevel`) and the count of levels the declared uniform holds. */
export const BOUNCE_GRID_STRUCTS_WGSL = wgslBlock(
  'BOUNCE_GRID_STRUCTS_WGSL',
  [],
  `${BOUNCE_LEVEL.wgsl}
${BOUNCE_GRID.wgsl}
${wgslConsts({ CASCADE_LEVELS: BOUNCE_SETTINGS.cascadeLevels })}`,
)

/**
 * The addresses of the cells of the levels, which a program that names the uniform (`bounce`) alone reads: a cell's remainder
 * modulo the cube side (`probeWrap`), the entry of the table for the cell of a level whose remainders are `wrapped`
 * (`cellEntry`, the order level, z, y, x) and the rule by which a level reads a surface (`bounceRead`). A program that reads the
 * table too names the whole head (`BOUNCE_GRID_HEAD_WGSL`), which holds these.
 */
export const BOUNCE_CELLS_WGSL = wgslBlock(
  'BOUNCE_CELLS_WGSL',
  [BOUNCE_GRID_STRUCTS_WGSL],
  `/** Positive remainder of a cell modulo the cube side: the level's toroidal storage. */
fn probeWrap(cell:vec3i)->vec3u{
 let side=i32(bounce.counts.x);
 return vec3u(((cell%side)+side)%side);
}
/** The entry of the table for the cell of a level whose remainders modulo the side are \`wrapped\`: its order, level, z, y, x. */
fn cellEntry(level:u32,wrapped:vec3u)->u32{
 let side=bounce.counts.x;
 return ((level*side+wrapped.z)*side+wrapped.y)*side+wrapped.x;
}
const BOUNCE_NORMAL_BIAS:f32=${BOUNCE_SETTINGS.normalBias};
/**
 * Where a level reads a surface at \`P\` of normal \`N\`: the point pushed off it by the normal bias
 * (\`biased\`), in the level's cells half a cell back (\`local\`, a probe's centre on an integer), the
 * first of the eight probes around it (\`corner\`), whether the level holds all eight (\`holds\`): a
 * partial answer would make a seam —, and its share of the answer (\`fade\`): one a cell inside the
 * level's edge, falling to nothing at it. The one rule by which a surface point marks the cells that hold its light (\`poolMarkWgsl.ts\`).
 */
struct BounceRead{biased:vec3f,local:vec3f,corner:vec3i,holds:bool,fade:f32,}
fn bounceRead(level:u32,P:vec3f,N:vec3f)->BounceRead{
 let spacing=bounce.levels[level].spacing;
 let base=vec3i(bounce.levels[level].base);
 let biased=P+N*BOUNCE_NORMAL_BIAS*spacing;
 let local=biased/spacing-vec3f(0.5);
 let corner=vec3i(floor(local));
 let last=vec3f(base+vec3i(i32(bounce.counts.x)-1));
 let holds=all(corner>=base)&&all(corner+vec3i(1)<base+vec3i(i32(bounce.counts.x)));
 let inside=min(local-vec3f(base),last-local);
 return BounceRead(biased,local,corner,holds,clamp(min(inside.x,min(inside.y,inside.z)),0.0,1.0));
}`,
)

/**
 * The levels of probes, as the pool and the radiance cache read them. One declaration: every program names `bounce` and the table
 * (`cellTable`, read by `tableEntry`, `atlas.ts`).
 *
 * Each level is a cube of cells centred on the eye; a cell holds a probe only while the image reads it, from a pool. A probe lives at
 * the centre of its cell, `(cell + ½) · spacing`, and never moves. The table names the slot of the pool that holds a cell, by the cell's
 * remainder modulo the cube side: a level that follows the eye only changes the cells it holds, and sliding by one cell only changes the
 * entries of the cells that come in. A cell with no slot answers "not yet".
 */
export const BOUNCE_GRID_HEAD_WGSL = wgslBlock(
  'BOUNCE_GRID_HEAD_WGSL',
  [TABLE_AT_WGSL, BOUNCE_GRID_STRUCTS_WGSL, BOUNCE_CELLS_WGSL],
  `
/** World position of a cell: the global lattice, independent of the camera and of the level. */
fn probeCentre(cell:vec3i,spacing:f32)->vec3f{return (vec3f(cell)+vec3f(0.5))*spacing;}
`,
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
